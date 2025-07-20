import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { CodeSnippet, Directory, IStorageManager, IGitOperationsManager, IFileSystemManager, GitStatusResult } from '../../types/types'
import { SyncResult, ChangeDetectionResult, RemoteCheckResult } from '../../types/syncTypes'
import { SettingsManager } from '../settingsManager'
import { TempFilesCleaner } from '../cleanupTempFiles'
// TODO: 简化冲突处理，使用Git标准检测器  
import { ConflictDetector } from '../conflict/conflictDetector'
import { ConflictResolver } from '../conflict/conflictResolver'
import { ManualConflictHandler } from '../conflict/manualConflictHandler'
import { ThreeWayMergeManager } from './threeWayMergeManager'
import { FileSystemManager } from './fileSystemManager'

/**
 * 数据同步核心管理器
 * 负责同步流程控制、变更检测、智能合并和冲突处理的协调
 */
export class DataSyncManager {
  private context: vscode.ExtensionContext | null = null
  private storageManager: IStorageManager | null = null
  private conflictDetector: ConflictDetector
  private conflictResolver: ConflictResolver
  private manualConflictHandler: ManualConflictHandler
  private threeWayMergeManager: ThreeWayMergeManager | null = null
  private fileSystemManager: IFileSystemManager | null = null

  constructor(
    context?: vscode.ExtensionContext, 
    storageManager?: IStorageManager, 
    fileSystemManager?: IFileSystemManager
  ) {
    this.context = context || null
    this.storageManager = storageManager || null
    this.fileSystemManager = fileSystemManager || null
    this.conflictDetector = new ConflictDetector()
    this.conflictResolver = new ConflictResolver()
    this.manualConflictHandler = new ManualConflictHandler(context, storageManager)
    
    // 延迟初始化ThreeWayMergeManager (需要Git实例，在实际使用时初始化)
    this.threeWayMergeManager = null
  }

