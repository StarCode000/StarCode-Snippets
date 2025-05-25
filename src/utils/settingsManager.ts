import * as vscode from 'vscode';
import { CloudSyncConfig, CloudSyncStatus } from '../models/types';

export class SettingsManager {
  private static readonly CONFIG_KEY = 'starcode-snippets.cloudSync';
  private static readonly STATUS_KEY = 'starcode-snippets.cloudSyncStatus';
  private static extensionContext: vscode.ExtensionContext | null = null;

  /**
   * 获取默认的云端同步配置
   */
  private static getDefaultConfig(): CloudSyncConfig {
    return {
      endpoint: '',
      accessKey: '',
      secretKey: '',
      bucket: '',
      region: '',
      timeout: 30,
      addressing: 'virtual-hosted-style',
      autoSync: false,
      syncInterval: 60,
      concurrency: 3
    };
  }

  /**
   * 获取默认的云端同步状态
   */
  private static getDefaultStatus(): CloudSyncStatus {
    return {
      isConnected: false,
      lastSyncTime: null,
      lastError: null,
      isSyncing: false
    };
  }

  /**
   * 获取云端同步配置
   */
  static getCloudSyncConfig(): CloudSyncConfig {
    const config = vscode.workspace.getConfiguration().get<CloudSyncConfig>(this.CONFIG_KEY);
    return { ...this.getDefaultConfig(), ...config };
  }

  /**
   * 保存云端同步配置
   */
  static async saveCloudSyncConfig(config: CloudSyncConfig): Promise<void> {
    await vscode.workspace.getConfiguration().update(
      this.CONFIG_KEY,
      config,
      vscode.ConfigurationTarget.Global
    );
  }

  /**
   * 获取云端同步状态
   */
  static getCloudSyncStatus(): CloudSyncStatus {
    const status = vscode.workspace.getConfiguration().get<CloudSyncStatus>(this.STATUS_KEY);
    return { ...this.getDefaultStatus(), ...status };
  }

  /**
   * 保存云端同步状态
   */
  static async saveCloudSyncStatus(status: CloudSyncStatus): Promise<void> {
    await vscode.workspace.getConfiguration().update(
      this.STATUS_KEY,
      status,
      vscode.ConfigurationTarget.Global
    );
  }

  /**
   * 验证配置是否完整
   */
  static validateConfig(config: CloudSyncConfig): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.endpoint.trim()) {
      errors.push('Endpoint 不能为空');
    }

    if (!config.accessKey.trim()) {
      errors.push('Access Key 不能为空');
    }

    if (!config.secretKey.trim()) {
      errors.push('Secret Key 不能为空');
    }

    if (!config.bucket.trim()) {
      errors.push('Bucket 不能为空');
    }

    if (!config.region.trim()) {
      errors.push('Region ID 不能为空');
    }

    if (config.timeout <= 0) {
      errors.push('连接超时时间必须大于0');
    }

    if (config.syncInterval <= 0) {
      errors.push('自动同步间隔必须大于0秒');
    }

    if (config.syncInterval > 3600) {
      errors.push('自动同步间隔不能超过3600秒（1小时）');
    }

    if (config.concurrency <= 0) {
      errors.push('请求并发数必须大于0');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * 重置配置为默认值
   */
  static async resetConfig(): Promise<void> {
    await this.saveCloudSyncConfig(this.getDefaultConfig());
    await this.saveCloudSyncStatus(this.getDefaultStatus());
  }

  /**
   * 设置扩展上下文
   */
  static setExtensionContext(context: vscode.ExtensionContext): void {
    this.extensionContext = context;
  }

  /**
   * 获取扩展上下文
   */
  static getExtensionContext(): vscode.ExtensionContext | null {
    return this.extensionContext;
  }
} 