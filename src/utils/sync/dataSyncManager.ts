import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { CodeSnippet, Directory } from '../../types/types'
import { SyncResult, ChangeDetectionResult, RemoteCheckResult } from '../../types/syncTypes'
import { SettingsManager } from '../settingsManager'
import { TempFilesCleaner } from '../cleanupTempFiles'
import { ConflictDetector } from '../conflict/conflictDetector'
import { ConflictResolver } from '../conflict/conflictResolver'
import { ManualConflictHandler } from '../conflict/manualConflictHandler'
import { ThreeWayMergeManager } from './threeWayMergeManager'

/**
 * 数据同步核心管理器
 * 负责同步流程控制、变更检测、智能合并和冲突处理的协调
 */
export class DataSyncManager {
  private context: vscode.ExtensionContext | null = null
  private storageManager: any = null
  private conflictDetector: ConflictDetector
  private conflictResolver: ConflictResolver
  private manualConflictHandler: ManualConflictHandler
  private threeWayMergeManager: ThreeWayMergeManager | null = null

  constructor(context?: vscode.ExtensionContext, storageManager?: any) {
    this.context = context || null
    this.storageManager = storageManager || null
    this.conflictDetector = new ConflictDetector()
    this.conflictResolver = new ConflictResolver()
    this.manualConflictHandler = new ManualConflictHandler(context, storageManager)
  }