  /**
   * 【Git 标准】执行同步流程
   *
   * 完全遵循 Git 的标准同步流程：
   * 1. 检查本地工作区状态
   * 2. 提交本地更改（如有）
   * 3. Fetch 远程数据  
   * 4. 检查是否需要合并
   * 5. 执行合并（如有冲突则停止）
   * 6. Push 到远程
   * 
   * 参考：https://git-scm.com/book/en/v2/Git-Branching-Basic-Branching-and-Merging
   */
  public async performSyncFlow(
    localSnippets: CodeSnippet[],
    localDirectories: Directory[],
    remoteCheckResult: RemoteCheckResult,
    gitOpsManager: IGitOperationsManager,
    fileSystemManager: IFileSystemManager,
    options?: {
      forceSmartMerge?: boolean
      forceUseLocal?: boolean
      forceUseRemote?: boolean
    }
  ): Promise<SyncResult> {
    try {
      console.log('🚀 开始Git标准同步流程...')

      // 【新增】步骤0.1: 自动清理未完成的合并状态
      console.log('🧹 步骤0.1: 自动清理未完成的合并状态...')
      const cleanupResult = await this.autoCleanupUnfinishedMerge(gitOpsManager)
      if (cleanupResult.action !== 'none') {
        console.log(`✅ 自动清理完成: ${cleanupResult.message}`)
      }

      // 【新增】步骤0.2: 检测是否为重新初始化场景
      const isReinitialized = await this.detectRepositoryReinitialization(gitOpsManager, remoteCheckResult)
      
      if (isReinitialized) {
        console.log('🔄 检测到本地仓库重新初始化，执行优化的初始同步策略...')
        return await this.performReinitializedSync(
          localSnippets,
          localDirectories,
          remoteCheckResult,
          gitOpsManager,
          fileSystemManager,
          options
        )
      }

      // 【Git 标准】步骤1: 检查本地工作区状态
      console.log('📋 步骤1: 检查本地工作区状态...')
      const gitStatus = await gitOpsManager.gitStatus()
      const hasUncommittedChanges = gitStatus.files.length > 0
      
      console.log(`   工作区状态: ${hasUncommittedChanges ? '有未提交的更改' : '干净'}`)
      if (hasUncommittedChanges) {
        console.log(`   未提交的文件: ${gitStatus.files.map((f: any) => f.path).join(', ')}`)
      }

      // 【Git 标准】步骤2: 将当前VSCode数据写入工作区并提交（如果有更改）
      console.log('💾 步骤2: 同步VSCode数据到Git工作区...')
      
      // 【安全检查】在写入前检查是否存在数据安全风险
      const isEmptyLocalData = localSnippets.length === 0 && localDirectories.length === 0
      const hasRemoteData = remoteCheckResult.remoteHasData
      let userConfirmation: string | undefined = undefined
      
      if (isEmptyLocalData && hasRemoteData) {
        console.log('⚠️ 检测到潜在数据覆盖风险：本地数据为空但远程有数据')
        console.log('🛡️ 执行数据安全保护流程...')
        
        // 询问用户确认是否要用空数据覆盖远程数据
        userConfirmation = await vscode.window.showWarningMessage(
          '⚠️ 数据安全警告\n\n' +
          '检测到本地代码片段为空，但远程仓库包含数据。\n' +
          '继续同步将用空数据覆盖远程数据，这可能导致数据丢失。\n\n' +
          '您希望如何处理？',
          {
            modal: true,
            detail: '建议选择"拉取远程数据"来避免数据丢失。'
          },
          '拉取远程数据', 
          '强制覆盖远程数据',
          '取消同步'
        )
        
        if (userConfirmation === '取消同步') {
          return {
            success: false,
            message: '用户取消同步操作'
          }
        } else if (userConfirmation === '拉取远程数据') {
          console.log('🔄 用户选择拉取远程数据，准备清理本地状态并拉取...')
          
          // 检查是否有未提交的更改或冲突状态
          const currentStatus = await gitOpsManager.gitStatus()
          if (currentStatus.files.length > 0 || currentStatus.conflicted.length > 0) {
            console.log('🧹 检测到本地有未提交更改或冲突，先清理本地状态...')
            
            try {
              // 如果有冲突状态，先取消合并
              if (currentStatus.conflicted.length > 0) {
                console.log('🔄 取消之前的合并状态...')
                try {
                  const git = await gitOpsManager.getGitInstance()
                  await git.raw(['merge', '--abort'])
                } catch (abortError) {
                  console.log('📝 合并取消失败（可能没有进行中的合并）:', abortError)
                  // 继续执行重置操作
                }
              }
              
              // 重置工作区到最新提交状态
              console.log('🔄 重置工作区到干净状态...')
              const git = await gitOpsManager.getGitInstance()
              await git.raw(['reset', '--hard', 'HEAD'])
              await git.raw(['clean', '-fd'])
              
              console.log('✅ 本地状态已清理，准备拉取远程数据')
            } catch (resetError) {
              console.error('❌ 清理本地状态失败:', resetError)
              return {
                success: false,
                message: `清理本地状态失败: ${resetError instanceof Error ? resetError.message : '未知错误'}`
              }
            }
          }
          
          // 跳过写入本地空数据，直接进行远程数据拉取
          // 这样可以避免用空数据覆盖远程数据
        } else if (userConfirmation === '强制覆盖远程数据') {
          console.log('⚠️ 用户确认强制覆盖远程数据，继续写入空数据...')
          await fileSystemManager.writeToGit(localSnippets, localDirectories)
        } else {
          // 用户点击了X或ESC，视为取消
          return {
            success: false,
            message: '用户取消同步操作'
          }
        }
      } else {
        // 正常情况：本地有数据，或远程为空，或两者都为空
        console.log('✅ 数据安全检查通过，但先检查是否真的需要写入...')
        
        // 【修复】先检查VSCode数据与Git仓库数据是否一致，避免不必要的覆盖
        try {
          const currentGitData = await fileSystemManager.readFromGit()
                     const needsWrite = this.checkIfVSCodeDataDiffersFromGit(
             localSnippets, localDirectories,
             currentGitData.snippets, currentGitData.directories
           )
          
          if (needsWrite) {
            console.log('📝 检测到VSCode数据与Git仓库不一致，执行写入...')
            await fileSystemManager.writeToGit(localSnippets, localDirectories)
          } else {
            console.log('✅ VSCode数据与Git仓库已一致，跳过写入')
          }
        } catch (checkError) {
          console.warn('⚠️ 检查数据一致性失败，执行安全写入...', checkError)
          await fileSystemManager.writeToGit(localSnippets, localDirectories)
        }
      }
      
      // 【修复】检查写入后是否有新的更改（只在实际写入数据后检查）
      let hasChangesToCommit = false
      
      if (!isEmptyLocalData || !hasRemoteData || 
          (isEmptyLocalData && hasRemoteData && userConfirmation === '强制覆盖远程数据')) {
        
        // 【修复】强制添加所有文件到暂存区，确保变更被Git跟踪
        console.log('📝 强制添加所有文件到暂存区...')
        await gitOpsManager.gitAddAll()
        
        // 检查暂存区状态而不是工作区状态
        const statusAfterWrite = await gitOpsManager.gitStatus()
        hasChangesToCommit = statusAfterWrite.staged.length > 0 || 
                           statusAfterWrite.created.length > 0 || 
                           statusAfterWrite.modified.length > 0 || 
                           statusAfterWrite.deleted.length > 0 ||
                           statusAfterWrite.renamed.length > 0
        
        if (hasChangesToCommit) {
          console.log(`   检测到需要提交的暂存更改`)

          // 【修复】此时文件已经添加到暂存区，直接提交即可
          try {
            // 提交更改
            const commitMessage = `同步本地更改: ${new Date().toLocaleString()}`
            await gitOpsManager.gitCommit(commitMessage)
            console.log(`✅ 已提交本地更改: ${commitMessage}`)
          } catch (commitError) {
            const errorMessage = commitError instanceof Error ? commitError.message : '未知错误'
            
            // 如果是"没有变更需要提交"的错误，这是正常的，继续执行
            if (errorMessage.includes('nothing to commit') || 
                errorMessage.includes('no changes added') ||
                errorMessage.includes('没有变更需要提交')) {
              console.log('✅ Git确认无变更需要提交，继续后续流程')
            } else {
              // 其他提交错误需要抛出
              throw commitError
            }
          }
        } else {
          console.log('✅ 工作区数据已是最新，无需提交')
        }
      } else if (isEmptyLocalData && hasRemoteData && userConfirmation === '拉取远程数据') {
        console.log('🔄 拉取远程数据模式：跳过本地提交，工作区已清理')
      } else {
        console.log('🔄 跳过提交步骤：其他情况')
      }

      // 【Git 标准】步骤3: Fetch 远程数据
      console.log('📡 步骤3: Fetch 远程数据...')
      
      if (remoteCheckResult.remotePullSuccess || remoteCheckResult.remoteHasData) {
        try {
          await gitOpsManager.gitFetch()
          console.log('✅ 远程数据获取成功')
        } catch (fetchError) {
          console.warn('⚠️ Fetch 失败:', fetchError)
          // 如果是首次推送或远程分支不存在，这是正常的
          if (!remoteCheckResult.isRemoteEmpty) {
            throw fetchError
          }
        }
      } else {
        console.log('📝 远程仓库为空或不存在，跳过fetch步骤')
      }

      // 【Git 标准】步骤4: 检查是否需要合并
      console.log('🔍 步骤4: 检查是否需要合并...')
      
      let needsMerge = false
      let remoteUpdates = { hasUpdates: false, details: '' }
      
      if (remoteCheckResult.remotePullSuccess || remoteCheckResult.remoteHasData) {
        remoteUpdates = await gitOpsManager.checkRemoteUpdates()
        needsMerge = remoteUpdates.hasUpdates
        
        if (needsMerge) {
          console.log(`📥 检测到远程更新，需要合并: ${remoteUpdates.details}`)
        } else {
          console.log('✅ 远程无新更新，无需合并')
        }
      }

      // 【Git 标准】步骤5: 执行合并（如果需要）
      if (needsMerge) {
        console.log('🔀 步骤5: 执行Git合并...')
        
        try {
          // 【改进】先检查是否有未完成的合并
          const git = await gitOpsManager.getGitInstance()
          const status = await git.status()
          
          if (status.conflicted.length > 0) {
            // 有未解决的冲突，提示用户处理
            return {
              success: false,
              message: `检测到未解决的Git合并冲突。请先解决冲突或清理合并状态。\n\n建议使用 "清理未完成的合并状态" 命令。`,
              conflictsDetected: true,
                             conflictDetails: status.conflicted.map((f: any) => f.path || f)
            }
          }
          
          // 检查是否有未完成的合并（MERGE_HEAD存在）
          try {
            await git.raw(['rev-parse', '--verify', 'MERGE_HEAD'])
            return {
              success: false,
              message: `检测到未完成的Git合并。请先完成上次合并或使用 "清理未完成的合并状态" 命令清理状态。`
            }
          } catch (error) {
            // MERGE_HEAD不存在，可以正常进行合并
          }
          
                    // 【改进】使用更精确的合并控制：先fetch，再merge
          console.log('🔄 开始Git标准合并流程: fetch + merge...')
          await gitOpsManager.gitFetch()
          
          const config = SettingsManager.getCloudSyncConfig()
          const targetBranch = config.defaultBranch || 'main'
          
          try {
            await git.merge([`origin/${targetBranch}`])
            console.log('✅ Git合并完成')
          } catch (mergeError) {
            const errorMessage = mergeError instanceof Error ? mergeError.message : '未知错误'
            
            // 【重要修复】处理 "unrelated histories" 错误
            if (errorMessage.includes('refusing to merge unrelated histories')) {
              console.log('⚠️ 检测到不相关历史记录，使用--allow-unrelated-histories重试合并...')
              try {
                await git.merge([`origin/${targetBranch}`, '--allow-unrelated-histories'])
                console.log('✅ 使用--allow-unrelated-histories合并成功')
              } catch (retryError) {
                console.error('❌ 即使使用--allow-unrelated-histories也无法合并:', retryError)
                throw new Error(`Git历史冲突无法自动解决：\n\n原因：本地仓库和远程仓库有不同的Git历史记录\n\n解决方案：\n1. 使用"重新初始化仓库"命令（推荐）\n2. 手动删除本地Git仓库目录后重新同步\n\n技术详情：\n原始错误: ${errorMessage}\n重试错误: ${retryError}`)
              }
            } else {
              // 其他类型的合并错误，直接抛出
              throw mergeError
            }
          }

          // 合并后，需要重新读取合并结果并更新VSCode
          const mergedData = await fileSystemManager.readFromGit()
          
          if (this.storageManager) {
            console.log('🔄 更新VSCode工作区数据...')
            const updateResult = await this.performSafeStorageUpdate(
              mergedData.snippets, 
              mergedData.directories
            )
            
            if (!updateResult.success) {
              console.warn('⚠️ VSCode工作区更新失败:', updateResult.error)
              return {
                success: false,
                message: `合并成功但VSCode更新失败: ${updateResult.error}`,
              }
            }
            console.log('✅ VSCode工作区已更新')
          }
          
        } catch (mergeError) {
          console.error('❌ Git合并失败:', mergeError)
          
          // 检查是否是合并冲突
          const errorMessage = mergeError instanceof Error ? mergeError.message : '未知错误'
          
          // 检查是否是未完成的合并错误
          if (errorMessage.includes('unfinished merge') || errorMessage.includes('Exiting because of unfinished merge')) {
            return {
              success: false,
              message: `检测到未完成的Git合并状态。\n\n解决方案：\n1. 使用 "清理未完成的合并状态" 命令\n2. 或在命令面板运行：StarCode Snippets: 清理未完成的合并状态\n\n技术详情：${errorMessage}`
            }
          }
          
          if (errorMessage.includes('conflict') || errorMessage.includes('CONFLICT')) {
            // 发生新的合并冲突，打开冲突编辑器
            console.log('🔍 检测到Git合并冲突，打开冲突解决界面...')
            
            // 【改进】立即打开VSCode内置的冲突编辑器
            const git = await gitOpsManager.getGitInstance()
            const conflictStatus = await git.status()
                         const conflictFiles = conflictStatus.conflicted.map((f: any) => f.path || f)
            
            if (conflictFiles.length > 0) {
              // 获取Git仓库路径
              const repoPath = SettingsManager.getEffectiveLocalPath()
              
              // 打开第一个冲突文件
              const firstConflictFile = conflictFiles[0]
              const conflictFilePath = vscode.Uri.file(path.join(repoPath, firstConflictFile))
              
              try {
                // 在VSCode中打开冲突文件，自动显示合并编辑器
                const document = await vscode.workspace.openTextDocument(conflictFilePath)
                await vscode.window.showTextDocument(document)
                
                // 显示用户友好的指导信息
                const message = `检测到 ${conflictFiles.length} 个冲突文件，已为您打开冲突编辑器。\n\n请按以下步骤操作：\n1. 在编辑器中解决所有冲突（接受传入、当前或合并更改）\n2. 保存文件\n3. 重复处理所有冲突文件\n4. 完成后重新运行同步\n\n冲突文件：${conflictFiles.join(', ')}`
                
                vscode.window.showInformationMessage(message, { modal: false })
                
                // 返回需要手动处理的状态
                return {
                  success: false,
                  message: `Git合并冲突已打开编辑器。请解决所有冲突后重新同步。\n\n冲突文件：${conflictFiles.join(', ')}`,
                  conflictsDetected: true,
                  conflictDetails: conflictFiles
                }
              } catch (openError) {
                console.error('打开冲突文件失败:', openError)
                
                // 如果无法打开VSCode编辑器，提供手动解决建议
                return {
                  success: false,
                  message: `Git合并冲突需要手动解决：\n\n冲突文件：\n${conflictFiles.join('\n')}\n\n请在外部编辑器中解决冲突，然后运行 "清理未完成的合并状态" 命令完成合并。`,
                  conflictsDetected: true,
                  conflictDetails: conflictFiles
                }
              }
            }
          }
          
          throw mergeError
        }
      }

      // 【Git 标准】步骤6: Push 到远程
      console.log('📤 步骤6: Push 到远程...')
      
      try {
        // 【修复】检查是否真的有内容需要推送
        const finalStatus = await gitOpsManager.gitStatus()
        const isWorkingDirClean = finalStatus.files.length === 0
        
        if (isWorkingDirClean && !needsMerge) {
          // ⚠️ 重要：工作区干净且没有合并不等于数据一致！
          // 需要进一步检查VSCode存储数据与Git仓库数据是否真正一致
          console.log('🔍 步骤6.1: 验证VSCode存储与Git仓库数据一致性...')
          
          try {
            // 读取当前Git仓库中的数据
            const gitRepoData = await fileSystemManager.readFromGit()
            
            // 【修复】改进数据一致性检查：只比较核心业务数据，忽略时间戳等变化字段
            const normalizeSnippetForComparison = (snippet: CodeSnippet) => ({
              name: snippet.name,
              code: snippet.code,
              language: snippet.language,
              fullPath: snippet.fullPath,
              filePath: snippet.filePath || '',
              category: snippet.category || ''
            })
            
            const normalizeDirectoryForComparison = (dir: Directory) => ({
              name: dir.name,
              fullPath: dir.fullPath
            })
            
            // 比较VSCode存储数据与Git仓库数据（只比较核心业务字段）
            const vscodeNormalizedSnippets = localSnippets
              .map(normalizeSnippetForComparison)
              .sort((a, b) => a.fullPath.localeCompare(b.fullPath))
            
            const vscodeNormalizedDirectories = localDirectories
              .map(normalizeDirectoryForComparison)
              .sort((a, b) => a.fullPath.localeCompare(b.fullPath))
            
            const gitNormalizedSnippets = gitRepoData.snippets
              .map(normalizeSnippetForComparison)
              .sort((a, b) => a.fullPath.localeCompare(b.fullPath))
            
            const gitNormalizedDirectories = gitRepoData.directories
              .map(normalizeDirectoryForComparison)
              .sort((a, b) => a.fullPath.localeCompare(b.fullPath))
            
            // 比较核心业务数据
            const snippetsMatch = JSON.stringify(vscodeNormalizedSnippets) === JSON.stringify(gitNormalizedSnippets)
            const directoriesMatch = JSON.stringify(vscodeNormalizedDirectories) === JSON.stringify(gitNormalizedDirectories)
            const isDataConsistent = snippetsMatch && directoriesMatch
            
            console.log(`🔍 数据一致性检查结果:`)
            console.log(`   VSCode: ${localSnippets.length} 个代码片段, ${localDirectories.length} 个目录`)
            console.log(`   Git仓库: ${gitRepoData.snippets.length} 个代码片段, ${gitRepoData.directories.length} 个目录`)
            console.log(`   代码片段一致: ${snippetsMatch}`)
            console.log(`   目录一致: ${directoriesMatch}`)
            console.log(`   总体一致: ${isDataConsistent}`)
            
            if (isDataConsistent) {
              // VSCode存储与本地Git仓库一致，但仍需检查是否需要推送到远程
              console.log('✅ 确认VSCode存储与Git仓库数据一致')
              
              // 【重要修复】即使数据一致，仍然需要执行推送，确保本地提交同步到远程
              // 因为在前面步骤2中可能已经产生了新的本地提交
              console.log('🔍 数据一致，但仍需执行推送确保本地提交同步到远程')
              // 继续执行推送逻辑（不要return）
            } else {
              // 数据不一致：需要重新写入Git并推送
              console.log('⚠️ 检测到VSCode存储与Git仓库核心数据不一致，需要同步到Git')
              
              // 详细分析差异
              if (!snippetsMatch) {
                console.log('📋 代码片段差异详情:')
                for (let i = 0; i < Math.max(vscodeNormalizedSnippets.length, gitNormalizedSnippets.length); i++) {
                  const vscodeSnippet = vscodeNormalizedSnippets[i]
                  const gitSnippet = gitNormalizedSnippets[i]
                  
                  if (!vscodeSnippet) {
                    console.log(`   Git额外: ${gitSnippet.fullPath}`)
                  } else if (!gitSnippet) {
                    console.log(`   VSCode额外: ${vscodeSnippet.fullPath}`)
                  } else if (JSON.stringify(vscodeSnippet) !== JSON.stringify(gitSnippet)) {
                    console.log(`   差异片段: ${vscodeSnippet.fullPath}`)
                    if (vscodeSnippet.name !== gitSnippet.name) {
                      console.log(`     名称: "${vscodeSnippet.name}" vs "${gitSnippet.name}"`)
                    }
                    if (vscodeSnippet.language !== gitSnippet.language) {
                      console.log(`     语言: "${vscodeSnippet.language}" vs "${gitSnippet.language}"`)
                    }
                    if (vscodeSnippet.code !== gitSnippet.code) {
                      console.log(`     内容长度: ${vscodeSnippet.code?.length || 0} vs ${gitSnippet.code?.length || 0}`)
                    }
                  }
                }
              }
              
              // 重新写入最新的VSCode数据到Git
              await fileSystemManager.writeToGit(localSnippets, localDirectories)
              
              // 【修复】强制添加所有文件，确保变更被Git跟踪
              console.log('📝 强制添加所有文件到Git暂存区...')
              await gitOpsManager.gitAddAll()
              
              // 检查暂存区是否有变更需要提交
              const statusAfterStaging = await gitOpsManager.gitStatus()
              const hasChangesToCommit = statusAfterStaging.staged.length > 0 || 
                                       statusAfterStaging.created.length > 0 || 
                                       statusAfterStaging.modified.length > 0 || 
                                       statusAfterStaging.deleted.length > 0 ||
                                       statusAfterStaging.renamed.length > 0
              
              if (hasChangesToCommit) {
                console.log('📝 提交VSCode数据到Git仓库...')
                const commitMessage = `同步VSCode最新数据: ${new Date().toLocaleString()}`
                await gitOpsManager.gitCommit(commitMessage)
                console.log(`✅ 已提交: ${commitMessage}`)
                
                // 继续推送流程
                console.log('📤 推送更新后的数据到远程...')
              } else {
                console.log('🔍 暂存区无变更，数据可能已是最新状态')
                // 即使没有新提交，也要确保推送现有的本地提交
              }
            }
          } catch (consistencyCheckError) {
            console.error('❌ 数据一致性检查失败:', consistencyCheckError)
            // 数据一致性检查失败时，为安全起见，重新写入并推送
            console.log('🔄 一致性检查失败，执行安全同步...')
            await fileSystemManager.writeToGit(localSnippets, localDirectories)
            
            // 【修复】强制添加所有文件，确保安全同步也被正确提交
            await gitOpsManager.gitAddAll()
            
            const statusAfterSafeStaging = await gitOpsManager.gitStatus()
            const hasSafeChangesToCommit = statusAfterSafeStaging.staged.length > 0 || 
                                         statusAfterSafeStaging.created.length > 0 || 
                                         statusAfterSafeStaging.modified.length > 0 || 
                                         statusAfterSafeStaging.deleted.length > 0 ||
                                         statusAfterSafeStaging.renamed.length > 0
            
            if (hasSafeChangesToCommit) {
              const safeCommitMessage = `安全同步VSCode数据: ${new Date().toLocaleString()}`
              await gitOpsManager.gitCommit(safeCommitMessage)
              console.log(`✅ 安全同步已提交: ${safeCommitMessage}`)
            }
          }
        }
        
        await gitOpsManager.gitPush()
        console.log('✅ 成功推送到远程')
        
        return {
          success: true,
          message: `✅ 同步完成${needsMerge ? '：已合并远程更改并推送本地更新' : '：已推送本地更新到远程'}`
        }
      } catch (pushError) {
        const errorMessage = pushError instanceof Error ? pushError.message : '未知错误'
        console.error('❌ 推送失败:', errorMessage)
        
        // 特殊错误处理
        if (errorMessage.includes('non-fast-forward') || errorMessage.includes('rejected')) {
          return {
            success: false,
            message: `推送被拒绝：远程有新的更改。请先同步远程更改后再试。\n详细错误：${errorMessage}`
          }
        }
        
        return {
          success: false,
          message: `推送失败: ${errorMessage}`
        }
      }
      
    } catch (error) {
      console.error('❌ Git标准同步流程失败:', error)
      return {
        success: false,
        message: `同步失败: ${error instanceof Error ? error.message : '未知错误'}`,
      }
    }
  }

