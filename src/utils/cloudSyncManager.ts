import * as vscode from 'vscode'
import { CloudSyncConfig, CloudSyncStatus, CodeSnippet, Directory } from '../types/types'
import { SettingsManager } from './settingsManager'

// 导入已拆分的模块
import { GitOperationsManager } from './git/gitOperationsManager'
import { ConnectionTester } from './git/connectionTester'
import { DataSyncManager } from './sync/dataSyncManager'
import { FileSystemManager } from './sync/fileSystemManager'
import { CloudOperationsManager } from './sync/cloudOperationsManager'
import { SyncResult, ChangeDetectionResult, RemoteUpdateResult, PullResult, ForceImportResult, ConflictApplyResult, RemoteCheckResult, SyncOperation } from '../types/syncTypes'
import { DetailedSyncStatusManager } from './detailedSyncStatusManager'
import { showConflictResolutionDialog } from '../commands/conflictMergeCommand'

/**
 * 【Git 标准】云端同步管理器
 * 
 * 提供简化的、符合Git标准的API接口：
 * - sync(): 标准的Git同步流程
 * - clone(): 从远程克隆数据
 * - status(): 检查同步状态
 * - test(): 测试连接
 * 
 * 参考：Git的基本操作哲学，简单、直接、可预测
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
  private detailedStatusManager!: DetailedSyncStatusManager

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
    this.detailedStatusManager = DetailedSyncStatusManager.getInstance(this.context || undefined)
  }

  /**
   * 【Git 标准】检查是否已配置同步
   */
  public isConfigured(): boolean {
    return !!(
      this.config.provider &&
      this.config.repositoryUrl &&
      (this.config.authenticationMethod === 'ssh' || this.config.token)
    )
  }

  /**
   * 【Git 标准】测试连接
   * 等同于 git ls-remote
   */
  public async test(): Promise<{ success: boolean; message: string }> {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: 'Git 同步配置不完整',
      }
    }

    return await this.connectionTester.testConnection()
  }

  /**
   * 【Git 标准】执行同步
   * 等同于 git pull && git add . && git commit && git push
   * 
   * 这是主要的同步API，遵循Git的标准流程：
   * 1. Fetch 远程数据
   * 2. 执行三路合并
   * 3. 如有冲突则停止
   * 4. 否则提交并推送
   */
  public async sync(
    currentSnippets: CodeSnippet[], 
    currentDirectories: Directory[]
  ): Promise<SyncResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: 'Git 同步未配置，请先配置仓库信息',
      }
    }

    try {
      console.log('🚀 开始Git标准同步...')
      
      // 启动详细状态管理
      await this.detailedStatusManager.startSync()
      
      // 更新同步状态
      await this.dataSyncManager.startSyncStatus()
      
      // 1. 初始化Git仓库
      await this.detailedStatusManager.updateOperation(SyncOperation.CHECKING_LOCAL_CHANGES)
      const git = await this.gitOpsManager.getGitInstance()
      console.log('✅ Git仓库已初始化')

      // 2. 设置正确的分支
      const targetBranch = this.config.defaultBranch || 'main'
      await this.ensureBranch(targetBranch)

      // 3. 检查远程状态
      await this.detailedStatusManager.updateOperation(SyncOperation.CHECKING_REMOTE_STATUS)
      const remoteCheckResult = await this.gitOpsManager.checkRemoteRepositoryStatus(targetBranch)
      
      // 4. 执行Git标准同步流程
      await this.detailedStatusManager.updateOperation(SyncOperation.PERFORMING_MERGE)
      const syncResult = await this.performSyncFlowWithDetailedStatus(
        currentSnippets, 
        currentDirectories, 
        remoteCheckResult
      )
      
      // 5. 完成同步状态
      await this.detailedStatusManager.completeSync(syncResult.success, syncResult.message)
      await this.dataSyncManager.updateSyncStatus(syncResult.success, syncResult.message)
        
      return syncResult

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      console.error('❌ 同步失败:', errorMessage)
      
      // 设置错误状态
      await this.detailedStatusManager.setError(errorMessage)
      await this.dataSyncManager.updateSyncStatus(false, `同步失败: ${errorMessage}`)
        
          return {
            success: false,
        message: `同步失败: ${errorMessage}`,
      }
    }
  }

  /**
   * 【Git 标准】从远程克隆数据
   * 等同于 git clone
   */
  public async clone(): Promise<ForceImportResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: 'Git 同步未配置，请先配置仓库信息',
        imported: { snippets: 0, directories: 0 }
      }
    }

    return await this.cloudOpsManager.forceImportFromGitRepo()
  }

  /**
   * 【Git 标准】检查状态
   * 等同于 git status
   */
  public async status(
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[]
  ): Promise<{
    hasLocalChanges: boolean
    hasRemoteChanges: boolean
    message: string
  }> {
    if (!this.isConfigured()) {
      return {
        hasLocalChanges: false,
        hasRemoteChanges: false,
        message: 'Git 同步未配置'
      }
    }

    try {
      // 检查本地变更
      const localChanges = await this.dataSyncManager.detectLocalChanges(
        currentSnippets,
        currentDirectories
        )
        
      // 检查远程变更
      const remoteChanges = await this.gitOpsManager.checkRemoteUpdates()

      return {
        hasLocalChanges: localChanges.hasChanges,
        hasRemoteChanges: remoteChanges.hasUpdates,
        message: this.formatStatusMessage(localChanges.hasChanges, remoteChanges.hasUpdates)
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误'
                return {
        hasLocalChanges: false,
        hasRemoteChanges: false,
        message: `状态检查失败: ${errorMessage}`
      }
    }
  }

  /**
   * 更新配置
   */
  public async updateConfig(newConfig: CloudSyncConfig): Promise<{
    platformChanged: boolean
    needsAttention: boolean
    message?: string
  }> {
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
    
    // 如果平台发生变更，提示用户
                  return {
      platformChanged: true,
      needsAttention: true,
      message: `Git平台已切换：${oldConfig.provider || '未知'} → ${newConfig.provider}`
                  }
                }
                
  // ==================== 私有辅助方法 ====================

  /**
   * 确保分支存在并切换到目标分支
   */
  private async ensureBranch(targetBranch: string): Promise<void> {
    try {
      const git = await this.gitOpsManager.getGitInstance()
      
      // 获取当前分支
      const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']).catch(() => 'main')
      
      if (currentBranch !== targetBranch) {
        // 检查目标分支是否存在
        const branches = await git.branchLocal()
        
        if (branches.all.includes(targetBranch)) {
          // 分支存在，直接切换
          await git.checkout(targetBranch)
        } else {
          // 分支不存在，创建并切换
          await git.checkoutLocalBranch(targetBranch)
            }
            
        console.log(`✅ 已切换到分支: ${targetBranch}`)
        }
    } catch (error) {
      console.warn('⚠️ 分支切换失败:', error)
      // 继续执行，不阻断同步流程
          }
        }
        
  /**
   * 执行带详细状态更新的同步流程
   */
  private async performSyncFlowWithDetailedStatus(
    currentSnippets: CodeSnippet[], 
    currentDirectories: Directory[], 
    remoteCheckResult: RemoteCheckResult
  ): Promise<SyncResult> {
          try {
      // 检查是否需要拉取远程变更
      if (remoteCheckResult.remoteHasData && !remoteCheckResult.isRemoteEmpty) {
        await this.detailedStatusManager.updateOperation(SyncOperation.PULLING_REMOTE_CHANGES)
            }
            
      // 执行数据同步流程
      const syncResult = await this.dataSyncManager.performSyncFlow(
        currentSnippets, 
        currentDirectories, 
        remoteCheckResult,
        this.gitOpsManager,
        this.fileSystemManager
      )

      // 【新增】处理需要用户确认的情况
      if (!syncResult.success && (syncResult as any).needsUserConfirmation) {
        console.log('🤔 检测到数据冲突，需要用户选择解决方式...')
        
        const localDataInfo = (syncResult as any).localDataInfo || { snippets: 0, directories: 0 }
        const userChoice = await showConflictResolutionDialog(localDataInfo)
        
        if (userChoice === 'cancel') {
          return {
            success: false,
            message: '用户取消了同步操作'
          }
        }
        
        // 根据用户选择执行相应操作
        if (userChoice === 'smart_merge') {
          // 强制执行智能合并
          const retryResult = await this.dataSyncManager.performSyncFlow(
            currentSnippets, 
            currentDirectories, 
            remoteCheckResult,
            this.gitOpsManager,
            this.fileSystemManager,
            { forceSmartMerge: true } // 传递强制智能合并标志
          )
          
          if (!retryResult.success) {
            return {
              success: false,
              message: `智能合并失败: ${retryResult.message}`
            }
          }
          
          // 智能合并成功，继续下面的流程
          return retryResult
          
        } else if (userChoice === 'force_local') {
          // 强制使用本地数据
          const retryResult = await this.dataSyncManager.performSyncFlow(
            currentSnippets, 
            currentDirectories, 
            remoteCheckResult,
            this.gitOpsManager,
            this.fileSystemManager,
            { forceUseLocal: true }
          )
          return retryResult
          
        } else if (userChoice === 'force_remote') {
          // 强制使用远程数据
          const retryResult = await this.dataSyncManager.performSyncFlow(
            currentSnippets, 
            currentDirectories, 
            remoteCheckResult,
            this.gitOpsManager,
            this.fileSystemManager,
            { forceUseRemote: true }
          )
          return retryResult
          
        } else if (userChoice === 'manual') {
          // 打开手动冲突解决工具
          vscode.commands.executeCommand('starcode-snippets.resolveConflicts')
          return {
            success: false,
            message: '已打开冲突解决工具，请手动解决冲突后重新同步'
          }
        }
      }
      
      // 根据同步结果更新状态
      if (syncResult.success) {
        // 如果同步成功，显示后续步骤
        await this.detailedStatusManager.updateOperation(SyncOperation.STAGING_CHANGES)
        await new Promise(resolve => setTimeout(resolve, 300)) // 短暂延迟让用户看到状态
        
        await this.detailedStatusManager.updateOperation(SyncOperation.COMMITTING_CHANGES)
        await new Promise(resolve => setTimeout(resolve, 300))
        
        await this.detailedStatusManager.updateOperation(SyncOperation.PUSHING_TO_REMOTE)
        await new Promise(resolve => setTimeout(resolve, 300))
        
        // 根据消息内容判断是否需要更新本地存储
        if (syncResult.message.includes('远程更改已合并') || syncResult.message.includes('已成功合并')) {
          await this.detailedStatusManager.updateOperation(SyncOperation.UPDATING_LOCAL_STORAGE)
          await new Promise(resolve => setTimeout(resolve, 300))
        }
        
        await this.detailedStatusManager.updateOperation(SyncOperation.VALIDATING_RESULT)
        await new Promise(resolve => setTimeout(resolve, 200))
        
        await this.detailedStatusManager.updateOperation(SyncOperation.CLEANING_UP)
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      
      return syncResult
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      console.error('❌ 详细状态同步失败:', errorMessage)
      throw error
    }
  }

  /**
   * 格式化状态消息
   */
  private formatStatusMessage(hasLocalChanges: boolean, hasRemoteChanges: boolean): string {
    if (!hasLocalChanges && !hasRemoteChanges) {
      return '✅ 本地和远程数据都是最新的'
    }
    
    if (hasLocalChanges && hasRemoteChanges) {
      return '📊 本地和远程都有变更，需要同步'
    }
    
    if (hasLocalChanges) {
      return '📝 本地有未同步的变更'
    }
    
    return '📥 远程有新的变更可拉取'
  }

  // ==================== 向后兼容的方法 ====================
  // 这些方法保留以维持向后兼容，但标记为已废弃

    /**
   * @deprecated 使用 sync() 方法代替
   * 保留此方法仅为向后兼容，已完成所有调用点的迁移
   */
  public async performSync(currentSnippets: CodeSnippet[], currentDirectories: Directory[]): Promise<SyncResult> {
    // 已修复所有调用点，移除警告信息
    return this.sync(currentSnippets, currentDirectories)
  }
        
  /**
   * @deprecated 使用 test() 方法代替
   */
  public async testConnection(): Promise<{ success: boolean; message: string }> {
    console.warn('⚠️ testConnection() 已废弃，请使用 test() 方法')
    return this.test()
  }

  /**
   * @deprecated 使用 clone() 方法代替
   */
  public async forceImportFromGitRepo(): Promise<ForceImportResult> {
    console.warn('⚠️ forceImportFromGitRepo() 已废弃，请使用 clone() 方法')
    return this.clone()
  }

  // ==================== 向后兼容的复杂方法 ====================
  // 这些方法保留以维持向后兼容，内部使用标准Git方法

  /**
   * @deprecated 使用更简单的 Git 操作代替
   */
  public async reinitializeRepository(): Promise<{ success: boolean; message: string }> {
    console.warn('⚠️ reinitializeRepository() 是复杂的操作，建议使用标准Git命令')
    try {
      return await this.gitOpsManager.reinitializeRepository()
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : '重新初始化失败'
      }
    }
  }

  /**
   * @deprecated 使用 clone() 方法代替
   */
  public async pullFromCloud(): Promise<PullResult> {
    console.warn('⚠️ pullFromCloud() 已废弃，建议使用 clone() 方法')
    return await this.cloudOpsManager.pullFromCloud()
  }

  /**
   * @deprecated 使用 sync() 方法代替
   */
  public async forcePushToCloud(
    currentSnippets: CodeSnippet[], 
    currentDirectories: Directory[], 
    userConfirmed: boolean = false
  ): Promise<SyncResult> {
    console.warn('⚠️ forcePushToCloud() 是危险操作，建议使用标准的 sync() 方法')
    return await this.cloudOpsManager.forcePushToCloud(currentSnippets, currentDirectories, userConfirmed)
  }

  /**
   * @deprecated 冲突应该在 sync() 过程中自动处理
   */
  public async applyResolvedConflicts(): Promise<ConflictApplyResult> {
    console.warn('⚠️ applyResolvedConflicts() 已废弃，冲突处理已集成到 sync() 方法中')
    return await this.cloudOpsManager.applyResolvedConflicts()
  }

  // ==================== 内部 Git 操作（保留用于子模块） ====================

  public async readDataFromGitRepo(): Promise<{ snippets: CodeSnippet[]; directories: Directory[] }> {
    return await this.fileSystemManager.readFromGit()
  }

  public async gitPull(branch?: string): Promise<void> {
    await this.gitOpsManager.gitPull(branch)
  }

  public async gitAddAll(): Promise<void> {
    await this.gitOpsManager.gitAddAll()
  }

  public async gitCommit(message: string): Promise<void> {
    await this.gitOpsManager.gitCommit(message)
  }

  public async gitPush(branch?: string): Promise<void> {
    await this.gitOpsManager.gitPush(branch)
  }

  public async gitStatus(): Promise<any> {
    return await this.gitOpsManager.gitStatus()
  }

  public async getGitInstance(): Promise<any> {
    return await this.gitOpsManager.getGitInstance()
  }

  public async checkRemoteUpdates(): Promise<RemoteUpdateResult> {
    return await this.gitOpsManager.checkRemoteUpdates()
  }
}