  /**
   * 执行完整的数据同步流程（真正的双向同步）
   *
   * 正确的Git同步流程：
   * 1. 先拉取远程最新数据
   * 2. 比较本地VSCode数据与远程Git数据
   * 3. 进行智能合并（而非覆盖）
   * 4. 解决冲突
   * 5. 提交合并结果
   * 6. 推送到远程
   */
  public async performSyncFlow(
    localSnippets: CodeSnippet[],
    localDirectories: Directory[],
    remoteCheckResult: RemoteCheckResult,
    gitOpsManager: any,
    fileSystemManager: any
  ): Promise<SyncResult> {
    try {
      console.log('开始真正的双向同步流程...')

      // 步骤1: 首先拉取远程最新数据
      let remotePullSuccess = false
      let hasRemoteUpdates = false
      let remoteData: { snippets: CodeSnippet[]; directories: Directory[] } = { snippets: [], directories: [] }

      if (remoteCheckResult.remotePullSuccess || remoteCheckResult.remoteHasData) {
        try {
          console.log('步骤1: 拉取远程最新数据...')

          // 检查远程是否有更新
          const remoteUpdates = await gitOpsManager.checkRemoteUpdates()
          hasRemoteUpdates = remoteUpdates.hasUpdates

          if (hasRemoteUpdates) {
            console.log('检测到远程更新，执行pull操作...')
            await gitOpsManager.gitPull()
            console.log('成功拉取远程变更')
          } else {
            console.log('远程无新更新')
          }

          // 读取拉取后的Git仓库数据
          remoteData = await fileSystemManager.readDataFromGitRepo()
          console.log(`远程数据: ${remoteData.snippets.length} 个代码片段, ${remoteData.directories.length} 个目录`)
          
          remotePullSuccess = true
        } catch (pullError) {
          console.error('拉取远程变更失败:', pullError)

          // 检查是否是合并冲突
          if (pullError instanceof Error && pullError.message.includes('merge conflict')) {
            console.log('检测到合并冲突，需要处理...')
            return await this.handleMergeConflicts(gitOpsManager, fileSystemManager)
          } else {
            // 其他拉取错误，继续使用现有的Git仓库数据
            console.warn('拉取失败，使用现有Git仓库数据继续同步...')
            try {
              remoteData = await fileSystemManager.readDataFromGitRepo()
            } catch (readError) {
              console.warn('读取现有Git仓库数据也失败，使用空数据')
              remoteData = { snippets: [], directories: [] }
            }
          }
        }
      } else {
        // 如果是新仓库或无远程数据，使用空的远程数据
        console.log('新仓库或无远程数据，使用空的远程数据基线')
        remoteData = { snippets: [], directories: [] }
      }

      // 步骤2: 比较本地VSCode数据与远程Git数据，进行三路智能合并
      console.log('步骤2: 使用Git历史基线进行三路智能合并...')
      
      // 初始化三路合并管理器（如果还未初始化）
      if (!this.threeWayMergeManager) {
        const git = await gitOpsManager.getGitInstance()
        this.threeWayMergeManager = new ThreeWayMergeManager(git, fileSystemManager)
      }
      
      const mergeResult = await this.threeWayMergeManager.performThreeWayMerge(
        localSnippets,        // 本地VSCode当前状态
        localDirectories,     // 本地VSCode当前目录
        remoteData.snippets,  // 远程Git状态
        remoteData.directories // 远程Git目录
      )

      if (!mergeResult.success) {
        return {
          success: false,
          message: mergeResult.message || '智能合并失败',
          conflictsDetected: mergeResult.conflictsDetected,
          conflictDetails: mergeResult.conflictDetails
        }
      }

      // 步骤3: 检查合并结果是否需要更新Git仓库
      const needsGitUpdate = mergeResult.needsGitUpdate || mergeResult.hasChanges
      let finalSnippets = mergeResult.mergedSnippets
      let finalDirectories = mergeResult.mergedDirectories

      // 步骤4: 如果有变更，更新Git仓库
      if (needsGitUpdate) {
        console.log('步骤3: 将合并结果写入Git仓库...')
        
        // 写入合并后的数据到Git仓库
        await fileSystemManager.writeDataToGitRepo(finalSnippets, finalDirectories, true)

        // 检查Git状态并提交
        const gitStatus = await gitOpsManager.gitStatus()
        if (gitStatus.files.length > 0) {
          console.log(
            `Git检测到 ${gitStatus.files.length} 个文件变更:`,
            gitStatus.files.map((f: any) => `${f.working_dir}${f.path}`)
          )

          // 添加所有变更到暂存区
          await gitOpsManager.gitAddAll()

          // 提交合并结果
          const commitMessage = this.generateMergeCommitMessage(mergeResult)
          await gitOpsManager.gitCommit(commitMessage)
          console.log(`已提交合并结果: ${commitMessage}`)
        }

        // 步骤5: 推送到远程
        try {
          console.log('步骤4: 推送合并结果到远程...')
          await gitOpsManager.gitPush()
          console.log('成功推送到远程仓库')
        } catch (pushError) {
          console.error('推送失败:', pushError)
          return {
            success: false,
            message: `推送失败: ${pushError instanceof Error ? pushError.message : '未知错误'}`,
          }
        }
      }

      // 步骤6: 检查是否需要更新VSCode存储
      const needsVSCodeUpdate = mergeResult.needsVSCodeUpdate

      if (needsVSCodeUpdate && this.storageManager) {
        try {
          console.log('步骤5: 同步合并结果到VSCode存储...')

          // 清除现有数据
          const existingSnippets = await this.storageManager.getAllSnippets()
          for (const snippet of existingSnippets) {
            await this.storageManager.deleteSnippet(snippet.fullPath)
          }

          const existingDirectories = await this.storageManager.getAllDirectories()
          for (const directory of existingDirectories) {
            await this.storageManager.deleteDirectory(directory.fullPath)
          }

          // 添加合并后的数据
          for (const directory of finalDirectories) {
            await this.storageManager.createDirectory(directory)
          }

          for (const snippet of finalSnippets) {
            await this.storageManager.saveSnippet(snippet)
          }

          console.log(`VSCode存储同步完成: ${finalSnippets.length} 个代码片段, ${finalDirectories.length} 个目录`)
        } catch (storageError) {
          console.warn('同步到VSCode存储失败:', storageError)
          // 不影响Git同步的成功状态
        }
      }

      // 构建成功消息
      let successMessage = '✅ 三路智能同步完成！'

      if (mergeResult.analysis) {
        successMessage += `\n\n📊 变更分析:`
        if (mergeResult.analysis.localChanges.length > 0) {
          successMessage += `\n• 本地变更: ${mergeResult.analysis.localChanges.length} 项`
        }
        if (mergeResult.analysis.remoteChanges.length > 0) {
          successMessage += `\n• 远程变更: ${mergeResult.analysis.remoteChanges.length} 项`
        }
        if (mergeResult.analysis.autoResolved.length > 0) {
          successMessage += `\n• 自动解决: ${mergeResult.analysis.autoResolved.length} 项`
        }
        if (mergeResult.analysis.realConflicts.length > 0) {
          successMessage += `\n• 需手动处理冲突: ${mergeResult.analysis.realConflicts.length} 项`
        }
      }

      if (!needsGitUpdate && !mergeResult.needsVSCodeUpdate) {
        successMessage = '✅ 数据已是最新状态，无需同步'
      }

      return {
        success: true,
        message: successMessage,
        mergedData: mergeResult.needsVSCodeUpdate ? {
          snippets: finalSnippets,
          directories: finalDirectories,
        } : undefined,
        autoMerged: mergeResult.needsVSCodeUpdate,
        conflictsDetected: mergeResult.conflictsDetected,
        conflictDetails: mergeResult.conflictDetails
      }
    } catch (error) {
      console.error('双向同步流程失败:', error)
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
   * 从Git仓库读取数据
   */
  public async readDataFromGitRepo(): Promise<{ snippets: CodeSnippet[]; directories: Directory[] }> {
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
   * 合并代码片段（使用fullPath作为唯一标识）
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
    const merged: CodeSnippet[] = [...local]
    const conflicts: any[] = []
    let additions = 0
    let manualMergeRequired = false

    for (const remoteSnippet of remote) {
      const localIndex = merged.findIndex((s) => s.fullPath === remoteSnippet.fullPath)

      if (localIndex === -1) {
        // 远程代码片段在本地不存在，直接添加
        merged.push(remoteSnippet)
        additions++
      } else {
        // 代码片段在本地存在，检查是否有冲突
        const localSnippet = merged[localIndex]

        if (this.hasSnippetContentDifference(localSnippet, remoteSnippet)) {
          // 有内容差异，使用智能冲突解决器
          console.log(`检测到代码片段冲突: ${remoteSnippet.fullPath}`)
          console.log('本地内容:', localSnippet.code)
          console.log('远程内容:', remoteSnippet.code)
          
          const conflictResult = this.conflictResolver.resolveSnippetConflict(localSnippet, remoteSnippet)
          console.log('冲突解决结果:', conflictResult.strategy)

          conflicts.push({
            id: remoteSnippet.fullPath,
            fullPath: remoteSnippet.fullPath,
            local: localSnippet,
            remote: remoteSnippet,
            resolution: conflictResult.strategy,
            needsManualMerge: conflictResult.needsManualMerge || false,
            conflictData: conflictResult.conflictData,
          })

          if (conflictResult.needsManualMerge) {
            manualMergeRequired = true
          } else {
            // 自动解决，更新合并后的数据
            merged[localIndex] = conflictResult.resolved
          }
        }
      }
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
    const merged: Directory[] = [...local]
    const conflicts: any[] = []
    let additions = 0

    for (const remoteDirectory of remote) {
      const localIndex = merged.findIndex((d) => d.fullPath === remoteDirectory.fullPath)

      if (localIndex === -1) {
        // 远程目录在本地不存在，直接添加
        merged.push(remoteDirectory)
        additions++
      } else {
        // 目录在本地存在，检查是否有冲突
        const localDirectory = merged[localIndex]

        if (this.hasDirectoryContentDifference(localDirectory, remoteDirectory)) {
          // 有内容差异，自动选择较新的
          const resolution = 'use_remote' // 默认使用远程版本

          conflicts.push({
            id: remoteDirectory.fullPath,
            fullPath: remoteDirectory.fullPath,
            local: localDirectory,
            remote: remoteDirectory,
            resolution,
            needsManualMerge: false,
          })

          merged[localIndex] = remoteDirectory
        }
      }
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
}
