import * as vscode from 'vscode'
import { CloudSyncManager } from './cloudSyncManager'
import { StorageManager } from '../storage/storageManager'
import { SettingsManager } from './settingsManager'
import { ContextManager } from './contextManager'

export class AutoSyncManager {
  private syncTimer: any = null
  private isRunning = false
  private cloudSyncManager: CloudSyncManager
  private storageManager: StorageManager
  private context: vscode.ExtensionContext
  private refreshCallback?: () => void

  constructor(context: vscode.ExtensionContext, storageManager: StorageManager) {
    this.context = context
    this.storageManager = storageManager
    this.cloudSyncManager = new CloudSyncManager(context, storageManager)
  }

  /**
   * 设置树视图刷新回调
   */
  public setRefreshCallback(callback: () => void): void {
    this.refreshCallback = callback
  }

  /**
   * 启动自动同步
   */
  public start(): void {
    if (this.isRunning) {
      console.log('自动同步已在运行中')
      return
    }

    const config = SettingsManager.getCloudSyncConfig()

    if (!config.autoSync) {
      console.log('自动同步未启用')
      return
    }

    if (!this.cloudSyncManager.isConfigured()) {
      console.log('云端同步未配置，无法启动自动同步')
      return
    }

    const intervalMs = (config.syncInterval || 60) * 1000 // 转换为毫秒

    console.log(`启动自动同步，间隔: ${config.syncInterval}秒`)

    this.isRunning = true
    this.scheduleNextSync(intervalMs)

    // 显示状态栏提示
    const statusBarItem = vscode.window.setStatusBarMessage(`🔄 自动同步已启动 (${config.syncInterval}秒间隔)`)
    setTimeout(() => statusBarItem.dispose(), 3000)
  }

  /**
   * 停止自动同步
   */
  public stop(): void {
    if (!this.isRunning) {
      console.log('自动同步未在运行')
      return
    }

    if (this.syncTimer) {
      clearTimeout(this.syncTimer)
      this.syncTimer = null
    }

    this.isRunning = false
    console.log('自动同步已停止')

    // 显示状态栏提示
    const statusBarItem = vscode.window.setStatusBarMessage('⏹️ 自动同步已停止')
    setTimeout(() => statusBarItem.dispose(), 3000)
  }

  /**
   * 重启自动同步（配置更改时调用）
   */
  public restart(): void {
    console.log('重启自动同步...')
    this.stop()

    // 短暂延迟后重新启动，确保配置已更新
    setTimeout(() => {
      this.start()
    }, 1000)
  }

  /**
   * 检查是否正在运行
   */
  public get isActive(): boolean {
    return this.isRunning
  }

  /**
   * 安排下一次同步
   */
  private scheduleNextSync(intervalMs: number): void {
    this.syncTimer = setTimeout(async () => {
      if (!this.isRunning) {
        return // 如果已停止，不执行同步
      }

      try {
        await this.performAutoSync()
      } catch (error) {
        console.error('自动同步执行失败:', error)

        // 同步失败时显示错误，但继续定时器
        const errorMessage = error instanceof Error ? error.message : '未知错误'
        vscode.window.showErrorMessage(`自动同步失败: ${errorMessage}`, '查看设置').then((selection) => {
          if (selection === '查看设置') {
            vscode.commands.executeCommand('starcode-snippets.openSettings')
          }
        })
      }

      // 安排下一次同步
      if (this.isRunning) {
        this.scheduleNextSync(intervalMs)
      }
    }, intervalMs)
  }