  /**
   * 执行智能合并（真正的双向同步核心逻辑）
   */
  private async performIntelligentMerge(
    localSnippets: CodeSnippet[],
    localDirectories: Directory[],
    remoteSnippets: CodeSnippet[],
    remoteDirectories: Directory[]
  ): Promise<{
    success: boolean
    message?: string
    hasChanges: boolean
    mergedSnippets: CodeSnippet[]
    mergedDirectories: Directory[]
    needsVSCodeUpdate: boolean
    conflictsDetected?: boolean
    conflictDetails?: string[]
    mergeDetails?: {
      localOnlyChanges: number
      remoteOnlyChanges: number
      conflictsResolved: number
    }
  }> {
    try {
      console.log('开始智能合并...')
      console.log(`本地数据: ${localSnippets.length} 个代码片段, ${localDirectories.length} 个目录`)
      console.log(`远程数据: ${remoteSnippets.length} 个代码片段, ${remoteDirectories.length} 个目录`)

      // 合并代码片段
      const snippetMergeResult = this.mergeSnippets(localSnippets, remoteSnippets)
      console.log(`代码片段合并结果: ${snippetMergeResult.merged.length} 个, ${snippetMergeResult.conflicts.length} 个冲突`)

      // 合并目录
      const directoryMergeResult = this.mergeDirectories(localDirectories, remoteDirectories)
      console.log(`目录合并结果: ${directoryMergeResult.merged.length} 个, ${directoryMergeResult.conflicts.length} 个冲突`)

      // 检查是否有冲突需要手动处理
      const totalConflicts = snippetMergeResult.conflicts.length + directoryMergeResult.conflicts.length
      const manualSnippetConflicts = snippetMergeResult.conflicts.filter(c => c.needsManualMerge)
      const manualDirectoryConflicts = directoryMergeResult.conflicts.filter(c => c.needsManualMerge)

      // 如果有需要手动解决的冲突，调用手动冲突处理器
      if (manualSnippetConflicts.length > 0 || manualDirectoryConflicts.length > 0) {
        console.log(`检测到需要手动解决的冲突: ${manualSnippetConflicts.length} 个代码片段冲突, ${manualDirectoryConflicts.length} 个目录冲突`)
        
        try {
          // 调用手动冲突处理器
          const manualHandleResult = await this.manualConflictHandler.handleManualMergeConflicts(
            manualSnippetConflicts,
            manualDirectoryConflicts
          )
          
          console.log('手动冲突处理结果:', {
            success: manualHandleResult.success,
            message: manualHandleResult.message,
            resolvedCount: manualHandleResult.resolvedSnippets?.length || 0
          })
          
          if (!manualHandleResult.success) {
            // 如果用户取消或者处理失败，返回相应信息
         return {
           success: false,
              message: manualHandleResult.message,
           hasChanges: false,
           mergedSnippets: localSnippets,
           mergedDirectories: localDirectories,
           needsVSCodeUpdate: false,
           conflictsDetected: true,
              conflictDetails: manualHandleResult.conflictFiles
            }
          }
          
          // 如果手动解决成功，更新合并结果
          if (manualHandleResult.resolvedSnippets) {
            console.log(`用户已手动解决 ${manualHandleResult.resolvedSnippets.length} 个冲突`)
            
            // 将用户解决的代码片段更新到合并结果中
            for (const resolvedSnippet of manualHandleResult.resolvedSnippets) {
              const index = snippetMergeResult.merged.findIndex(s => s.fullPath === resolvedSnippet.fullPath)
              if (index >= 0) {
                console.log(`更新已存在的代码片段: ${resolvedSnippet.fullPath}`)
                snippetMergeResult.merged[index] = resolvedSnippet
              } else {
                console.log(`添加新的解决后代码片段: ${resolvedSnippet.fullPath}`)
                snippetMergeResult.merged.push(resolvedSnippet)
              }
            }
            
            // 从冲突列表中移除已解决的冲突
            const originalConflictCount = snippetMergeResult.conflicts.length
            snippetMergeResult.conflicts = snippetMergeResult.conflicts.filter(c => 
              !manualHandleResult.resolvedSnippets!.some(resolved => resolved.fullPath === c.fullPath)
            )
            
            console.log(`冲突解决后，剩余 ${snippetMergeResult.conflicts.length} 个代码片段冲突（原有 ${originalConflictCount} 个）`)
          } else {
            console.log('手动冲突处理成功，但没有返回解决后的代码片段')
          }
          
        } catch (manualError) {
          console.error('手动冲突处理失败:', manualError)
          return {
            success: false,
            message: `手动冲突处理失败: ${manualError instanceof Error ? manualError.message : '未知错误'}`,
            hasChanges: false,
            mergedSnippets: localSnippets,
            mergedDirectories: localDirectories,
            needsVSCodeUpdate: false,
            conflictsDetected: true,
            conflictDetails: manualSnippetConflicts.map(c => c.fullPath)
          }
         }
       }

      // 统计变更
      const localOnlySnippets = localSnippets.filter(local => 
        !remoteSnippets.find(remote => remote.fullPath === local.fullPath)
      )
      const remoteOnlySnippets = remoteSnippets.filter(remote => 
        !localSnippets.find(local => local.fullPath === remote.fullPath)
      )
      const localOnlyDirectories = localDirectories.filter(local => 
        !remoteDirectories.find(remote => remote.fullPath === local.fullPath)
      )
      const remoteOnlyDirectories = remoteDirectories.filter(remote => 
        !localDirectories.find(local => local.fullPath === remote.fullPath)
      )

      const mergeDetails = {
        localOnlyChanges: localOnlySnippets.length + localOnlyDirectories.length,
        remoteOnlyChanges: remoteOnlySnippets.length + remoteOnlyDirectories.length,
        conflictsResolved: totalConflicts
      }

      // 检查合并后的数据是否与本地VSCode数据一致
      const vscodeDataStr = JSON.stringify({
        snippets: localSnippets.sort((a, b) => a.fullPath.localeCompare(b.fullPath)),
        directories: localDirectories.sort((a, b) => a.fullPath.localeCompare(b.fullPath))
      })

      const mergedDataStr = JSON.stringify({
        snippets: snippetMergeResult.merged.sort((a, b) => a.fullPath.localeCompare(b.fullPath)),
        directories: directoryMergeResult.merged.sort((a, b) => a.fullPath.localeCompare(b.fullPath))
      })

      const needsVSCodeUpdate = vscodeDataStr !== mergedDataStr

      // 检查合并后的数据是否与远程数据一致
      const remoteDataStr = JSON.stringify({
        snippets: remoteSnippets.sort((a, b) => a.fullPath.localeCompare(b.fullPath)),
        directories: remoteDirectories.sort((a, b) => a.fullPath.localeCompare(b.fullPath))
      })

      const hasChanges = mergedDataStr !== remoteDataStr

      return {
        success: true,
        hasChanges,
        mergedSnippets: snippetMergeResult.merged,
        mergedDirectories: directoryMergeResult.merged,
        needsVSCodeUpdate,
        conflictsDetected: totalConflicts > 0,
        conflictDetails: [...snippetMergeResult.conflicts, ...directoryMergeResult.conflicts].map(c => c.fullPath),
        mergeDetails
      }
    } catch (error) {
      console.error('智能合并失败:', error)
      return {
        success: false,
        message: `合并失败: ${error instanceof Error ? error.message : '未知错误'}`,
        hasChanges: false,
        mergedSnippets: localSnippets,
        mergedDirectories: localDirectories,
        needsVSCodeUpdate: false
      }
    }
  }

  /**
   * 生成合并提交消息
   */
  private generateMergeCommitMessage(mergeResult: any): string {
    let message = '智能合并: '
    
    const parts: string[] = []
    
    if (mergeResult.mergeDetails?.localOnlyChanges > 0) {
      parts.push(`本地${mergeResult.mergeDetails.localOnlyChanges}项`)
    }
    
    if (mergeResult.mergeDetails?.remoteOnlyChanges > 0) {
      parts.push(`远程${mergeResult.mergeDetails.remoteOnlyChanges}项`)
    }
    
    if (mergeResult.mergeDetails?.conflictsResolved > 0) {
      parts.push(`解决${mergeResult.mergeDetails.conflictsResolved}个冲突`)
    }
    
    if (parts.length > 0) {
      message += parts.join(', ')
    } else {
      message = '同步代码片段数据'
    }
    
    return message
  }

