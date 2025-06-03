import * as vscode from 'vscode'
import { CloudSyncConfig, CloudSyncStatus } from '../types/types'

export class SettingsManager {
  private static readonly CONFIG_KEY = 'starcode-snippets.cloudSync'
  private static readonly STATUS_KEY = 'starcode-snippets.cloudSyncStatus'
  private static extensionContext: vscode.ExtensionContext | null = null

  /**
   * 获取默认的云端同步配置
   */
  private static getDefaultConfig(): CloudSyncConfig {
    return {
      provider: '',
      repositoryUrl: '',
      token: '',
      localPath: '',
      defaultBranch: 'main',
      authenticationMethod: 'token',
      sshKeyPath: '',
      autoSync: false,
      syncInterval: 15, // 15分钟
      commitMessageTemplate: 'Sync snippets: {timestamp}',
    }
  }

  /**
   * 获取默认的云端同步状态
   */
  private static getDefaultStatus(): CloudSyncStatus {
    return {
      isConnected: false,
      lastSyncTime: null,
      lastError: null,
      isSyncing: false,
    }
  }

  /**
   * 获取云端同步配置
   */
  static getCloudSyncConfig(): CloudSyncConfig {
    const config = vscode.workspace.getConfiguration().get<CloudSyncConfig>(this.CONFIG_KEY)
    return { ...this.getDefaultConfig(), ...config }
  }

  /**
   * 保存云端同步配置
   */
  static async saveCloudSyncConfig(config: CloudSyncConfig): Promise<void> {
    await vscode.workspace.getConfiguration().update(this.CONFIG_KEY, config, vscode.ConfigurationTarget.Global)
  }

  /**
   * 获取云端同步状态
   */
  static getCloudSyncStatus(): CloudSyncStatus {
    const status = vscode.workspace.getConfiguration().get<CloudSyncStatus>(this.STATUS_KEY)
    return { ...this.getDefaultStatus(), ...status }
  }

  /**
   * 保存云端同步状态
   */
  static async saveCloudSyncStatus(status: CloudSyncStatus): Promise<void> {
    await vscode.workspace.getConfiguration().update(this.STATUS_KEY, status, vscode.ConfigurationTarget.Global)
  }

  /**
   * 验证配置是否完整
   */
  static validateConfig(config: CloudSyncConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = []

    if (!config.provider.trim()) {
      errors.push('Git 平台不能为空')
    }

    if (!config.repositoryUrl.trim()) {
      errors.push('仓库 URL 不能为空')
    }

    if (!config.localPath.trim()) {
      errors.push('本地仓库路径不能为空')
    }

    if (!config.defaultBranch.trim()) {
      errors.push('默认分支名不能为空')
    }

    // 验证认证方式相关字段
    if (config.authenticationMethod === 'token' && !config.token.trim()) {
      errors.push('使用令牌认证时，访问令牌不能为空')
    }

    if (config.authenticationMethod === 'ssh' && !config.sshKeyPath.trim()) {
      errors.push('使用SSH认证时，SSH密钥路径不能为空')
    }

    if (config.syncInterval <= 0) {
      errors.push('自动同步间隔必须大于0分钟')
    }

    if (config.syncInterval > 1440) {
      errors.push('自动同步间隔不能超过1440分钟（24小时）')
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  }

  /**
   * 重置配置为默认值
   */
  static async resetConfig(): Promise<void> {
    await this.saveCloudSyncConfig(this.getDefaultConfig())
    await this.saveCloudSyncStatus(this.getDefaultStatus())
  }

  /**
   * 设置扩展上下文
   */
  static setExtensionContext(context: vscode.ExtensionContext): void {
    this.extensionContext = context
  }

  /**
   * 获取扩展上下文
   */
  static getExtensionContext(): vscode.ExtensionContext | null {
    return this.extensionContext
  }
}
