import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { CodeSnippet, Directory } from '../../types/types'
import { SyncResult, PullResult, ForceImportResult, ConflictApplyResult } from '../../types/syncTypes'
import { SettingsManager } from '../settingsManager'
import { GitOperationsManager } from '../git/gitOperationsManager'
import { FileSystemManager } from './fileSystemManager'
import { ConflictDetector } from '../conflict/conflictDetector'

/**
 * 云端操作管理器
 * 负责云端拉取推送、强制操作和数据导入导出功能
 */
export class CloudOperationsManager {
  private context: vscode.ExtensionContext | null = null
  private storageManager: any = null
  private gitOpsManager: GitOperationsManager
  private fileSystemManager: FileSystemManager
  private conflictDetector: ConflictDetector

  constructor(
    context?: vscode.ExtensionContext, 
    storageManager?: any,
    gitOpsManager?: GitOperationsManager
  ) {
    this.context = context || null
    this.storageManager = storageManager || null
    // 如果没有提供gitOpsManager，创建一个默认的（需要配置）
    this.gitOpsManager = gitOpsManager || new GitOperationsManager(SettingsManager.getCloudSyncConfig())
    this.fileSystemManager = new FileSystemManager()
    this.conflictDetector = new ConflictDetector()
  }

  /**
   * 从云端拉取数据（安全模式）
   * 专门用于获取远程数据而不推送本地数据
   */
  public async pullFromCloud(): Promise<PullResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: '云端同步未配置，请先配置Git仓库信息'
      }
    }

    try {
      // 1. 获取Git实例
      const git = await this.gitOpsManager.getGitInstance()
      
      // 2. 检查远程仓库状态
      const remoteRefs = await git.listRemote(['--heads', 'origin'])
      const isRemoteEmpty = !remoteRefs || remoteRefs.trim() === ''
      
      if (isRemoteEmpty) {
        return {
          success: false,
          message: '远程仓库为空，没有数据可以拉取。\n\n这可能是一个新创建的仓库，请先在其他设备上推送数据。'
        }
      }
      
      // 3. 确保在正确的分支上
      const config = SettingsManager.getCloudSyncConfig()
      const targetBranch = config.defaultBranch || 'main'
      try {
        const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD'])
        if (currentBranch !== targetBranch) {
          // 检查目标分支是否存在
          const localBranches = await git.branchLocal()
          if (!localBranches.all.includes(targetBranch)) {
            // 如果目标分支不存在，从远程创建
            await git.checkoutLocalBranch(targetBranch)
          } else {
            await git.checkout(targetBranch)
          }
        }
      } catch (branchError) {
        console.warn('分支检查失败:', branchError)
      }
      
      // 4. 备份当前的本地数据（如果存在）
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      const backupDir = path.join(effectiveLocalPath, '.backup-pull-' + Date.now())
      
      let hasLocalBackup = false
      try {
        const snippetsFile = path.join(effectiveLocalPath, 'snippets.json')
        const directoriesFile = path.join(effectiveLocalPath, 'directories.json')
        
        if (fs.existsSync(snippetsFile) || fs.existsSync(directoriesFile)) {
          fs.mkdirSync(backupDir, { recursive: true })
          
          if (fs.existsSync(snippetsFile)) {
            fs.copyFileSync(snippetsFile, path.join(backupDir, 'snippets.json'))
          }
          if (fs.existsSync(directoriesFile)) {
            fs.copyFileSync(directoriesFile, path.join(backupDir, 'directories.json'))
          }
          
          hasLocalBackup = true
        }
      } catch (backupError) {
        console.warn('备份本地数据失败:', backupError)
      }
      
      // 5. 拉取远程数据
      try {
        await this.gitOpsManager.gitPull(targetBranch)
      } catch (pullError) {
        const errorMessage = pullError instanceof Error ? pullError.message : '未知错误'
        
        // 恢复备份（如果有）
        if (hasLocalBackup) {
          try {
            const snippetsBackup = path.join(backupDir, 'snippets.json')
            const directoriesBackup = path.join(backupDir, 'directories.json')
            
            if (fs.existsSync(snippetsBackup)) {
              fs.copyFileSync(snippetsBackup, path.join(effectiveLocalPath, 'snippets.json'))
            }
            if (fs.existsSync(directoriesBackup)) {
              fs.copyFileSync(directoriesBackup, path.join(effectiveLocalPath, 'directories.json'))
            }
            
            await this.fileSystemManager.cleanupBackup(backupDir)
          } catch (restoreError) {
            console.warn('恢复备份失败:', restoreError)
          }
        }
        
        return {
          success: false,
          message: `从云端拉取数据失败: ${errorMessage}\n\n请检查：\n• 网络连接是否正常\n• 认证信息是否正确\n• 远程仓库是否存在指定分支 '${targetBranch}'`
        }
      }
      
      // 6. 读取拉取的数据
      const pulledData = await this.fileSystemManager.readDataFromGitRepo()
      
      // 7. 清理备份（拉取成功）
      if (hasLocalBackup && fs.existsSync(backupDir)) {
        try {
          await this.fileSystemManager.cleanupBackup(backupDir)
        } catch (cleanupError) {
          console.warn('清理备份失败:', cleanupError)
        }
      }
      
      return {
        success: true,
        message: `成功从云端拉取数据！\n\n获取到：\n• ${pulledData.snippets.length} 个代码片段\n• ${pulledData.directories.length} 个目录\n\n数据已保存到本地Git仓库，您可以选择是否导入到VSCode。`,
        data: pulledData
      }
      
    } catch (error) {
      console.error('从云端拉取数据失败:', error)
      return {
        success: false,
        message: `从云端拉取数据失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 强制推送到云端（危险操作）
   * 用于在用户明确确认的情况下覆盖远程数据
   */
  public async forcePushToCloud(
    currentSnippets: CodeSnippet[], 
    currentDirectories: Directory[], 
    userConfirmed: boolean = false
  ): Promise<SyncResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: '云端同步未配置，请先配置Git仓库信息'
      }
    }

    if (!userConfirmed) {
      return {
        success: false,
        message: '⚠️ 强制推送需要用户确认！\n\n强制推送会覆盖远程仓库的所有数据，这个操作不可撤销。\n\n如果您确定要继续，请使用确认参数调用此方法。'
      }
    }

    // 更新同步状态
    const status = SettingsManager.getCloudSyncStatus()
    status.isSyncing = true
    await SettingsManager.saveCloudSyncStatus(status)

    try {
      // 1. 获取Git实例
      const git = await this.gitOpsManager.getGitInstance()
      
      // 2. 确保在正确的分支上
      const config = SettingsManager.getCloudSyncConfig()
      const targetBranch = config.defaultBranch || 'main'
      try {
        const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD'])
        if (currentBranch !== targetBranch) {
          const localBranches = await git.branchLocal()
          if (!localBranches.all.includes(targetBranch)) {
            await git.checkoutLocalBranch(targetBranch)
          } else {
            await git.checkout(targetBranch)
          }
        }
      } catch (branchError) {
        console.warn('分支检查失败:', branchError)
      }
      
      // 3. 强制写入本地数据（始终更新时间戳）
      await this.fileSystemManager.writeDataToGitRepo(currentSnippets, currentDirectories, true)
      
      // 4. 检查是否有变更需要提交
      const gitStatus = await this.gitOpsManager.gitStatus()
      const hasChanges = gitStatus.files.length > 0
      
      if (hasChanges) {
        // 5. 添加所有变更并提交
        await this.gitOpsManager.gitAddAll()
        const commitMessage = this.gitOpsManager.generateCommitMessage() + ' [FORCE PUSH]'
        await this.gitOpsManager.gitCommit(commitMessage)
      } else {
        // 如果没有变更，创建一个空提交以确保推送
        const emptyCommitMessage = this.gitOpsManager.generateCommitMessage() + ' [FORCE PUSH - NO CHANGES]'
        await git.commit(emptyCommitMessage, ['--allow-empty'])
      }
      
      // 6. 强制推送到远程
      try {
        await git.push('origin', targetBranch, ['--force', '--set-upstream'])
      } catch (pushError) {
        const errorMessage = pushError instanceof Error ? pushError.message : '未知错误'
        
        if (errorMessage.includes('no upstream branch') || 
            errorMessage.includes('src refspec')) {
          // 尝试设置上游分支
          await git.push('origin', targetBranch, ['--set-upstream', '--force'])
        } else {
          throw pushError
        }
      }
      
      // 7. 更新同步状态
      const finalStatus = SettingsManager.getCloudSyncStatus()
      finalStatus.lastSyncTime = Date.now()
      finalStatus.lastError = null  // 明确清除错误状态
      finalStatus.isConnected = true
      finalStatus.isSyncing = false  // 确保同步状态已结束
      await SettingsManager.saveCloudSyncStatus(finalStatus)
      
      return {
        success: true,
        message: `强制推送成功！\n\n已强制覆盖远程仓库数据：\n• ${currentSnippets.length} 个代码片段\n• ${currentDirectories.length} 个目录\n\n分支: ${targetBranch}\n\n⚠️ 远程仓库的历史数据已被覆盖。`
      }
      
    } catch (error) {
      console.error('强制推送失败:', error)
      
      // 更新错误状态
      const errorStatus = SettingsManager.getCloudSyncStatus()
      errorStatus.lastError = error instanceof Error ? error.message : '未知错误'
      errorStatus.isConnected = false
      errorStatus.isSyncing = false  // 确保同步状态已结束
      await SettingsManager.saveCloudSyncStatus(errorStatus)
      
      return {
        success: false,
        message: `强制推送失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    } finally {
      // 清除同步状态
      const finalStatus = SettingsManager.getCloudSyncStatus()
      finalStatus.isSyncing = false
      await SettingsManager.saveCloudSyncStatus(finalStatus)
    }
  }

  /**
   * 从Git仓库强制同步数据到VSCode存储
   * 用于修复同步不一致的问题
   */
  public async forceImportFromGitRepo(): Promise<ForceImportResult> {
    if (!this.storageManager) {
      return {
        success: false,
        message: 'StorageManager 未初始化',
        imported: { snippets: 0, directories: 0 }
      }
    }

    try {
      // 1. 从Git仓库读取最新数据
      const gitData = await this.fileSystemManager.readDataFromGitRepo()
      
      if (gitData.snippets.length === 0 && gitData.directories.length === 0) {
        return {
          success: true,
          message: 'Git仓库中没有数据需要导入',
          imported: { snippets: 0, directories: 0 }
        }
      }

      // 2. 获取当前VSCode存储中的数据
      const currentSnippets = await this.storageManager.getAllSnippets()
      const currentDirectories = await this.storageManager.getAllDirectories()

      let importedSnippets = 0
      let importedDirectories = 0

      // 3. 同步目录
      for (const gitDirectory of gitData.directories) {
        const existingDir = currentDirectories.find((d: Directory) => 
          d.fullPath === gitDirectory.fullPath
        )

        if (!existingDir) {
          // 新增目录
          await this.storageManager.createDirectory(gitDirectory)
          importedDirectories++
        } else {
          // 检查并更新现有目录
          const hasDirectoryDiff = this.conflictDetector.hasDirectoryContentDifference(existingDir, gitDirectory)
          if (hasDirectoryDiff) {
            // 使用V2的fullPath进行删除和更新
            await this.storageManager.deleteDirectory(existingDir.fullPath)
            await this.storageManager.createDirectory(gitDirectory)
            importedDirectories++
          }
        }
      }

      // 4. 同步代码片段
      for (const gitSnippet of gitData.snippets) {
        const existingSnippet = currentSnippets.find((s: CodeSnippet) => 
          s.fullPath === gitSnippet.fullPath
        )

        if (!existingSnippet) {
          // 新增代码片段
          await this.storageManager.saveSnippet(gitSnippet)
          importedSnippets++
        } else {
          // 检查并更新现有代码片段
          const hasSnippetDiff = this.conflictDetector.hasSnippetContentDifference(existingSnippet, gitSnippet)
          if (hasSnippetDiff) {
            // 使用V2的fullPath进行删除和更新
            await this.storageManager.deleteSnippet(existingSnippet.fullPath)
            await this.storageManager.saveSnippet(gitSnippet)
            importedSnippets++
          }
        }
      }

      // 5. 清除缓存并刷新界面
      if (this.storageManager.clearCache) {
        this.storageManager.clearCache()
      }

      if (this.context) {
        try {
          await vscode.commands.executeCommand('starcode-snippets.refreshExplorer')
        } catch (refreshError) {
          console.warn('刷新界面失败:', refreshError)
        }
      }

      return {
        success: true,
        message: `成功从Git仓库导入数据！\n\n• 更新/新增代码片段：${importedSnippets} 个\n• 更新/新增目录：${importedDirectories} 个\n\n所有数据现已与Git仓库保持一致。`,
        imported: { snippets: importedSnippets, directories: importedDirectories }
      }

    } catch (error) {
      console.error('从Git仓库强制导入数据失败:', error)
      return {
        success: false,
        message: `导入失败: ${error instanceof Error ? error.message : '未知错误'}`,
        imported: { snippets: 0, directories: 0 }
      }
    }
  }

  /**
   * 应用用户手动解决的冲突文件
   * 读取临时冲突文件中用户编辑后的内容并应用到同步过程
   */
  public async applyResolvedConflicts(): Promise<ConflictApplyResult> {
    try {
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      const tempDir = path.join(effectiveLocalPath, '.merge-conflicts')
      
      if (!fs.existsSync(tempDir)) {
        return {
          success: false,
          message: '没有找到待解决的冲突文件',
          resolvedCount: 0
        }
      }
      
      // 读取所有冲突文件
      const conflictFiles = fs.readdirSync(tempDir).filter((file: string) => 
        file.startsWith('conflict_') && file.endsWith('.txt')
      )
      
      if (conflictFiles.length === 0) {
        return {
          success: false,
          message: '冲突目录中没有找到冲突文件',
          resolvedCount: 0
        }
      }
      
      const resolvedSnippets: any[] = []
      let resolvedCount = 0
      
      for (const fileName of conflictFiles) {
        const filePath = path.join(tempDir, fileName)
        const fileContent = fs.readFileSync(filePath, 'utf8')
        
        // 检查文件是否已经被用户编辑（不包含冲突标记）
        const hasConflictMarkers = fileContent.includes('<<<<<<< LOCAL') || 
                                 fileContent.includes('=======') || 
                                 fileContent.includes('>>>>>>> REMOTE')
        
        if (!hasConflictMarkers) {
          // 用户已经解决了冲突，提取解决后的代码内容
          const resolvedResult = this.conflictDetector.extractResolvedContent(fileContent)
          
          if (resolvedResult.success && resolvedResult.content.length > 0) {
            // 从文件名中提取冲突路径
            const pathMatch = fileName.match(/conflict_\d+_(.+)\.txt$/)
            if (pathMatch) {
              const conflictPath = pathMatch[1].replace(/_/g, '/')
              
              // 创建解决后的代码片段对象
              const resolvedSnippet = {
                id: require('crypto').randomUUID(), // 生成新的ID
                fullPath: conflictPath,
                name: path.basename(conflictPath),
                code: resolvedResult.content,
                language: '', // 将在导入时自动检测
                category: path.dirname(conflictPath) === '.' ? '' : path.dirname(conflictPath),
                createTime: Date.now()
              } as any
              
              resolvedSnippets.push(resolvedSnippet)
              resolvedCount++
            }
          }
        }
      }
      
      if (resolvedCount === 0) {
        return {
          success: false,
          message: `发现 ${conflictFiles.length} 个冲突文件，但都尚未解决。\n\n请按以下步骤操作：\n1. 打开冲突文件进行编辑\n2. 保留您想要的内容\n3. 删除冲突标记行（<<<<<<< ======= >>>>>>>）\n4. 保存文件 - 系统将自动检测并应用解决方案`,
          resolvedCount: 0
        }
      }
      
      // 应用解决后的代码片段到VSCode存储
      if (this.storageManager && resolvedSnippets.length > 0) {
        for (const snippet of resolvedSnippets) {
          try {
            await this.storageManager.saveSnippet(snippet)
          } catch (saveError) {
            console.warn(`保存解决后的代码片段失败: ${(snippet as any).fullPath}`, saveError)
          }
        }
        
        // 清除缓存并刷新界面
        if (this.storageManager.clearCache) {
          this.storageManager.clearCache()
        }
        
        if (this.context) {
          try {
            await vscode.commands.executeCommand('starcode-snippets.refreshExplorer')
          } catch (refreshError) {
            console.warn('刷新界面失败:', refreshError)
          }
        }
      }
      
      // 清理临时文件
      await this.fileSystemManager.cleanupTempConflictFiles(tempDir)
      
      return {
        success: true,
        message: `成功应用 ${resolvedCount} 个手动解决的冲突！\n\n已更新的代码片段：\n${resolvedSnippets.map(s => `• ${(s as any).fullPath}`).join('\n')}\n\n现在可以重新执行同步操作。`,
        resolvedCount,
        resolvedSnippets
      }
      
    } catch (error) {
      console.error('应用解决后的冲突失败:', error)
      return {
        success: false,
        message: `应用冲突解决失败: ${error instanceof Error ? error.message : '未知错误'}`,
        resolvedCount: 0
      }
    }
  }

  /**
   * 重置到远程状态
   */
  public async resetToRemote(branch?: string): Promise<{ success: boolean; message: string }> {
    try {
      const git = await this.gitOpsManager.getGitInstance()
      const config = SettingsManager.getCloudSyncConfig()
      const targetBranch = branch || config.defaultBranch || 'main'
      
      // 先获取远程最新状态
      await git.fetch('origin', targetBranch)
      
      // 重置到远程分支
      await git.reset(['--hard', `origin/${targetBranch}`])
      
      // 清理未跟踪的文件
      await git.clean('f', ['-d'])
      
      return {
        success: true,
        message: `本地Git仓库已重置到远程分支 ${targetBranch} 的最新状态。\n现在可以重新执行同步操作。`
      }
    } catch (error) {
      console.error('重置本地仓库失败:', error)
      return {
        success: false,
        message: `重置失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 从路径生成ID
   */
  private generateIdFromPath(fullPath: string): string {
    return require('crypto').createHash('md5').update(fullPath).digest('hex')
  }

  /**
   * 检查是否已配置
   */
  private isConfigured(): boolean {
    const config = SettingsManager.getCloudSyncConfig()
    return !!(
      config.provider &&
      config.repositoryUrl &&
      (config.authenticationMethod === 'ssh' || config.token)
    )
  }
} 