  /**
   * 处理Git合并冲突
   */
  private async handleMergeConflicts(gitOpsManager: any, fileSystemManager: any): Promise<SyncResult> {
    try {
      console.log('开始处理Git合并冲突...')

      // 检查冲突文件
      const gitStatus = await gitOpsManager.gitStatus()
      const conflictFiles = gitStatus.files.filter((f: any) => f.working_dir === 'U' || f.index === 'U')

      if (conflictFiles.length > 0) {
        console.log(
          `检测到 ${conflictFiles.length} 个冲突文件:`,
          conflictFiles.map((f: any) => f.path)
        )

        // 显示冲突信息给用户，让用户选择如何处理
        const choice = await vscode.window.showErrorMessage(
          `Git合并冲突：检测到 ${conflictFiles.length} 个冲突文件\n\n请选择处理方式：`,
          { modal: true },
          '手动解决',
          '使用本地版本',
          '使用远程版本',
          '取消同步'
        )

        if (!choice || choice === '取消同步') {
          return {
            success: false,
            message: '用户取消了冲突解决',
            conflictsDetected: true,
            conflictDetails: conflictFiles.map((f: any) => f.path),
          }
        }

        if (choice === '手动解决') {
          return {
            success: false,
            message: `请手动解决Git合并冲突后重新执行同步。\n\n冲突文件：\n${conflictFiles
              .map((f: any) => `• ${f.path}`)
              .join(
                '\n'
              )}\n\n提示：\n1. 编辑冲突文件，删除冲突标记\n2. 使用 git add . 添加解决后的文件\n3. 使用 git commit 提交合并\n4. 重新执行同步`,
            conflictsDetected: true,
            conflictDetails: conflictFiles.map((f: any) => f.path),
          }
        }

        // 自动解决冲突
        const git = await gitOpsManager.getGitInstance()
        if (choice === '使用本地版本') {
          await git.checkout(['--ours', '.'])
        } else if (choice === '使用远程版本') {
          await git.checkout(['--theirs', '.'])
        }

        // 提交解决结果
        await gitOpsManager.gitAddAll()
        await gitOpsManager.gitCommit(`解决合并冲突：${choice}`)

        console.log(`合并冲突已解决（${choice}）并提交`)
      }

      return {
        success: true,
        message: '✅ 合并冲突已解决，同步完成',
      }
    } catch (error) {
      console.error('处理合并冲突失败:', error)
      return {
        success: false,
        message: `处理合并冲突失败: ${error instanceof Error ? error.message : '未知错误'}`,
      }
    }
  }

  /**
   * 检测本地变更
   */
  public async detectLocalChanges(
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[]
  ): Promise<ChangeDetectionResult> {
    try {
      console.log('开始检测本地变更...')
      const storedData = await this.readDataFromGitRepo()

      // 使用更精确的排序键，基于fullPath
      const getSortKey = (item: any) => {
        // 对于V2格式，直接使用fullPath
        return item.fullPath || `${item.name || 'unknown'}_${item.createTime || 0}`
      }

      // 深度比较：先按fullPath排序再比较
      const currentSnippetsSorted = [...currentSnippets].sort((a, b) => getSortKey(a).localeCompare(getSortKey(b)))
      const storedSnippetsSorted = [...storedData.snippets].sort((a, b) => getSortKey(a).localeCompare(getSortKey(b)))

      const currentDirectoriesSorted = [...currentDirectories].sort((a, b) =>
        getSortKey(a).localeCompare(getSortKey(b))
      )
      const storedDirectoriesSorted = [...storedData.directories].sort((a, b) =>
        getSortKey(a).localeCompare(getSortKey(b))
      )

      const currentJsonStr = JSON.stringify({
        snippets: currentSnippetsSorted,
        directories: currentDirectoriesSorted,
      })

      const storedJsonStr = JSON.stringify({
        snippets: storedSnippetsSorted,
        directories: storedDirectoriesSorted,
      })

      const hasChanges = currentJsonStr !== storedJsonStr

      console.log(`变更检测完成: ${hasChanges ? '有变更' : '无变更'}`)
      console.log(`当前数据: ${currentSnippets.length} 个代码片段, ${currentDirectories.length} 个目录`)
      console.log(`存储数据: ${storedData.snippets.length} 个代码片段, ${storedData.directories.length} 个目录`)

      return {
        hasChanges,
        type: hasChanges ? 'local_only' : 'none',
        details: hasChanges
          ? `检测到本地数据变更: ${currentSnippets.length} 个代码片段, ${currentDirectories.length} 个目录`
          : '没有检测到本地数据变更',
      }
    } catch (error) {
      console.warn('检测本地变更失败:', error)
      return {
        hasChanges: true, // 出错时假设有变更
        type: 'local_only',
        details: `检测变更时出错: ${error}`,
      }
    }
  }

  /**
   * 从Git仓库读取数据（真实文件存储版本）
   */
  public async readDataFromGitRepo(): Promise<{ snippets: CodeSnippet[]; directories: Directory[] }> {
    try {
      // 使用文件系统管理器读取真实文件存储的数据
      const fileSystemManager = new (await import('./fileSystemManager')).FileSystemManager()
      return await fileSystemManager.readFromGit()
    } catch (error) {
      console.warn('使用真实文件存储读取失败，尝试兼容旧JSON格式:', error)
      
      // 兼容旧的JSON格式
      return this.readDataFromGitRepoLegacy()
    }
  }
  
  /**
   * 从Git仓库读取数据（兼容旧JSON格式）
   */
  private readDataFromGitRepoLegacy(): { snippets: CodeSnippet[]; directories: Directory[] } {
    const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
    const snippetsFile = path.join(effectiveLocalPath, 'snippets.json')
    const directoriesFile = path.join(effectiveLocalPath, 'directories.json')

    let snippets: CodeSnippet[] = []
    let directories: Directory[] = []

    try {
      if (fs.existsSync(snippetsFile)) {
        const snippetsData = fs.readFileSync(snippetsFile, 'utf8')
        snippets = JSON.parse(snippetsData)
      }
    } catch (error) {
      console.warn('读取代码片段文件失败:', error)
    }

    try {
      if (fs.existsSync(directoriesFile)) {
        const directoriesData = fs.readFileSync(directoriesFile, 'utf8')
        directories = JSON.parse(directoriesData)
      }
    } catch (error) {
      console.warn('读取目录文件失败:', error)
    }

    return { snippets, directories }
  }

  /**
   * 检查代码片段内容差异
   */
  private hasSnippetContentDifference(local: CodeSnippet, remote: CodeSnippet): boolean {
    return (
      local.name !== remote.name ||
      local.code !== remote.code ||
      local.category !== remote.category ||
      local.language !== remote.language ||
      local.filePath !== remote.filePath ||
      local.fileName !== remote.fileName
    )
  }

  /**
   * 检查目录内容差异
   */
  private hasDirectoryContentDifference(local: Directory, remote: Directory): boolean {
    return local.name !== remote.name || local.fullPath !== remote.fullPath || local.order !== remote.order
  }

  /**
   * 检查VSCode数据是否与Git仓库数据不同
   */
  private checkIfVSCodeDataDiffersFromGit(
    vscodeSnippets: CodeSnippet[],
    vscodeDirectories: Directory[],
    gitSnippets: CodeSnippet[],
    gitDirectories: Directory[]
  ): boolean {
    // 使用相同的规范化逻辑进行比较
    const normalizeSnippetForComparison = (snippet: CodeSnippet) => ({
      name: snippet.name,
      code: snippet.code,
      language: snippet.language,
      fullPath: snippet.fullPath,
      filePath: snippet.filePath || '',
      category: snippet.category || ''
    })
    
    const normalizeDirectoryForComparison = (dir: Directory) => ({
      name: dir.name,
      fullPath: dir.fullPath
    })
    
    // 规范化并排序
    const vscodeNormalizedSnippets = vscodeSnippets
      .map(normalizeSnippetForComparison)
      .sort((a, b) => a.fullPath.localeCompare(b.fullPath))
    
    const vscodeNormalizedDirectories = vscodeDirectories
      .map(normalizeDirectoryForComparison)
      .sort((a, b) => a.fullPath.localeCompare(b.fullPath))
    
    const gitNormalizedSnippets = gitSnippets
      .map(normalizeSnippetForComparison)
      .sort((a, b) => a.fullPath.localeCompare(b.fullPath))
    
    const gitNormalizedDirectories = gitDirectories
      .map(normalizeDirectoryForComparison)
      .sort((a, b) => a.fullPath.localeCompare(b.fullPath))
    
    // 比较是否一致
    const snippetsMatch = JSON.stringify(vscodeNormalizedSnippets) === JSON.stringify(gitNormalizedSnippets)
    const directoriesMatch = JSON.stringify(vscodeNormalizedDirectories) === JSON.stringify(gitNormalizedDirectories)
    
    const hasDifference = !snippetsMatch || !directoriesMatch
    
    // 【调试】总是输出比较结果，不管是否有差异
    console.log('🔍 VSCode与Git仓库数据比较结果:')
    console.log(`   VSCode: ${vscodeSnippets.length} 个代码片段, ${vscodeDirectories.length} 个目录`)
    console.log(`   Git仓库: ${gitSnippets.length} 个代码片段, ${gitDirectories.length} 个目录`)
    console.log(`   代码片段一致: ${snippetsMatch}`)
    console.log(`   目录一致: ${directoriesMatch}`)
    console.log(`   是否有差异: ${hasDifference}`)
    
    // 详细分析每个代码片段的比较结果
    if (vscodeNormalizedSnippets.length > 0 || gitNormalizedSnippets.length > 0) {
      console.log('📋 详细代码片段比较:')
      for (let i = 0; i < Math.max(vscodeNormalizedSnippets.length, gitNormalizedSnippets.length); i++) {
        const vscodeSnippet = vscodeNormalizedSnippets[i]
        const gitSnippet = gitNormalizedSnippets[i]
        
        if (!vscodeSnippet) {
          console.log(`   ${i + 1}. Git额外: ${gitSnippet.fullPath}`)
        } else if (!gitSnippet) {
          console.log(`   ${i + 1}. VSCode额外: ${vscodeSnippet.fullPath}`)
        } else {
          const isIdentical = JSON.stringify(vscodeSnippet) === JSON.stringify(gitSnippet)
          console.log(`   ${i + 1}. 片段: ${vscodeSnippet.fullPath} - ${isIdentical ? '完全一致' : '有差异'}`)
          
          if (!isIdentical) {
            if (vscodeSnippet.name !== gitSnippet.name) {
              console.log(`       名称: "${vscodeSnippet.name}" vs "${gitSnippet.name}"`)
            }
            if (vscodeSnippet.language !== gitSnippet.language) {
              console.log(`       语言: "${vscodeSnippet.language}" vs "${gitSnippet.language}"`)
            }
            if (vscodeSnippet.code !== gitSnippet.code) {
              console.log(`       内容长度: ${vscodeSnippet.code?.length || 0} vs ${gitSnippet.code?.length || 0}`)
              // 显示开头和结尾的差异以便调试
              const vscodeStart = (vscodeSnippet.code || '').substring(0, 30)
              const gitStart = (gitSnippet.code || '').substring(0, 30)
              const vscodeEnd = (vscodeSnippet.code || '').slice(-30)
              const gitEnd = (gitSnippet.code || '').slice(-30)
              console.log(`       VSCode开头: "${vscodeStart}"`)
              console.log(`       Git开头:    "${gitStart}"`)
              console.log(`       VSCode结尾: "${vscodeEnd}"`)
              console.log(`       Git结尾:    "${gitEnd}"`)
              
              // 检查是否是开头空行差异
              if (vscodeSnippet.code?.charAt(0) !== gitSnippet.code?.charAt(0)) {
                console.log(`       ⚠️ 开头字符不同: VSCode="${vscodeSnippet.code?.charAt(0)}" vs Git="${gitSnippet.code?.charAt(0)}"`)
              }
            }
          }
        }
      }
    }
    
    return hasDifference
  }

