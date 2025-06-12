import * as vscode from 'vscode'

/**
 * 【Git 标准】简化状态接口
 * 
 * 只跟踪最基本的状态信息，遵循Git的简洁哲学
 */
export interface GitStandardStatus {
  isConfigured: boolean      // 是否已配置Git
  isConnected: boolean       // 是否能连接到远程
  isOperating: boolean       // 是否正在执行操作
  lastOperation: string | null // 最后执行的操作
  lastResult: 'success' | 'failed' | null // 最后的操作结果
  lastMessage: string | null // 最后的状态消息
  timestamp: number | null   // 最后更新时间
}

/**
 * 【Git 标准】状态管理器
 * 
 * 提供简单、直接的状态管理，类似于 git status 的简洁输出
 */
export class GitStandardStatusManager {
  private static instance: GitStandardStatusManager
  private context: vscode.ExtensionContext
  private statusBarItem: vscode.StatusBarItem

  private constructor(context: vscode.ExtensionContext) {
    this.context = context
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right, 
      100
    )
    this.statusBarItem.command = 'starcode-snippets.showSyncStatus'
    this.statusBarItem.show()
    this.updateStatusBar()
  }

  public static getInstance(context: vscode.ExtensionContext): GitStandardStatusManager {
    if (!this.instance) {
      this.instance = new GitStandardStatusManager(context)
    }
    return this.instance
  }

  /**
   * 【Git 标准】获取当前状态
   */
  public async getStatus(): Promise<GitStandardStatus> {
    const defaultStatus: GitStandardStatus = {
      isConfigured: false,
      isConnected: false,
      isOperating: false,
      lastOperation: null,
      lastResult: null,
      lastMessage: null,
      timestamp: null
    }

    return this.context.globalState.get('gitStandardStatus', defaultStatus)
  }

  /**
   * 【Git 标准】更新状态
   */
  public async updateStatus(updates: Partial<GitStandardStatus>): Promise<void> {
    const currentStatus = await this.getStatus()
    const newStatus: GitStandardStatus = {
      ...currentStatus,
      ...updates,
      timestamp: Date.now()
    }

    await this.context.globalState.update('gitStandardStatus', newStatus)
    this.updateStatusBar()

    // 记录简单日志
    if (updates.lastOperation && updates.lastResult) {
      console.log(`📊 Git状态更新: ${updates.lastOperation} - ${updates.lastResult}`)
    }
  }

  /**
   * 【Git 标准】开始操作
   */
  public async startOperation(operation: string): Promise<void> {
    await this.updateStatus({
      isOperating: true,
      lastOperation: operation,
      lastResult: null,
      lastMessage: `正在执行: ${operation}`
    })
  }

  /**
   * 【Git 标准】完成操作
   */
  public async completeOperation(
    success: boolean, 
    message: string
  ): Promise<void> {
    await this.updateStatus({
      isOperating: false,
      lastResult: success ? 'success' : 'failed',
      lastMessage: message
    })
  }

  /**
   * 【Git 标准】设置配置状态
   */
  public async setConfigured(configured: boolean): Promise<void> {
    await this.updateStatus({
      isConfigured: configured
    })
  }

  /**
   * 【Git 标准】设置连接状态
   */
  public async setConnected(connected: boolean): Promise<void> {
    await this.updateStatus({
      isConnected: connected
    })
  }

  /**
   * 【Git 标准】获取状态摘要
   * 类似于 git status --porcelain
   */
  public async getStatusSummary(): Promise<string> {
    const status = await this.getStatus()
    
    if (!status.isConfigured) {
      return '❌ Git 未配置'
    }
    
    if (status.isOperating) {
      return `🔄 ${status.lastOperation || '正在操作...'}`
    }
    
    if (!status.isConnected) {
      return '🔌 Git 连接断开'
    }
    
    if (status.lastResult === 'success') {
      return '✅ Git 状态正常'
    }
    
    if (status.lastResult === 'failed') {
      return '❌ Git 操作失败'
    }
    
    return '📊 Git 状态未知'
  }

  /**
   * 更新状态栏显示
   */
  private async updateStatusBar(): Promise<void> {
    const summary = await this.getStatusSummary()
    const status = await this.getStatus()
    
    // 设置状态栏文本
    this.statusBarItem.text = `$(git-branch) ${this.getShortStatus(summary)}`
    
    // 设置工具提示
    let tooltip = `StarCode Snippets - Git 状态\n\n${summary}`
    
    if (status.lastMessage) {
      tooltip += `\n\n最后消息: ${status.lastMessage}`
    }
    
    if (status.timestamp) {
      const lastUpdate = new Date(status.timestamp).toLocaleString()
      tooltip += `\n最后更新: ${lastUpdate}`
    }
    
    this.statusBarItem.tooltip = tooltip
    
    // 设置颜色
    this.statusBarItem.color = this.getStatusColor(status)
  }

  /**
   * 获取简短状态文本
   */
  private getShortStatus(summary: string): string {
    if (summary.includes('未配置')) {
      return '未配置'
    }
    if (summary.includes('正在操作') || summary.includes('🔄')) {
      return '同步中'
    }
    if (summary.includes('连接断开')) {
      return '离线'
    }
    if (summary.includes('正常')) {
      return '已同步'
    }
    if (summary.includes('失败')) {
      return '失败'
    }
    return '未知'
  }

  /**
   * 获取状态颜色
   */
  private getStatusColor(status: GitStandardStatus): string | undefined {
    if (!status.isConfigured) {
      return '#ff6b6b' // 红色：未配置
    }
    
    if (status.isOperating) {
      return '#4ecdc4' // 青色：操作中
    }
    
    if (!status.isConnected) {
      return '#ffa726' // 橙色：连接问题
    }
    
    if (status.lastResult === 'success') {
      return '#66bb6a' // 绿色：成功
    }
    
    if (status.lastResult === 'failed') {
      return '#ef5350' // 红色：失败
    }
    
    return undefined // 默认颜色
  }

  /**
   * 【向后兼容】显示详细状态
   * 为保持与现有UI的兼容性
   */
  public async showDetailedStatus(): Promise<void> {
    const status = await this.getStatus()
    const summary = await this.getStatusSummary()
    
    let message = `Git 同步状态\n\n${summary}\n\n`
    
    if (status.lastOperation) {
      message += `最后操作: ${status.lastOperation}\n`
    }
    
    if (status.lastMessage) {
      message += `状态消息: ${status.lastMessage}\n`
    }
    
    if (status.timestamp) {
      const lastUpdate = new Date(status.timestamp).toLocaleString()
      message += `更新时间: ${lastUpdate}\n`
    }
    
    vscode.window.showInformationMessage(message)
  }

  /**
   * 清理和重置状态
   */
  public async reset(): Promise<void> {
    await this.context.globalState.update('gitStandardStatus', undefined)
    this.updateStatusBar()
  }

  /**
   * 释放资源
   */
  public dispose(): void {
    this.statusBarItem.dispose()
  }
} 