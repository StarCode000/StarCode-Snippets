import * as vscode from 'vscode'
import { CloudSyncConfig, CloudSyncStatus, CodeSnippet, Directory } from '../types/types'
import { SettingsManager } from './settingsManager'

// 导入已拆分的模块
import { GitOperationsManager } from './git/gitOperationsManager'
import { ConnectionTester } from './git/connectionTester'
import { DataSyncManager } from './sync/dataSyncManager'
import { FileSystemManager } from './sync/fileSystemManager'
import { CloudOperationsManager } from './sync/cloudOperationsManager'
import { SyncResult, ChangeDetectionResult, RemoteUpdateResult, PullResult, ForceImportResult, ConflictApplyResult, RemoteCheckResult } from '../types/syncTypes'

/**
 * 云端同步主控制器
 * 采用门面模式，协调各个专门的子模块，提供统一的API接口
 * 
 * 架构说明：
 * - Git操作：由 GitOperationsManager 和 ConnectionTester 处理
 * - 数据同步：由 DataSyncManager 处理同步流程控制（包含冲突处理逻辑）
 * - 文件操作：由 FileSystemManager 处理Git仓库文件读写
 * - 云端操作：由 CloudOperationsManager 处理拉取、推送、导入等操作
 */
export class CloudSyncManager {
  private config: CloudSyncConfig
  private context: vscode.ExtensionContext | null = null
  private storageManager: any = null

  // 子模块实例
  private gitOpsManager!: GitOperationsManager
  private connectionTester!: ConnectionTester
  private dataSyncManager!: DataSyncManager
  private fileSystemManager!: FileSystemManager
  private cloudOpsManager!: CloudOperationsManager

  constructor(context?: vscode.ExtensionContext, storageManager?: any) {
    this.config = SettingsManager.getCloudSyncConfig()
    this.context = context || null
    this.storageManager = storageManager || null

    // 初始化所有子模块
    this.initializeModules()
  }

  /**
   * 初始化所有子模块
   */
  private initializeModules(): void {
    this.gitOpsManager = new GitOperationsManager(this.config)
    this.connectionTester = new ConnectionTester(this.config)
    this.dataSyncManager = new DataSyncManager(this.context || undefined, this.storageManager)
    this.fileSystemManager = new FileSystemManager()
    this.cloudOpsManager = new CloudOperationsManager(this.context || undefined, this.storageManager, this.gitOpsManager)
  }

  /**
   * 更新配置并重新初始化相关模块
   */
  public async updateConfig(newConfig: CloudSyncConfig): Promise<{ platformChanged: boolean; needsAttention: boolean; message?: string }> {
    const oldConfig = this.config
    this.config = newConfig
    
    // 更新子模块的配置
    this.gitOpsManager.updateConfig(newConfig)
    this.connectionTester.updateConfig(newConfig)
    
    // 检查是否发生了平台变更
    const platformChanged = oldConfig.provider !== newConfig.provider || 
                           oldConfig.repositoryUrl !== newConfig.repositoryUrl
    
    if (!platformChanged) {
      return { platformChanged: false, needsAttention: false }
    }
    
    // 如果平台发生变更，检查是否有现有的Git仓库
    try {
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      const hasGitRepo = this.fileSystemManager.fileExists(effectiveLocalPath) && 
                        this.fileSystemManager.fileExists(require('path').join(effectiveLocalPath, '.git'))
      
      if (hasGitRepo) {
        return {
          platformChanged: true,
          needsAttention: true,
          message: `检测到Git平台变更：${oldConfig.provider || '未知'} → ${newConfig.provider}。\n建议使用"切换Git平台"命令来妥善处理现有数据。`
        }
      } else {
        return {
          platformChanged: true,
          needsAttention: false,
          message: `已切换到新的Git平台：${newConfig.provider}`
        }
      }
    } catch (error) {
      console.warn('检查Git仓库状态失败:', error)
      return {
        platformChanged: true,
        needsAttention: true,
        message: '配置已更新，但无法确定现有Git仓库状态。建议检查同步设置。'
      }
    }
  }

  /**
   * 检查是否已配置Git同步
   */
  public isConfigured(): boolean {
    return !!(
      this.config.provider &&
      this.config.repositoryUrl &&
      (this.config.authenticationMethod === 'ssh' || this.config.token)
    )
  }