  /**
   * 合并代码片段（使用fullPath作为唯一标识）
   * 修复删除同步问题：正确处理本地删除、远程删除和双向修改
   */
  private mergeSnippets(
    local: CodeSnippet[],
    remote: CodeSnippet[]
  ): {
    merged: CodeSnippet[]
    conflicts: Array<{
      id: string
      fullPath: string
      local: CodeSnippet
      remote: CodeSnippet
      resolution: 'use_local' | 'use_remote' | 'use_newer' | 'auto_merge' | 'manual_merge_required'
      needsManualMerge?: boolean
      conflictData?: {
        localContent: string
        remoteContent: string
        mergedContent?: string
      }
    }>
    additions: number
    manualMergeRequired: boolean
  } {
    const merged: CodeSnippet[] = []
    const conflicts: any[] = []
    let additions = 0
    let manualMergeRequired = false

    // 创建映射以便快速查找
    const localMap = new Map<string, CodeSnippet>()
    const remoteMap = new Map<string, CodeSnippet>()
    
    for (const snippet of local) {
      localMap.set(snippet.fullPath, snippet)
    }
    
    for (const snippet of remote) {
      remoteMap.set(snippet.fullPath, snippet)
    }
    
    // 获取所有唯一的路径
    const allPaths = new Set([...localMap.keys(), ...remoteMap.keys()])
    
    for (const fullPath of allPaths) {
      const localSnippet = localMap.get(fullPath)
      const remoteSnippet = remoteMap.get(fullPath)
      
      if (localSnippet && remoteSnippet) {
        // 两边都存在：检查是否有内容差异
        if (this.hasSnippetContentDifference(localSnippet, remoteSnippet)) {
          // 有内容差异，使用智能冲突解决器
          console.log(`检测到代码片段冲突: ${fullPath}`)
          console.log('本地内容:', localSnippet.code)
          console.log('远程内容:', remoteSnippet.code)
          
          const conflictResult = this.conflictResolver.resolveSnippetConflict(localSnippet, remoteSnippet)
          console.log('冲突解决结果:', conflictResult.strategy)

          conflicts.push({
            id: fullPath,
            fullPath: fullPath,
            local: localSnippet,
            remote: remoteSnippet,
            resolution: conflictResult.strategy,
            needsManualMerge: conflictResult.needsManualMerge || false,
            conflictData: conflictResult.conflictData,
          })

          if (conflictResult.needsManualMerge) {
            manualMergeRequired = true
            // 暂时保留本地版本，等待用户手动解决
            merged.push(localSnippet)
          } else {
            // 自动解决，使用解决后的版本
            // 【修复】如果解决策略是 use_newer 且内容相同，优先保留本地对象以避免重复
            if (conflictResult.strategy === 'use_newer' && localSnippet.code === remoteSnippet.code) {
              console.log('内容相同但选择了较新版本，保留本地对象以避免重复')
              merged.push(localSnippet)
            } else {
              merged.push(conflictResult.resolved)
            }
          }
        } else {
          // 没有差异，保留本地版本（本地和远程内容相同）
          merged.push(localSnippet)
        }
      } else if (localSnippet && !remoteSnippet) {
        // 仅本地存在：本地新增或远程删除
        // 在智能合并中，我们倾向于保留本地修改（包括新增）
        console.log(`本地独有的代码片段: ${fullPath}`)
        merged.push(localSnippet)
      } else if (!localSnippet && remoteSnippet) {
        // 仅远程存在：远程新增或本地删除
        // 需要判断这是远程新增还是本地删除
        // 在智能合并中，我们倾向于保留远程新增的内容
        console.log(`远程独有的代码片段: ${fullPath}`)
        merged.push(remoteSnippet)
        additions++
      }
      // 注意：如果两边都不存在，说明数据有问题，但这种情况不应该发生
    }

    return {
      merged,
      conflicts,
      additions,
      manualMergeRequired,
    }
  }

  /**
   * 合并目录（使用fullPath作为唯一标识）
   * 修复删除同步问题：正确处理本地删除、远程删除和双向修改
   */
  private mergeDirectories(
    local: Directory[],
    remote: Directory[]
  ): {
    merged: Directory[]
    conflicts: Array<{
      id: string
      fullPath: string
      local: Directory
      remote: Directory
      resolution: 'use_local' | 'use_remote' | 'use_newer'
      needsManualMerge?: boolean
    }>
    additions: number
    manualMergeRequired: boolean
  } {
    const merged: Directory[] = []
    const conflicts: any[] = []
    let additions = 0

    // 创建映射以便快速查找
    const localMap = new Map<string, Directory>()
    const remoteMap = new Map<string, Directory>()
    
    for (const directory of local) {
      localMap.set(directory.fullPath, directory)
    }
    
    for (const directory of remote) {
      remoteMap.set(directory.fullPath, directory)
    }
    
    // 获取所有唯一的路径
    const allPaths = new Set([...localMap.keys(), ...remoteMap.keys()])
    
    for (const fullPath of allPaths) {
      const localDirectory = localMap.get(fullPath)
      const remoteDirectory = remoteMap.get(fullPath)
      
      if (localDirectory && remoteDirectory) {
        // 两边都存在：检查是否有内容差异
        if (this.hasDirectoryContentDifference(localDirectory, remoteDirectory)) {
          // 【修复】有内容差异时，优先保护本地数据
          const resolution = 'use_local' // 默认保护本地数据

          conflicts.push({
            id: fullPath,
            fullPath: fullPath,
            local: localDirectory,
            remote: remoteDirectory,
            resolution,
            needsManualMerge: false,
          })

          merged.push(localDirectory) // 保护本地数据
        } else {
          // 没有差异，保留本地版本（本地和远程内容相同）
          merged.push(localDirectory)
        }
      } else if (localDirectory && !remoteDirectory) {
        // 仅本地存在：本地新增或远程删除
        // 在智能合并中，我们倾向于保留本地修改（包括新增）
        console.log(`本地独有的目录: ${fullPath}`)
        merged.push(localDirectory)
      } else if (!localDirectory && remoteDirectory) {
        // 仅远程存在：远程新增或本地删除
        // 在智能合并中，我们倾向于保留远程新增的内容
        console.log(`远程独有的目录: ${fullPath}`)
        merged.push(remoteDirectory)
        additions++
      }
      // 注意：如果两边都不存在，说明数据有问题，但这种情况不应该发生
    }

    return {
      merged,
      conflicts,
      additions,
      manualMergeRequired: false,
    }
  }

  /**
   * 检查变更集是否包含变更
   */
  public hasChanges(changeSet: any): boolean {
    if (typeof changeSet === 'object' && changeSet.hasChanges !== undefined) {
      return changeSet.hasChanges
    }

    // 兼容旧格式
    return (
      changeSet.addedFiles?.length > 0 ||
      changeSet.modifiedFiles?.length > 0 ||
      changeSet.deletedFiles?.length > 0 ||
      changeSet.addedDirectories?.length > 0 ||
      changeSet.deletedDirectories?.length > 0
    )
  }

  /**
   * 更新同步状态
   */
  public async updateSyncStatus(success: boolean, message?: string): Promise<void> {
    const status = SettingsManager.getCloudSyncStatus()
    status.isSyncing = false
    status.lastSyncTime = Date.now()
    status.isConnected = success
    
    if (success) {
      // 同步成功时，总是清除错误状态
      status.lastError = null
    } else {
      // 同步失败时，设置错误信息
      status.lastError = message || '同步失败'
    }
    
    await SettingsManager.saveCloudSyncStatus(status)
  }

  /**
   * 开始同步状态
   */
  public async startSyncStatus(): Promise<void> {
    const status = SettingsManager.getCloudSyncStatus()
    status.isSyncing = true
    await SettingsManager.saveCloudSyncStatus(status)
  }

  /**
   * 【新增】安全的VSCode存储更新策略
   * 实现增量更新而非全量替换，提供原子性操作保证和回滚机制
   */
  private async performSafeStorageUpdate(snippets: CodeSnippet[], directories: Directory[]): Promise<{ success: boolean; error?: string }> {
    if (!this.storageManager) {
      return { success: false, error: 'StorageManager 未初始化' }
    }

    let backupData: { snippets: CodeSnippet[]; directories: Directory[] } | null = null
    
    try {
      console.log(`🔄 开始安全的VSCode存储更新...`)
      
      // 【步骤1】创建当前数据的备份
      console.log(`📦 创建数据备份...`)
      try {
        const existingSnippets = await this.storageManager.getAllSnippets()
        const existingDirectories = await this.storageManager.getAllDirectories()
        backupData = {
          snippets: [...existingSnippets],
          directories: [...existingDirectories]
        }
        console.log(`   备份完成: ${backupData.snippets.length} 个代码片段, ${backupData.directories.length} 个目录`)
      } catch (backupError) {
        console.error(`❌ 创建备份失败:`, backupError)
        return { success: false, error: `备份失败: ${backupError instanceof Error ? backupError.message : '未知错误'}` }
      }
      
      // 【步骤2】分析需要的变更操作
      console.log(`🔍 分析存储变更...`)
      const changeSet = await this.analyzeStorageChanges(backupData.snippets, backupData.directories, snippets, directories)
      
      console.log(`📊 变更分析结果:`)
      console.log(`   代码片段: 新增${changeSet.snippetsToAdd.length}, 更新${changeSet.snippetsToUpdate.length}, 删除${changeSet.snippetsToDelete.length}`)
      console.log(`   目录: 新增${changeSet.directoriesToAdd.length}, 更新${changeSet.directoriesToUpdate.length}, 删除${changeSet.directoriesToDelete.length}`)
      
      // 【步骤3】按照安全的顺序执行变更
      console.log(`🔧 开始执行增量变更...`)
      
      // 3.1 首先处理目录（目录变更通常风险较低）
      await this.applyDirectoryChanges(changeSet)
      
      // 3.2 然后处理代码片段变更
      await this.applySnippetChanges(changeSet)
      
      // 【步骤4】验证更新结果
      console.log(`✅ 验证更新结果...`)
      const validationResult = await this.validateStorageUpdate(snippets, directories)
      
      if (!validationResult.isValid) {
        console.error(`❌ 存储更新验证失败: ${validationResult.reason}`)
        
        // 验证失败，启动回滚
        console.log(`🔄 开始回滚操作...`)
        await this.rollbackStorageChanges(backupData)
        
        return { success: false, error: `更新验证失败: ${validationResult.reason}` }
      }
      
      console.log(`✅ VSCode存储更新成功`)
      return { success: true }
      
    } catch (error) {
      console.error(`❌ VSCode存储更新过程出错:`, error)
      
      // 发生异常，尝试回滚
      if (backupData) {
        console.log(`🔄 异常情况，开始回滚操作...`)
        try {
          await this.rollbackStorageChanges(backupData)
          console.log(`✅ 回滚操作完成`)
        } catch (rollbackError) {
          console.error(`❌ 回滚操作也失败:`, rollbackError)
          return { 
            success: false, 
            error: `更新失败且回滚失败: 原始错误=${error instanceof Error ? error.message : '未知错误'}, 回滚错误=${rollbackError instanceof Error ? rollbackError.message : '未知错误'}` 
          }
        }
      }
      
      return { success: false, error: error instanceof Error ? error.message : '未知错误' }
    }
  }