  /**
   * 执行自动同步
   */
  private async performAutoSync(): Promise<void> {
    console.log('执行自动同步...')

    // 检查是否正在编辑代码片段
    if (ContextManager.isEditingSnippet()) {
      console.log('用户正在编辑代码片段，跳过此次自动同步')
      return // 跳过此次同步，但不停止定时器
    }

    // 检查配置是否仍然有效
    const config = SettingsManager.getCloudSyncConfig()
    if (!config.autoSync) {
      console.log('自动同步已被禁用，停止定时器')
      this.stop()
      return
    }

    if (!this.cloudSyncManager.isConfigured()) {
      console.log('云端同步配置无效，停止自动同步')
      this.stop()
      vscode.window.showWarningMessage('云端同步配置无效，自动同步已停止', '查看设置').then((selection) => {
        if (selection === '查看设置') {
          vscode.commands.executeCommand('starcode-snippets.openSettings')
        }
      })
      return
    }

    try {
      // 获取当前数据
      const [snippets, directories] = await Promise.all([
        this.storageManager.getAllSnippets(),
        this.storageManager.getAllDirectories(),
      ])

      // 执行同步
      const result = await this.cloudSyncManager.performSync(snippets, directories)

      if (result.success) {
        console.log('自动同步成功:', result.message)

        // 更新同步状态
        const status = SettingsManager.getCloudSyncStatus()
        status.lastSyncTime = Date.now()
        status.isConnected = true
        status.lastError = null
        await SettingsManager.saveCloudSyncStatus(status)

        // 刷新树视图以更新同步状态显示
        if (this.refreshCallback) {
          this.refreshCallback()
        }

        // 静默成功，不显示通知（避免打扰用户）
        // 只在控制台记录
      } else {
        console.warn('自动同步失败:', result.message)

        // 更新错误状态
        const status = SettingsManager.getCloudSyncStatus()
        status.isConnected = false
        status.lastError = result.message
        await SettingsManager.saveCloudSyncStatus(status)

        // 失败时显示非侵入式通知
        const statusBarItem = vscode.window.setStatusBarMessage(`❌ 自动同步失败: ${result.message}`)
        setTimeout(() => statusBarItem.dispose(), 5000)
      }
    } catch (error) {
      console.error('自动同步异常:', error)

      const errorMessage = error instanceof Error ? error.message : '未知错误'

      // 更新错误状态
      const status = SettingsManager.getCloudSyncStatus()
      status.isConnected = false
      status.lastError = errorMessage
      await SettingsManager.saveCloudSyncStatus(status)

      throw error // 重新抛出，让上层处理
    }
  }

  /**
   * 获取当前状态信息
   */
  public getStatus(): {
    isRunning: boolean
    nextSyncTime: Date | null
    intervalSeconds: number
  } {
    const config = SettingsManager.getCloudSyncConfig()
    const intervalSeconds = config.syncInterval || 60

    let nextSyncTime: Date | null = null
    if (this.isRunning && this.syncTimer) {
      // 估算下次同步时间（不完全准确，但足够用于显示）
      nextSyncTime = new Date(Date.now() + intervalSeconds * 1000)
    }

    return {
      isRunning: this.isRunning,
      nextSyncTime,
      intervalSeconds,
    }
  }

  /**
   * 立即执行一次同步（不影响定时器）
   */
  public async syncNow(): Promise<{ success: boolean; message: string }> {
    console.log('立即执行同步...')

    // 检查是否正在编辑代码片段
    if (ContextManager.isEditingSnippet()) {
      console.log('用户正在编辑代码片段，无法执行同步')
      return {
        success: false,
        message: '用户正在编辑代码片段，请完成编辑后再同步',
      }
    }

    try {
      const [snippets, directories] = await Promise.all([
        this.storageManager.getAllSnippets(),
        this.storageManager.getAllDirectories(),
      ])

      const result = await this.cloudSyncManager.performSync(snippets, directories)

      if (result.success) {
        // 更新同步状态
        const status = SettingsManager.getCloudSyncStatus()
        status.lastSyncTime = Date.now()
        status.isConnected = true
        status.lastError = null
        await SettingsManager.saveCloudSyncStatus(status)

        // 刷新树视图以更新同步状态显示
        if (this.refreshCallback) {
          this.refreshCallback()
        }
      }

      return result
    } catch (error) {
      console.error('立即同步异常:', error)
      const errorMessage = error instanceof Error ? error.message : '未知错误'

      // 更新错误状态
      const status = SettingsManager.getCloudSyncStatus()
      status.isConnected = false
      status.lastError = errorMessage
      await SettingsManager.saveCloudSyncStatus(status)

      return {
        success: false,
        message: errorMessage,
      }
    }
  }

  /**
   * 清理资源
   */
  public dispose(): void {
    this.stop()
  }
}