  /**
   * 测试Git连接
   */
  public async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: 'Git 同步配置不完整',
      }
    }

    return await this.connectionTester.testConnection()
  }

  /**
   * 执行完整同步（主要的同步API）
   */
  public async performSync(currentSnippets: CodeSnippet[], currentDirectories: Directory[]): Promise<SyncResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: '云端同步未配置，请先配置Git仓库信息',
      }
    }

    // 更新同步状态为进行中
    await this.dataSyncManager.startSyncStatus()

    try {
      console.log('开始Git云端同步...')
      
      // 0. 清理旧的临时文件
      await this.fileSystemManager.cleanupOldFiles()
      
      // 1. 获取Git实例并确保仓库初始化
      const git = await this.gitOpsManager.getGitInstance()
      console.log('Git仓库已初始化并配置远程')

      // Gitee特殊处理
      if (this.config.provider === 'gitee') {
        console.log('检测到Gitee平台，使用特殊处理流程...')
      }

      // 2. 检查并确保正确的分支存在
      const targetBranch = this.config.defaultBranch || 'main'
      console.log(`目标分支: ${targetBranch}`)
      
      try {
        // 检查当前分支状态
        const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD'])
        console.log(`当前分支: ${currentBranch}`)
        
        // 获取所有本地分支
        const localBranches = await git.branchLocal()
        const targetBranchExists = localBranches.all.includes(targetBranch)
        
        console.log(`本地分支列表: ${localBranches.all.join(', ')}`)
        console.log(`目标分支 ${targetBranch} 是否存在: ${targetBranchExists}`)
        
        if (!targetBranchExists) {
          console.log(`目标分支 ${targetBranch} 不存在，正在创建...`)
          
          // 如果目标分支不存在，创建并切换到该分支
          if (localBranches.all.length > 0) {
            // 如果有其他分支，基于当前分支创建新分支
            await git.checkoutLocalBranch(targetBranch)
          } else {
            console.log('仓库没有任何分支，将创建初始提交...')
          }
        } else if (currentBranch !== targetBranch) {
          console.log(`切换到目标分支 ${targetBranch}`)
          await git.checkout(targetBranch)
        }
      } catch (branchError) {
        console.warn('分支检查/切换失败:', branchError)
        // 如果分支操作失败，继续执行但记录警告
      }

      // 3. 检查远程仓库状态并拉取数据
      let remoteCheckResult = await this.gitOpsManager.checkRemoteRepositoryStatus(targetBranch)
      
      // 如果Git操作成功拉取，需要进一步检查是否有实际数据
      if (remoteCheckResult.remotePullSuccess) {
        try {
          const remoteData = await this.fileSystemManager.readDataFromGitRepo()
          remoteCheckResult.remoteHasData = remoteData.snippets.length > 0 || remoteData.directories.length > 0
          console.log(`远程数据检查: snippets=${remoteData.snippets.length}, directories=${remoteData.directories.length}`)
        } catch (readError) {
          console.warn('读取远程数据失败:', readError)
          remoteCheckResult.remoteHasData = false
        }
      }
      
      // 4. 执行智能合并
      const syncResult = await this.dataSyncManager.performSyncFlow(
        currentSnippets, 
        currentDirectories, 
        remoteCheckResult,
        this.gitOpsManager,
        this.fileSystemManager
      )
      
      if (!syncResult.success) {
        await this.dataSyncManager.updateSyncStatus(false, syncResult.message)
        
        // 特殊处理：如果需要用户决策，不更新为失败状态，而是提供决策指导
        if (syncResult.requiresUserDecision) {
          return {
            success: false,
            message: syncResult.message,
            requiresUserDecision: syncResult.requiresUserDecision,
            decisionType: syncResult.decisionType
          }
        }
        
        return syncResult
      }
      
      // 5. 如果有合并后的数据，写入Git仓库
      if (syncResult.mergedData) {
        // 检测本地变更以决定是否更新时间戳
        const localChanges = await this.dataSyncManager.detectLocalChanges(
          syncResult.mergedData.snippets, 
          syncResult.mergedData.directories
        )
        
        // 只有在进行了自动合并或真正有变更时才更新时间戳
        const shouldUpdateTimestamp = syncResult.autoMerged || (localChanges.hasChanges && localChanges.type !== 'none')
        
        await this.fileSystemManager.writeDataToGitRepo(
          syncResult.mergedData.snippets, 
          syncResult.mergedData.directories, 
          shouldUpdateTimestamp
        )
        
        // 6. 检查是否有变更需要提交
        const gitStatus = await this.gitOpsManager.gitStatus()
        const hasChanges = gitStatus.files.length > 0
        
        // 追踪实际提交状态
        let actuallyCommitted = false
        let changedFilesCount = 0
        
        if (hasChanges) {
          changedFilesCount = gitStatus.files.length
          console.log(`检测到 ${changedFilesCount} 个文件有变更:`, gitStatus.files.map((f: any) => f.path))
          
          await this.gitOpsManager.gitAddAll()
          const commitMessage = this.gitOpsManager.generateCommitMessage()
          await this.gitOpsManager.gitCommit(commitMessage)
          actuallyCommitted = true
          console.log(`已提交变更: ${commitMessage}`)
          
          // 7. 推送到远程
          try {
            await this.gitOpsManager.gitPush()
            console.log('推送到远程仓库成功')
          } catch (pushError) {
            const errorMessage = pushError instanceof Error ? pushError.message : '未知错误'
            console.error('推送失败:', errorMessage)
            
            // Gitee特殊错误处理
            if (this.config.provider === 'gitee') {
              if (errorMessage.includes('could not read Username') || 
                  errorMessage.includes('Authentication failed')) {
                await this.dataSyncManager.updateSyncStatus(false, `Gitee推送失败！\n\n可能原因：\n• Token没有推送权限\n• 仓库设置了保护分支\n\n建议：\n1. 在Gitee上检查Token权限\n2. 检查仓库分支保护设置\n3. 尝试使用SSH认证方式`)
                return {
                  success: false,
                  message: `Gitee推送失败！请检查Token权限和仓库设置。`,
                }
              }
            }
            
            if (errorMessage.includes('no upstream branch') || 
                errorMessage.includes('has no upstream branch') ||
                errorMessage.includes('upstream branch') ||
                errorMessage.includes('src refspec') ||
                hasChanges) { // 如果有新提交，很可能需要设置上游分支
              console.log('尝试设置上游分支并推送（首次推送）...')
              
              try {
                await git.push('origin', targetBranch, ['--set-upstream'])
                console.log('已设置上游分支并推送成功（首次推送）')
              } catch (upstreamError) {
                // 如果还是失败，尝试强制推送（用于空仓库）
                const upstreamErrorMsg = upstreamError instanceof Error ? upstreamError.message : '未知错误'
                console.error('设置上游分支失败:', upstreamErrorMsg)
                
                // Gitee特殊错误处理
                if (this.config.provider === 'gitee' && 
                    (upstreamErrorMsg.includes('could not read Username') || 
                     upstreamErrorMsg.includes('Authentication failed'))) {
                  await this.dataSyncManager.updateSyncStatus(false, `Gitee首次推送失败！\n\n请尝试：\n1. 在Gitee上确认仓库已正确创建\n2. 检查仓库权限设置\n3. 获取新的Token或尝试SSH认证方式`)
                  return {
                    success: false,
                    message: `Gitee首次推送失败！请检查仓库配置和权限。`,
                  }
                }
                
                if (upstreamErrorMsg.includes('non-fast-forward') || 
                    upstreamErrorMsg.includes('rejected')) {
                  console.log('尝试强制推送到空仓库...')
                  await git.push('origin', targetBranch, ['--set-upstream', '--force'])
                  console.log('强制推送成功（空仓库初始化）')
                } else {
                  throw upstreamError
                }
              }
            } else {
              throw pushError
            }
          }
        } else {
          console.log('没有检测到需要提交的变更')
        }
        
        // 8. 确保VSCode界面刷新显示最新数据
        if (syncResult.autoMerged && this.storageManager) {
          try {
            // 强制刷新缓存和界面
            if (this.storageManager.clearCache) {
              this.storageManager.clearCache()
            }
            
            // 触发树视图刷新
            if (this.context) {
              // 通过命令刷新树视图
              await vscode.commands.executeCommand('starcode-snippets.refreshExplorer')
            }
          } catch (refreshError) {
            console.warn('刷新界面失败:', refreshError)
          }
        }
        
        // 9. 更新同步状态并构建成功消息
        await this.dataSyncManager.updateSyncStatus(true)
        
        let finalMessage = syncResult.message
        
        // 根据实际提交状态构建消息
        if (actuallyCommitted && changedFilesCount > 0) {
          finalMessage = `同步成功！已提交并推送 ${changedFilesCount} 个文件到分支 ${targetBranch}\n\n${syncResult.message}`
        } else {
          finalMessage = `同步成功！数据已是最新状态（分支: ${targetBranch}）\n\n${syncResult.message}`
        }
        
        // 如果进行了自动合并，添加特殊提示
        if (syncResult.autoMerged) {
          finalMessage += `\n\n💡 如果发现VSCode中的数据与Git仓库不一致，可以使用"从Git仓库强制导入"命令修复。`
        }
        
        return {
          success: true,
          message: finalMessage,
          conflictsDetected: syncResult.conflictsDetected,
          conflictDetails: syncResult.conflictDetails
        }
      } else {
        // 没有合并数据的情况
        await this.dataSyncManager.updateSyncStatus(true)
        
        return {
          success: true,
          message: syncResult.message,
          conflictsDetected: syncResult.conflictsDetected,
          conflictDetails: syncResult.conflictDetails
        }
      }
    } catch (error) {
      console.error('同步失败:', error)
      
      await this.dataSyncManager.updateSyncStatus(false, error instanceof Error ? error.message : '未知错误')
      
      return {
        success: false,
        message: `同步失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 从云端拉取数据（安全模式）
   */
  public async pullFromCloud(): Promise<PullResult> {
    return await this.cloudOpsManager.pullFromCloud()
  }

  /**
   * 强制推送本地数据到云端（覆盖远程数据）
   */
  public async forcePushToCloud(currentSnippets: CodeSnippet[], currentDirectories: Directory[], userConfirmed: boolean = false): Promise<SyncResult> {
    return await this.cloudOpsManager.forcePushToCloud(currentSnippets, currentDirectories, userConfirmed)
  }

  /**
   * 从Git仓库强制导入数据到VSCode存储
   */
  public async forceImportFromGitRepo(): Promise<ForceImportResult> {
    return await this.cloudOpsManager.forceImportFromGitRepo()
  }

  /**
   * 应用用户手动解决的冲突文件
   */
  public async applyResolvedConflicts(): Promise<ConflictApplyResult> {
    return await this.cloudOpsManager.applyResolvedConflicts()
  }

  /**
   * 重置到远程状态
   */
  public async resetToRemote(branch?: string): Promise<{ success: boolean; message: string }> {
    return await this.cloudOpsManager.resetToRemote(branch)
  }

  /**
   * 检测本地变更
   */
  public async detectLocalChanges(currentSnippets: CodeSnippet[], currentDirectories: Directory[]): Promise<ChangeDetectionResult> {
    return await this.dataSyncManager.detectLocalChanges(currentSnippets, currentDirectories)
  }

  /**
   * 检查远程是否有更新
   */
  public async checkRemoteUpdates(): Promise<RemoteUpdateResult> {
    if (!this.isConfigured()) {
      throw new Error('云端同步未配置')
    }

    return await this.gitOpsManager.checkRemoteUpdates()
  }

  /**
   * 从Git仓库读取数据
   */
  public async readDataFromGitRepo(): Promise<{ snippets: CodeSnippet[]; directories: Directory[] }> {
    return await this.fileSystemManager.readDataFromGitRepo()
  }

  /**
   * 重新初始化仓库
   */
  public async reinitializeRepository(): Promise<{ success: boolean; message: string }> {
    return await this.gitOpsManager.reinitializeRepository()
  }

  /**
   * Git操作方法 - 直接委托给GitOperationsManager
   */
  public async gitPull(branch?: string): Promise<void> {
    return await this.gitOpsManager.gitPull(branch)
  }

  public async gitAddAll(): Promise<void> {
    return await this.gitOpsManager.gitAddAll()
  }

  public async gitCommit(message: string): Promise<void> {
    return await this.gitOpsManager.gitCommit(message)
  }

  public async gitPush(branch?: string): Promise<void> {
    return await this.gitOpsManager.gitPush(branch)
  }

  public async gitStatus(): Promise<any> {
    return await this.gitOpsManager.gitStatus()
  }

  public async gitFetch(): Promise<void> {
    return await this.gitOpsManager.gitFetch()
  }

  /**
   * 向后兼容的方法 - 保持原有API的兼容性
   */

  /**
   * @deprecated 使用 detectLocalChanges 代替
   */
  private async hasChanges(changeSet: any): Promise<boolean> {
    return this.dataSyncManager.hasChanges(changeSet)
  }

  /**
   * @deprecated 内部使用，不建议外部调用
   */
  private snippetToJson(snippet: CodeSnippet): string {
    return JSON.stringify(snippet, null, 2)
  }

  /**
   * @deprecated 内部使用，不建议外部调用
   */
  private jsonToSnippet(json: string): CodeSnippet {
    return JSON.parse(json)
  }

  /**
   * @deprecated 使用 fileSystemManager.writeDataToGitRepo 代替
   */
  private async writeDataToGitRepo(snippets: CodeSnippet[], directories: Directory[], updateTimestamp: boolean = true): Promise<void> {
    return await this.fileSystemManager.writeDataToGitRepo(snippets, directories, updateTimestamp)
  }
}
