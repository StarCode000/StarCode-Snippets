import * as vscode from 'vscode'
import { DetailedSyncStatus, SyncOperation, getSyncOperationDescription } from '../types/syncTypes'
import { SettingsManager } from './settingsManager'

/**
 * 详细同步状态管理器
 * 负责管理和显示同步过程中的详细状态信息
 */
export class DetailedSyncStatusManager {
  private static instance: DetailedSyncStatusManager | null = null
  private context: vscode.ExtensionContext | null = null
  private currentStatus: DetailedSyncStatus
  private statusChangeCallbacks: Array<(status: DetailedSyncStatus) => void> = []

  private constructor() {
    // 初始化默认状态
    this.currentStatus = {
      isSyncing: false,
      isConnected: false,
      lastSyncTime: null,
      lastError: null
    }
  }

  /**
   * 获取单例实例
   */
  public static getInstance(context?: vscode.ExtensionContext): DetailedSyncStatusManager {
    if (!DetailedSyncStatusManager.instance) {
      DetailedSyncStatusManager.instance = new DetailedSyncStatusManager()
    }
    
    if (context && !DetailedSyncStatusManager.instance.context) {
      DetailedSyncStatusManager.instance.context = context
      // 从持久化存储中恢复状态
      DetailedSyncStatusManager.instance.loadStatusFromStorage()
    }
    
    return DetailedSyncStatusManager.instance
  }

  /**
   * 注册状态变更回调
   */
  public onStatusChange(callback: (status: DetailedSyncStatus) => void): vscode.Disposable {
    this.statusChangeCallbacks.push(callback)
    
    // 立即通知当前状态
    callback(this.currentStatus)
    
    return {
      dispose: () => {
        const index = this.statusChangeCallbacks.indexOf(callback)
        if (index >= 0) {
          this.statusChangeCallbacks.splice(index, 1)
        }
      }
    }
  }

  /**
   * 开始同步操作
   */
  public async startSync(): Promise<void> {
    console.log('🚀 DetailedSyncStatusManager: 开始同步操作')
    
    this.currentStatus = {
      ...this.currentStatus,
      isSyncing: true,
      currentOperation: undefined,
      progress: 0,
      operationDescription: '准备开始同步...',
      operationStartTime: Date.now(),
      lastError: null
    }
    
    await this.saveStatusToStorage()
    this.notifyStatusChange()
  }

  /**
   * 更新当前操作
   */
  public async updateOperation(operation: SyncOperation, progress?: number): Promise<void> {
    const description = getSyncOperationDescription(operation)
    console.log(`🔄 DetailedSyncStatusManager: ${description} (进度: ${progress || 0}%)`)
    
    this.currentStatus = {
      ...this.currentStatus,
      currentOperation: operation,
      operationDescription: description,
      progress: progress || this.calculateProgressByOperation(operation)
    }
    
    await this.saveStatusToStorage()
    this.notifyStatusChange()
  }

  /**
   * 完成同步操作
   */
  public async completeSync(success: boolean, message?: string): Promise<void> {
    console.log(`✅ DetailedSyncStatusManager: 同步完成 - ${success ? '成功' : '失败'}`)
    
    this.currentStatus = {
      ...this.currentStatus,
      isSyncing: false,
      currentOperation: undefined,
      progress: success ? 100 : undefined,
      operationDescription: undefined,
      operationStartTime: undefined,
      isConnected: success,
      lastSyncTime: success ? Date.now() : this.currentStatus.lastSyncTime,
      lastError: success ? null : (message || '同步失败')
    }
    
    await this.saveStatusToStorage()
    this.notifyStatusChange()
  }

  /**
   * 设置错误状态
   */
  public async setError(error: string): Promise<void> {
    console.error(`❌ DetailedSyncStatusManager: 设置错误状态 - ${error}`)
    
    this.currentStatus = {
      ...this.currentStatus,
      isSyncing: false,
      currentOperation: undefined,
      progress: undefined,
      operationDescription: undefined,
      operationStartTime: undefined,
      isConnected: false,
      lastError: error
    }
    
    await this.saveStatusToStorage()
    this.notifyStatusChange()
  }

  /**
   * 获取当前状态
   */
  public getCurrentStatus(): DetailedSyncStatus {
    return { ...this.currentStatus }
  }

  /**
   * 获取状态栏显示文本
   */
  public getStatusBarText(): string {
    if (this.currentStatus.isSyncing) {
      if (this.currentStatus.operationDescription) {
        const progress = this.currentStatus.progress
        if (progress !== undefined) {
          return `${this.currentStatus.operationDescription} (${progress}%)`
        }
        return this.currentStatus.operationDescription
      }
      return '正在同步...'
    }

    if (this.currentStatus.lastError) {
      return `同步错误: ${this.currentStatus.lastError}`
    }

    if (this.currentStatus.isConnected && this.currentStatus.lastSyncTime) {
      const lastSyncText = this.formatLastSyncTime(this.currentStatus.lastSyncTime)
      return `上次同步: ${lastSyncText}`
    }

    if (this.currentStatus.isConnected) {
      return '已连接，未同步'
    }

    return '未连接'
  }