  /**
   * 【新增】分析存储变更需求
   */
  private async analyzeStorageChanges(
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[],
    targetSnippets: CodeSnippet[],
    targetDirectories: Directory[]
  ): Promise<{
    snippetsToAdd: CodeSnippet[]
    snippetsToUpdate: CodeSnippet[]
    snippetsToDelete: CodeSnippet[]
    directoriesToAdd: Directory[]
    directoriesToUpdate: Directory[]
    directoriesToDelete: Directory[]
  }> {
    
    console.log('🔍 开始分析存储变更...')
    console.log(`   当前片段: ${currentSnippets.length} 个`)
    currentSnippets.forEach((s, i) => {
      console.log(`     ${i + 1}. ${s.fullPath} (名称: ${s.name}, 创建时间: ${s.createTime})`)
    })
    console.log(`   目标片段: ${targetSnippets.length} 个`)
    targetSnippets.forEach((s, i) => {
      console.log(`     ${i + 1}. ${s.fullPath} (名称: ${s.name}, 创建时间: ${s.createTime})`)
    })
    
    // 分析代码片段变更
    const snippetsToAdd: CodeSnippet[] = []
    const snippetsToUpdate: CodeSnippet[] = []
    const snippetsToDelete: CodeSnippet[] = [...currentSnippets] // 先假设全部要删除
    
    for (const targetSnippet of targetSnippets) {
      console.log(`🔍 分析目标片段: ${targetSnippet.fullPath}`)
      
      // 【修复】优先通过fullPath匹配，如果不匹配则尝试通过name和filePath匹配
      let currentSnippet = currentSnippets.find(s => s.fullPath === targetSnippet.fullPath)
      console.log(`   通过fullPath匹配: ${currentSnippet ? '找到' : '未找到'}`)
      
      // 【新增】如果通过fullPath找不到，尝试通过name和文件路径匹配（处理路径映射问题）
      if (!currentSnippet) {
        currentSnippet = currentSnippets.find(s => 
          s.name === targetSnippet.name && 
          s.filePath === targetSnippet.filePath
        )
        console.log(`   通过name+filePath匹配: ${currentSnippet ? '找到' : '未找到'}`)
        
        // 如果找到了匹配的片段，记录路径映射修复
        if (currentSnippet) {
          console.log(`🔧 检测到路径映射变化: "${currentSnippet.fullPath}" -> "${targetSnippet.fullPath}"`)
        }
      }
      
      // 【新增】如果还是找不到，尝试通过name匹配（最后的尝试）
      if (!currentSnippet) {
        currentSnippet = currentSnippets.find(s => s.name === targetSnippet.name)
        console.log(`   通过name匹配: ${currentSnippet ? '找到' : '未找到'}`)
        
        if (currentSnippet) {
          console.log(`🔧 检测到名称匹配但路径不同: "${currentSnippet.fullPath}" vs "${targetSnippet.fullPath}"`)
        }
      }
      
      if (!currentSnippet) {
        // 新增
        console.log(`   ➕ 决策: 新增片段`)
        snippetsToAdd.push(targetSnippet)
      } else {
        // 检查是否需要更新
        if (this.hasSnippetContentDifference(currentSnippet, targetSnippet)) {
          console.log(`   🔄 决策: 更新片段 (检测到内容差异)`)
          snippetsToUpdate.push(targetSnippet)
        } else {
          console.log(`   ✅ 决策: 无需更新 (内容相同)`)
        }
        
        // 从删除列表中移除（因为目标中存在）
        // 【修复】使用相同的匹配逻辑来找到要移除的项
        const deleteIndex = snippetsToDelete.findIndex((s: CodeSnippet) => 
          s.fullPath === currentSnippet!.fullPath
        )
        if (deleteIndex >= 0) {
          console.log(`   🔄 从删除列表移除: ${snippetsToDelete[deleteIndex].fullPath}`)
          snippetsToDelete.splice(deleteIndex, 1)
        }
      }
    }
    
    // 分析目录变更
    const directoriesToAdd: Directory[] = []
    const directoriesToUpdate: Directory[] = []
    const directoriesToDelete: Directory[] = [...currentDirectories] // 先假设全部要删除
    
    for (const targetDirectory of targetDirectories) {
      const currentDirectory = currentDirectories.find(d => d.fullPath === targetDirectory.fullPath)
      
      if (!currentDirectory) {
        // 新增
        directoriesToAdd.push(targetDirectory)
      } else {
        // 检查是否需要更新
        if (this.hasDirectoryContentDifference(currentDirectory, targetDirectory)) {
          directoriesToUpdate.push(targetDirectory)
        }
        
        // 从删除列表中移除（因为目标中存在）
        const deleteIndex = directoriesToDelete.findIndex((d: Directory) => d.fullPath === targetDirectory.fullPath)
        if (deleteIndex >= 0) {
          directoriesToDelete.splice(deleteIndex, 1)
        }
      }
    }
    
    console.log('📊 变更分析完成:')
    console.log(`   代码片段: 新增${snippetsToAdd.length}, 更新${snippetsToUpdate.length}, 删除${snippetsToDelete.length}`)
    console.log(`   目录: 新增${directoriesToAdd.length}, 更新${directoriesToUpdate.length}, 删除${directoriesToDelete.length}`)
    
    return {
      snippetsToAdd,
      snippetsToUpdate,
      snippetsToDelete,
      directoriesToAdd,
      directoriesToUpdate,
      directoriesToDelete
    }
  }

  /**
   * 【新增】应用目录变更
   */
  private async applyDirectoryChanges(changeSet: {
    directoriesToAdd: Directory[]
    directoriesToUpdate: Directory[]
    directoriesToDelete: Directory[]
  }): Promise<void> {
    if (!this.storageManager) {
      throw new Error('StorageManager 未初始化')
    }

    // 首先创建新目录
    for (const directory of changeSet.directoriesToAdd) {
      console.log(`➕ 创建目录: ${directory.fullPath}`)
      await this.storageManager.createDirectory(directory)
    }
    
    // 然后更新现有目录
    for (const directory of changeSet.directoriesToUpdate) {
      console.log(`🔄 更新目录: ${directory.fullPath}`)
      await this.storageManager.updateDirectory(directory)
    }
    
    // 最后删除不需要的目录
    for (const directory of changeSet.directoriesToDelete) {
      console.log(`🗑️ 删除目录: ${directory.fullPath}`)
      await this.storageManager.deleteDirectory(directory.fullPath)
    }
  }

  /**
   * 【新增】应用代码片段变更
   */
  private async applySnippetChanges(changeSet: {
    snippetsToAdd: CodeSnippet[]
    snippetsToUpdate: CodeSnippet[]
    snippetsToDelete: CodeSnippet[]
  }): Promise<void> {
    if (!this.storageManager) {
      throw new Error('StorageManager 未初始化')
    }

    // 【调试】在开始前记录当前存储状态
    console.log('🔍 存储更新前的状态检查...')
    const beforeSnippets = await this.storageManager.getAllSnippets()
    console.log(`   当前存储中有 ${beforeSnippets.length} 个代码片段:`)
    beforeSnippets.forEach((s, i) => {
      console.log(`     ${i + 1}. ${s.fullPath} (名称: ${s.name}, 创建时间: ${s.createTime})`)
    })

    // 首先删除不需要的代码片段（避免fullPath冲突）
    for (const snippet of changeSet.snippetsToDelete) {
      console.log(`🗑️ 删除代码片段: ${snippet.fullPath}`)
      await this.storageManager.deleteSnippet(snippet.fullPath)
    }
    
    // 然后更新现有代码片段
    for (const snippet of changeSet.snippetsToUpdate) {
      console.log(`🔄 更新代码片段: ${snippet.fullPath} (名称: ${snippet.name})`)
      
      // 【调试】检查更新前的状态
      const beforeUpdate = await this.storageManager.getAllSnippets()
      const existingSnippet = beforeUpdate.find(s => s.fullPath === snippet.fullPath)
      
      if (existingSnippet) {
        console.log(`   找到现有片段: 创建时间=${existingSnippet.createTime}, 内容长度=${(existingSnippet.code || '').length}`)
        console.log(`   新片段信息: 创建时间=${snippet.createTime}, 内容长度=${(snippet.code || '').length}`)
      } else {
        console.log(`   ⚠️ 警告: 在存储中未找到路径为 ${snippet.fullPath} 的现有片段`)
        console.log(`   当前存储中的片段路径: ${beforeUpdate.map(s => s.fullPath).join(', ')}`)
      }
      
      // 【修复】先显式删除现有片段，再保存新片段，避免重复
      try {
        await this.storageManager.deleteSnippet(snippet.fullPath)
        console.log(`   ✅ 已删除旧片段: ${snippet.fullPath}`)
      } catch (deleteError) {
        console.log(`   ⚠️ 删除旧片段失败（可能不存在）: ${deleteError}`)
      }
      
      await this.storageManager.saveSnippet(snippet)
      console.log(`   ✅ 已保存新片段: ${snippet.fullPath}`)
      
      // 【调试】检查更新后的状态
      const afterUpdate = await this.storageManager.getAllSnippets()
      const matchingSnippets = afterUpdate.filter(s => s.fullPath === snippet.fullPath)
      
      if (matchingSnippets.length > 1) {
        console.log(`   ❌ 检测到重复片段! 路径 ${snippet.fullPath} 有 ${matchingSnippets.length} 个副本:`)
        matchingSnippets.forEach((s, i) => {
          console.log(`     ${i + 1}. 创建时间: ${s.createTime}, 内容: ${(s.code || '').substring(0, 50)}...`)
        })
      } else if (matchingSnippets.length === 1) {
        console.log(`   ✅ 更新成功，路径 ${snippet.fullPath} 只有1个片段`)
      } else {
        console.log(`   ❌ 更新失败，路径 ${snippet.fullPath} 的片段丢失`)
      }
    }
    
    // 最后保存新的代码片段
    for (const snippet of changeSet.snippetsToAdd) {
      console.log(`➕ 创建代码片段: ${snippet.fullPath} (名称: ${snippet.name})`)
      await this.storageManager.saveSnippet(snippet)
    }
    
    // 【调试】在结束后记录最终状态
    console.log('🔍 存储更新后的状态检查...')
    const afterSnippets = await this.storageManager.getAllSnippets()
    console.log(`   最终存储中有 ${afterSnippets.length} 个代码片段:`)
    afterSnippets.forEach((s, i) => {
      console.log(`     ${i + 1}. ${s.fullPath} (名称: ${s.name}, 创建时间: ${s.createTime})`)
    })
  }