  /**
   * 获取状态图标
   */
  public getStatusIcon(): string {
    if (this.currentStatus.isSyncing) {
      return 'sync~spin'
    }

    if (this.currentStatus.lastError) {
      return 'warning'
    }

    if (this.currentStatus.isConnected) {
      return 'cloud'
    }

    return 'cloud-offline'
  }

  /**
   * 获取详细的工具提示信息
   */
  public getTooltip(): string {
    let tooltip = '点击打开云端同步设置\n\n'

    if (this.currentStatus.isSyncing) {
      tooltip += `状态: 正在同步\n`
      tooltip += `操作: ${this.currentStatus.operationDescription || '未知'}\n`
      
      if (this.currentStatus.progress !== undefined) {
        tooltip += `进度: ${this.currentStatus.progress}%\n`
      }
      
      if (this.currentStatus.operationStartTime) {
        const elapsed = Math.round((Date.now() - this.currentStatus.operationStartTime) / 1000)
        tooltip += `耗时: ${elapsed}秒\n`
      }
    } else {
      tooltip += `状态: ${this.currentStatus.isConnected ? '已连接' : '未连接'}\n`
      
      if (this.currentStatus.lastSyncTime) {
        const lastSync = new Date(this.currentStatus.lastSyncTime).toLocaleString()
        tooltip += `上次同步: ${lastSync}\n`
      }
      
      if (this.currentStatus.lastError) {
        tooltip += `最后错误: ${this.currentStatus.lastError}\n`
      }
    }

    return tooltip
  }

  /**
   * 根据操作类型计算进度
   */
  private calculateProgressByOperation(operation: SyncOperation): number {
    const progressMap: Record<SyncOperation, number> = {
      [SyncOperation.CHECKING_LOCAL_CHANGES]: 10,
      [SyncOperation.CHECKING_REMOTE_STATUS]: 20,
      [SyncOperation.PULLING_REMOTE_CHANGES]: 30,
      [SyncOperation.PERFORMING_MERGE]: 50,
      [SyncOperation.RESOLVING_CONFLICTS]: 60,
      [SyncOperation.STAGING_CHANGES]: 70,
      [SyncOperation.COMMITTING_CHANGES]: 80,
      [SyncOperation.PUSHING_TO_REMOTE]: 85,
      [SyncOperation.UPDATING_LOCAL_STORAGE]: 90,
      [SyncOperation.VALIDATING_RESULT]: 95,
      [SyncOperation.CLEANING_UP]: 98
    }
    
    return progressMap[operation] || 0
  }

  /**
   * 格式化上次同步时间
   */
  private formatLastSyncTime(timestamp: number): string {
    const now = Date.now()
    const diff = now - timestamp
    
    // 小于1分钟
    if (diff < 60 * 1000) {
      return '刚刚'
    }
    
    // 小于1小时
    if (diff < 60 * 60 * 1000) {
      const minutes = Math.floor(diff / (60 * 1000))
      return `${minutes}分钟前`
    }
    
    // 小于24小时
    if (diff < 24 * 60 * 60 * 1000) {
      const hours = Math.floor(diff / (60 * 60 * 1000))
      return `${hours}小时前`
    }
    
    // 超过24小时，显示具体日期
    return new Date(timestamp).toLocaleDateString()
  }

  /**
   * 通知状态变更
   */
  private notifyStatusChange(): void {
    for (const callback of this.statusChangeCallbacks) {
      try {
        callback(this.currentStatus)
      } catch (error) {
        console.error('DetailedSyncStatusManager: 状态变更回调错误:', error)
      }
    }
  }

  /**
   * 保存状态到持久化存储
   */
  private async saveStatusToStorage(): Promise<void> {
    if (!this.context) {
      return
    }

    try {
      // 使用VSCode的全局状态存储
      await this.context.globalState.update('detailedSyncStatus', this.currentStatus)
    } catch (error) {
      console.error('DetailedSyncStatusManager: 保存状态失败:', error)
    }
  }

  /**
   * 从持久化存储加载状态
   */
  private loadStatusFromStorage(): void {
    if (!this.context) {
      return
    }

    try {
      const savedStatus = this.context.globalState.get<DetailedSyncStatus>('detailedSyncStatus')
      if (savedStatus) {
        // 恢复状态，但确保不是同步中状态（防止异常退出后状态不一致）
        this.currentStatus = {
          ...savedStatus,
          isSyncing: false,
          currentOperation: undefined,
          progress: undefined,
          operationDescription: undefined,
          operationStartTime: undefined
        }
        
        console.log('DetailedSyncStatusManager: 从存储恢复状态:', this.currentStatus)
      }
    } catch (error) {
      console.error('DetailedSyncStatusManager: 加载状态失败:', error)
    }
  }

  /**
   * 重置状态
   */
  public async reset(): Promise<void> {
    console.log('🔄 DetailedSyncStatusManager: 重置状态')
    
    this.currentStatus = {
      isSyncing: false,
      isConnected: false,
      lastSyncTime: null,
      lastError: null
    }
    
    await this.saveStatusToStorage()
    this.notifyStatusChange()
  }
} 