  /**
   * 【新增】验证VSCode存储更新结果
   */
  private async validateStorageUpdate(
    expectedSnippets: CodeSnippet[],
    expectedDirectories: Directory[]
  ): Promise<{ isValid: boolean; reason: string }> {
    if (!this.storageManager) {
      return { isValid: false, reason: 'StorageManager 未初始化' }
    }

    try {
      // 验证代码片段
      const actualSnippets = await this.storageManager.getAllSnippets()
      const actualDirectories = await this.storageManager.getAllDirectories()
      
      // 检查数量
      if (actualSnippets.length !== expectedSnippets.length) {
        // 【增强】提供更详细的诊断信息
        console.log('📊 期望的代码片段:')
        expectedSnippets.forEach((s, i) => {
          console.log(`   ${i + 1}. ${s.fullPath} (名称: ${s.name})`)
        })
        
        console.log('📊 实际的代码片段:')
        actualSnippets.forEach((s, i) => {
          console.log(`   ${i + 1}. ${s.fullPath} (名称: ${s.name})`)
        })
        
        // 找出重复的片段
        const duplicateChecks = new Map<string, CodeSnippet[]>()
        actualSnippets.forEach(s => {
          const key = s.fullPath
          if (!duplicateChecks.has(key)) {
            duplicateChecks.set(key, [])
          }
          duplicateChecks.get(key)!.push(s)
        })
        
        const duplicates = Array.from(duplicateChecks.entries()).filter(([_, snippets]) => snippets.length > 1)
        if (duplicates.length > 0) {
          console.log('🔍 发现重复的代码片段:')
          duplicates.forEach(([fullPath, snippets]) => {
            console.log(`   路径: ${fullPath}, 重复数量: ${snippets.length}`)
            snippets.forEach((s, i) => {
              console.log(`     ${i + 1}. 名称: ${s.name}, 创建时间: ${s.createTime}`)
            })
          })
        }
        
        return {
          isValid: false,
          reason: `代码片段数量不匹配: 期望${expectedSnippets.length}, 实际${actualSnippets.length}${duplicates.length > 0 ? `, 发现${duplicates.length}个重复片段` : ''}`
        }
      }
      
      if (actualDirectories.length !== expectedDirectories.length) {
        return {
          isValid: false,
          reason: `目录数量不匹配: 期望${expectedDirectories.length}, 实际${actualDirectories.length}`
        }
      }
      
      // 验证每个代码片段是否存在
      for (const expectedSnippet of expectedSnippets) {
        const actualSnippet = actualSnippets.find(s => s.fullPath === expectedSnippet.fullPath)
        if (!actualSnippet) {
          return {
            isValid: false,
            reason: `代码片段不存在: ${expectedSnippet.fullPath}`
          }
        }
        
        // 验证关键字段
        if (actualSnippet.code !== expectedSnippet.code) {
          return {
            isValid: false,
            reason: `代码片段内容不匹配: ${expectedSnippet.fullPath}`
          }
        }
      }
      
      // 验证每个目录是否存在
      for (const expectedDirectory of expectedDirectories) {
        const actualDirectory = actualDirectories.find(d => d.fullPath === expectedDirectory.fullPath)
        if (!actualDirectory) {
          return {
            isValid: false,
            reason: `目录不存在: ${expectedDirectory.fullPath}`
          }
        }
      }
      
      return { isValid: true, reason: '验证通过' }
      
    } catch (error) {
      return {
        isValid: false,
        reason: `验证过程出错: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 【新增】回滚VSCode存储更改
   */
  private async rollbackStorageChanges(backupData: { snippets: CodeSnippet[]; directories: Directory[] }): Promise<void> {
    if (!this.storageManager) {
      throw new Error('StorageManager 未初始化')
    }

    try {
      console.log(`🔄 开始回滚VSCode存储更改...`)
      
      // 先清理当前数据
      const currentSnippets = await this.storageManager.getAllSnippets()
      const currentDirectories = await this.storageManager.getAllDirectories()
      
      // 删除所有当前代码片段
      for (const snippet of currentSnippets) {
        await this.storageManager.deleteSnippet(snippet.fullPath)
      }
      
      // 删除所有当前目录
      for (const directory of currentDirectories) {
        await this.storageManager.deleteDirectory(directory.fullPath)
      }
      
      // 恢复备份数据
      for (const directory of backupData.directories) {
        await this.storageManager.createDirectory(directory)
      }
      
      for (const snippet of backupData.snippets) {
        await this.storageManager.saveSnippet(snippet)
      }
      
      console.log(`✅ 回滚完成: 恢复了 ${backupData.snippets.length} 个代码片段和 ${backupData.directories.length} 个目录`)
      
    } catch (error) {
      console.error(`❌ 回滚过程出错:`, error)
      throw error
    }
  }

  /**
   * 【新增】特殊处理本地仓库被删除后的重新初始化场景
   * 策略：优先拉取远程数据，然后将本地数据作为新提交合并到远程
   * 【重要】添加用户确认机制以保护本地数据
   */
  private async performReinitializedSync(
    localSnippets: CodeSnippet[],
    localDirectories: Directory[],
    remoteCheckResult: RemoteCheckResult,
    gitOpsManager: any,
    fileSystemManager: any,
    options?: {
      forceSmartMerge?: boolean
      forceUseLocal?: boolean
      forceUseRemote?: boolean
    }
  ): Promise<SyncResult> {
    try {
      console.log('🔄 执行重新初始化同步策略：先拉取远程 → 然后合并本地数据...')

      // 【安全检查】如果有本地数据，给用户警告和选择
      const localDataCount = localSnippets.length + localDirectories.length
      if (localDataCount > 0 && remoteCheckResult.remoteHasData && !options?.forceSmartMerge && !options?.forceUseLocal && !options?.forceUseRemote) {
        console.log(`⚠️ 安全检查: 发现本地有 ${localDataCount} 项数据，远程也有数据`)
        
        // 这里应该弹出用户确认对话框，但在数据同步管理器中无法直接调用VSCode UI
        // 所以我们返回一个特殊的结果，让上层处理用户确认
        return {
          success: false,
          message: `⚠️ 检测到数据冲突风险！\n\n本地VSCode中有 ${localSnippets.length} 个代码片段和 ${localDirectories.length} 个目录\n远程仓库也包含数据\n\n为保护您的数据，建议：\n1. 先备份本地数据\n2. 或使用"智能合并"选项\n3. 或手动解决冲突\n\n请选择适当的同步策略。`,
          needsUserConfirmation: true,
          localDataInfo: {
            snippets: localSnippets.length,
            directories: localDirectories.length
          }
        }
      }

      // 根据用户选择的强制选项执行相应策略
      if (options?.forceUseRemote) {
        console.log('🔄 强制使用远程数据模式...')
        // 拉取远程数据并覆盖本地
        await gitOpsManager.gitFetch()
        await gitOpsManager.gitPull()
        
        const remoteData = await fileSystemManager.readFromGit()
        
        if (this.storageManager) {
          await this.performSafeStorageUpdate(remoteData.snippets, remoteData.directories)
        }
        
        return {
          success: true,
          message: '✅ 已使用远程数据覆盖本地数据'
        }
      }
      
      if (options?.forceUseLocal) {
        console.log('🔄 强制使用本地数据模式...')
        // 直接用本地数据覆盖远程，跳过合并
        await fileSystemManager.writeToGit(localSnippets, localDirectories)
        
        // 【修复】强制添加所有文件，确保强制本地模式的变更被正确提交
        await gitOpsManager.gitAddAll()
        
        const statusAfterStaging = await gitOpsManager.gitStatus()
        const hasChangesToCommit = statusAfterStaging.staged.length > 0 || 
                                 statusAfterStaging.created.length > 0 || 
                                 statusAfterStaging.modified.length > 0 || 
                                 statusAfterStaging.deleted.length > 0 ||
                                 statusAfterStaging.renamed.length > 0
        
        if (hasChangesToCommit) {
          await gitOpsManager.gitCommit(`强制使用本地数据: ${new Date().toLocaleString()}`)
          await gitOpsManager.gitPush()
        } else {
          console.log('🔍 强制本地模式：暂存区无变更，可能数据已一致')
          // 即使没有新提交，也要确保推送现有的本地提交
          try {
            await gitOpsManager.gitPush()
          } catch (pushError) {
            // 如果推送失败且原因是没有变更，这是正常的
            const errorMessage = pushError instanceof Error ? pushError.message : '未知错误'
            if (!errorMessage.includes('up to date') && !errorMessage.includes('up-to-date')) {
              throw pushError
            }
          }
        }
        
        return {
          success: true,
          message: '✅ 已使用本地数据覆盖远程数据'
        }
      }

      // 【重新初始化策略】步骤1: 先尝试拉取整个远程仓库
      if (remoteCheckResult.remoteHasData && !remoteCheckResult.isRemoteEmpty) {
        console.log('📥 步骤1: 优先拉取整个远程仓库...')
        
        try {
          // 先获取远程数据
          await gitOpsManager.gitFetch()
          console.log('✅ 远程数据获取成功')
          
          // 检查是否有远程更新需要合并
          const remoteUpdates = await gitOpsManager.checkRemoteUpdates()
          
          if (remoteUpdates.hasUpdates) {
            console.log(`📥 检测到远程更新，开始拉取: ${remoteUpdates.details}`)
            
            // 执行 Git Pull 拉取远程数据
            await gitOpsManager.gitPull()
            console.log('✅ 远程数据拉取成功')
            
            // 【重要修改】不直接覆盖VSCode数据，而是进行智能合并
            const remoteData = await fileSystemManager.readFromGit()
            
            console.log('🔀 开始智能合并远程数据和本地数据...')
            const mergeResult = await this.performIntelligentMerge(
              localSnippets,
              localDirectories,
              remoteData.snippets,
              remoteData.directories
            )
            
            if (!mergeResult.success) {
              return {
                success: false,
                message: `智能合并失败: ${mergeResult.message}`,
                conflictsDetected: mergeResult.conflictsDetected
              }
            }
            
            // 如果需要更新VSCode，应用合并结果
            if (mergeResult.needsVSCodeUpdate && this.storageManager) {
              console.log('🔄 应用智能合并结果到VSCode工作区...')
              const updateResult = await this.performSafeStorageUpdate(
                mergeResult.mergedSnippets, 
                mergeResult.mergedDirectories
              )
              
              if (!updateResult.success) {
                console.warn('⚠️ 智能合并结果应用失败:', updateResult.error)
                return {
                  success: false,
                  message: `智能合并成功但应用到VSCode失败: ${updateResult.error}`,
                }
              }
              console.log('✅ 智能合并结果已成功应用到VSCode')
            }
          }
          
        } catch (pullError) {
          console.error('❌ 拉取远程数据失败:', pullError)
          const errorMessage = pullError instanceof Error ? pullError.message : '未知错误'
          
          // 如果是合并冲突，提供处理建议
          if (errorMessage.includes('conflict') || errorMessage.includes('CONFLICT')) {
            return {
              success: false,
              message: `拉取远程数据时发生冲突: ${errorMessage}\n\n建议操作：\n1. 手动解决冲突后重新同步\n2. 或使用"重新初始化仓库"功能`,
              conflictsDetected: true,
              conflictDetails: [errorMessage]
            }
          }
          
          // 如果是其他错误，但用户选择取消重新初始化，给出建议
          if (errorMessage.includes('用户取消了重新初始化操作')) {
            return {
              success: false,
              message: `拉取远程变更失败: ${errorMessage}\n\n建议：\n1. 检查远程仓库是否正确\n2. 手动删除本地仓库目录后重新同步\n3. 或者联系技术支持`,
            }
          }
          
          throw pullError
        }
      } else {
        console.log('📝 远程仓库为空或不存在，跳过远程数据拉取')
      }

      // 【重新初始化策略】步骤2: 将当前VSCode本地数据作为新提交合并到远程
      console.log('💾 步骤2: 将本地VSCode数据作为新提交合并到远程...')
      
      // 将当前VSCode中的数据写入Git工作区
      await fileSystemManager.writeToGit(localSnippets, localDirectories)
      
      // 【修复】强制添加所有文件，确保重新初始化的变更被正确提交
      console.log('📝 强制添加所有文件到Git暂存区...')
      await gitOpsManager.gitAddAll()
      
      // 检查暂存区是否有变更需要提交
      const statusAfterStaging = await gitOpsManager.gitStatus()
      const hasChangesToCommit = statusAfterStaging.staged.length > 0 || 
                               statusAfterStaging.created.length > 0 || 
                               statusAfterStaging.modified.length > 0 || 
                               statusAfterStaging.deleted.length > 0 ||
                               statusAfterStaging.renamed.length > 0
      
      if (hasChangesToCommit) {
        console.log(`   检测到需要提交的暂存更改`)
        
        // 创建合并提交
        const commitMessage = `重新初始化后合并本地数据: ${new Date().toLocaleString()}`
        await gitOpsManager.gitCommit(commitMessage)
        console.log(`✅ 已创建合并提交: ${commitMessage}`)
      } else {
        console.log('✅ 暂存区无变更，本地数据与Git仓库一致')
      }

      // 【重新初始化策略】步骤3: 推送合并结果到远程
      console.log('📤 步骤3: 推送合并结果到远程...')
      
      try {
        await gitOpsManager.gitPush()
        console.log('✅ 成功推送合并结果到远程')
      } catch (pushError) {
        console.error('❌ 推送失败:', pushError)
        return {
          success: false,
          message: `推送失败: ${pushError instanceof Error ? pushError.message : '未知错误'}`,
        }
      }

      // 构建成功消息
      let successMessage = '✅ 重新初始化同步完成！'
      
      if (remoteCheckResult.remoteHasData && hasChangesToCommit) {
        successMessage = '✅ 远程数据已拉取，本地更改已成功合并并推送'
      } else if (remoteCheckResult.remoteHasData && !hasChangesToCommit) {
        successMessage = '✅ 远程数据已拉取并导入，本地数据保持一致'
      } else if (!remoteCheckResult.remoteHasData && hasChangesToCommit) {
        successMessage = '✅ 本地数据已成功推送到空的远程仓库'
      } else {
        successMessage = '✅ 仓库状态已同步，无需额外操作'
      }

      return {
        success: true,
        message: successMessage,
        autoMerged: remoteCheckResult.remoteHasData,
        conflictsDetected: false
      }
      
    } catch (error) {
      console.error('❌ 重新初始化同步失败:', error)
      return {
        success: false,
        message: `重新初始化同步失败: ${error instanceof Error ? error.message : '未知错误'}`,
      }
    }
  }

  /**
   * 【新增】检测本地仓库是否被删除并重新初始化
   * 检测条件（更加严格以保护用户数据）：
   * 1. 本地Git历史记录很少（提交数量 < 3）
   * 2. 并且远程仓库有数据
   * 3. 并且本地工作区为空或只有基础文件
   * 4. 【重要】并且用户VSCode中没有大量本地数据
   */
  private async detectRepositoryReinitialization(gitOpsManager: any, remoteCheckResult: RemoteCheckResult): Promise<boolean> {
    try {
      console.log('🔍 检测本地仓库是否被删除并重新初始化...')

      // 检查本地Git历史记录
      const git = await gitOpsManager.getGitInstance()
      let localCommitCount = 0
      
      try {
        const logResult = await git.log()
        localCommitCount = logResult.total
        console.log(`   本地提交数量: ${localCommitCount}`)
      } catch (logError) {
        console.log('   无法获取本地提交历史，可能是全新仓库')
        localCommitCount = 0
      }

      // 检查本地工作区文件
      const gitStatus = await gitOpsManager.gitStatus()
      const hasLocalFiles = gitStatus.files.length > 0
      console.log(`   本地工作区文件数量: ${gitStatus.files.length}`)

      // 【新增】检查VSCode中的本地数据量（重要的保护机制）
      let localVSCodeDataCount = 0
      if (this.storageManager) {
        try {
          const [localSnippets, localDirectories] = await Promise.all([
            this.storageManager.getAllSnippets(),
            this.storageManager.getAllDirectories()
          ])
          localVSCodeDataCount = localSnippets.length + localDirectories.length
          console.log(`   VSCode本地数据量: ${localSnippets.length} 个代码片段 + ${localDirectories.length} 个目录 = ${localVSCodeDataCount} 项`)
        } catch (error) {
          console.warn('无法获取VSCode本地数据量:', error)
        }
      }

      // 检查远程仓库状态
      if (remoteCheckResult.remoteHasData) {
        console.log('   远程仓库: 有数据')
        
        // 【重要保护逻辑】如果用户VSCode中有大量本地数据（>= 5项），
        // 即使Git仓库是新建的，也不应该直接覆盖，而应该使用智能合并
        if (localVSCodeDataCount >= 5) {
          console.log('🛡️ 检测结果: 发现大量本地VSCode数据，为保护用户数据使用标准同步流程')
          console.log(`   理由: VSCode中有 ${localVSCodeDataCount} 项本地数据，需要智能合并而不是直接覆盖`)
          return false // 使用标准同步流程，会进行智能合并
        }
        
        // 【修复】大幅提高重新初始化的检测门槛，保护用户数据
        // 只有在以下极其严格的条件下才认为是重新初始化：
        // 1. 本地完全没有提交历史（0个提交）
        // 2. 并且VSCode中没有任何数据（0项）
        // 3. 并且工作区完全为空
        if (localCommitCount === 0 && !hasLocalFiles && localVSCodeDataCount === 0) {
          console.log('🔄 检测结果: 确认为全新仓库重新初始化')
          console.log(`   理由: 本地无提交(${localCommitCount})，工作区为空，VSCode无数据(${localVSCodeDataCount}项)`)
          return true
        }
        
        // 【重要】任何其他情况都使用标准同步流程，进行保守的智能合并
        console.log('🛡️ 检测结果: 为保护用户数据，使用标准同步流程')
        console.log(`   数据状况: 本地提交(${localCommitCount})，工作区文件(${gitStatus.files.length})，VSCode数据(${localVSCodeDataCount}项)`)
        return false
        
        // 【已移除】不再有额外的宽松检查，避免误判
      } else {
        console.log('   远程仓库: 无数据或为空')
      }

      console.log('✅ 检测结果: 本地仓库正常，使用标准同步流程')
      return false
    } catch (error) {
      console.error('检测本地仓库重新初始化状态失败:', error)
      // 出错时保守处理，使用标准同步流程以保护用户数据
      return false
    }
  }

  /**
   * 将本地数据写入Git仓库
   */
  private async writeDataToGit(snippets: CodeSnippet[], directories: Directory[]): Promise<void> {
    if (!this.fileSystemManager) {
      throw new Error('FileSystemManager 未初始化')
    }

    try {
      console.log('📝 写入本地数据到Git仓库...')
      
      // 使用极简文件存储接口
      await this.fileSystemManager.writeToGit(snippets, directories)
      
      console.log('✅ 数据写入Git仓库完成')
    } catch (error) {
      console.error('❌ 写入数据到Git仓库失败:', error)
      throw error
    }
  }

  /**
   * 从Git仓库读取数据
   */
  private async readDataFromGit(): Promise<{ snippets: CodeSnippet[]; directories: Directory[] }> {
    if (!this.fileSystemManager) {
      throw new Error('FileSystemManager 未初始化')
    }

    try {
      console.log('📖 从Git仓库读取数据...')
      
      // 使用极简文件存储接口
      const result = await this.fileSystemManager.readFromGit()
      
      
      console.log(`✅ 从Git仓库读取完成: ${result.snippets.length} 个代码片段, ${result.directories.length} 个目录`)
      return result
    } catch (error) {
      console.error('❌ 从Git仓库读取数据失败:', error)
      throw error
    }
  }

  /**
   * 自动清理未完成的合并状态
   */
  private async autoCleanupUnfinishedMerge(gitOpsManager: IGitOperationsManager): Promise<{
    action: 'none' | 'aborted' | 'completed' | 'reset'
    message: string
  }> {
    try {
      const git = await gitOpsManager.getGitInstance()
      const status = await git.status()
      
      // 【重要修复】检查是否有活跃的冲突解决会话
      if (status.conflicted.length > 0) {
        console.log(`⚠️ 检测到 ${status.conflicted.length} 个冲突文件，检查是否有活跃解决会话...`)
        
        // 检查冲突文件是否在VSCode中打开（表示用户正在解决冲突）
        const conflictFilesInVSCode = await this.checkConflictFilesInVSCode(status.conflicted)
        
        if (conflictFilesInVSCode.length > 0) {
          console.log(`🔄 发现 ${conflictFilesInVSCode.length} 个冲突文件在VSCode中打开，保留合并状态以供用户继续解决`)
          const fileNames = conflictFilesInVSCode.map(f => f.replace(/^.*[\\\/]/, '')).join(', ')
          return {
            action: 'none',
            message: `检测到用户正在VSCode中解决冲突文件 (${fileNames})，保留合并状态`
          }
        }
        
        // 检查冲突是否是最近产生的（5分钟内），如果是则给用户更多时间
        const conflictAge = await this.getConflictAge(git)
        if (conflictAge < 5 * 60 * 1000) { // 5分钟
          console.log(`🕐 检测到冲突产生于 ${Math.round(conflictAge / 1000)} 秒前，给用户更多时间解决`)
          return {
            action: 'none',
            message: `冲突较新 (${Math.round(conflictAge / 1000)}秒前)，保留合并状态以供用户解决`
          }
        }
        
        // 如果冲突文件没有在VSCode中打开且产生时间较久，才自动放弃
        console.log(`🧹 冲突文件未在VSCode中打开且时间较久，自动放弃合并...`)
        await git.raw(['merge', '--abort'])
        return {
          action: 'aborted',
          message: `已自动放弃包含 ${status.conflicted.length} 个冲突文件的未完成合并`
        }
      }
      
      // 检查是否有已解决但未提交的合并
      if (status.staged.length > 0 || status.files.some((f: any) => f.index === 'M')) {
        try {
          const mergeHead = await git.raw(['rev-parse', '--verify', 'MERGE_HEAD']).catch(() => null)
          if (mergeHead) {
            console.log('🔄 检测到已解决的合并，自动完成提交...')
            const commitMessage = `自动完成合并: ${new Date().toLocaleString()}`
            await git.commit(commitMessage)
            return {
              action: 'completed',
              message: '已自动完成未提交的合并'
            }
          }
        } catch (error) {
          // 如果无法提交，重置状态
          console.log('⚠️ 无法完成合并提交，重置到干净状态...')
          await git.raw(['reset', '--hard', 'HEAD'])
          return {
            action: 'reset',
            message: '已重置到上次提交状态'
          }
        }
      }
      
      // 检查是否有未提交的自动合并
      try {
        const mergeHead = await git.raw(['rev-parse', '--verify', 'MERGE_HEAD']).catch(() => null)
        if (mergeHead) {
          console.log('🔄 检测到未提交的自动合并，自动完成...')
          const commitMessage = `自动合并远程更改: ${new Date().toLocaleString()}`
          await git.commit(commitMessage)
          return {
            action: 'completed',
            message: '已自动完成自动合并'
          }
        }
      } catch (error) {
        // 如果提交失败，放弃合并
        console.log('⚠️ 自动合并提交失败，放弃合并...')
        await git.raw(['merge', '--abort'])
        return {
          action: 'aborted',
          message: '已放弃无法完成的自动合并'
        }
      }
      
      return {
        action: 'none',
        message: 'Git仓库状态正常，无需清理'
      }
      
    } catch (error) {
      console.error('自动清理合并状态失败:', error)
      return {
        action: 'none',
        message: `清理失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 检查冲突文件是否在VSCode中打开
   */
  private async checkConflictFilesInVSCode(conflictFiles: string[]): Promise<string[]> {
    try {
      const vscode = await import('vscode')
      const openDocuments = vscode.workspace.textDocuments
      const conflictFilesInVSCode: string[] = []
      
      for (const conflictFile of conflictFiles) {
        const foundInVSCode = openDocuments.some(doc => {
          const docPath = doc.uri.fsPath
          return docPath.includes(conflictFile) || conflictFile.includes(docPath.split(/[\\\/]/).pop() || '')
        })
        
        if (foundInVSCode) {
          conflictFilesInVSCode.push(conflictFile)
        }
      }
      
      return conflictFilesInVSCode
    } catch (error) {
      console.warn('检查VSCode打开文件失败:', error)
      return []
    }
  }

  /**
   * 获取冲突产生的时间（毫秒）
   */
  private async getConflictAge(git: any): Promise<number> {
    try {
      // 检查MERGE_HEAD的修改时间
      const mergeHeadStat = await git.raw(['stat', '--format=%Y', '.git/MERGE_HEAD']).catch(() => null)
      if (mergeHeadStat) {
        const mergeTime = parseInt(mergeHeadStat.trim()) * 1000 // 转换为毫秒
        return Date.now() - mergeTime
      }
      
      // 如果无法获取MERGE_HEAD时间，返回一个较大的值（表示冲突很久了）
      return 10 * 60 * 1000 // 10分钟
    } catch (error) {
      console.warn('获取冲突时间失败:', error)
      return 10 * 60 * 1000 // 默认认为是10分钟前的冲突
    }
  }
}
