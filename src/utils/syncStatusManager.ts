import * as vscode from 'vscode';
import { CloudSyncStatus } from '../models/types';

export interface DetailedSyncStatus {
  isConnected: boolean;
  isSyncing: boolean;
  lastSyncTime: number | null;
  lastError: string | null;
  syncProgress?: {
    current: number;
    total: number;
    operation: string;
  };
  performanceMetrics?: {
    averageSyncTime: number;
    successRate: number;
    lastThroughput: number;
  };
  networkStatus?: {
    quality: 'good' | 'poor' | 'offline';
    latency: number;
  };
}

export interface SyncEvent {
  timestamp: number;
  type: 'start' | 'progress' | 'success' | 'error' | 'conflict';
  operation: string;
  details?: any;
  duration?: number;
  error?: string;
}

export class SyncStatusManager {
  private static instance: SyncStatusManager;
  private context: vscode.ExtensionContext;
  private statusBarItem: vscode.StatusBarItem;
  private eventLog: SyncEvent[] = [];
  private maxLogEntries = 1000;
  private performanceHistory: Array<{
    timestamp: number;
    duration: number;
    success: boolean;
    dataSize: number;
  }> = [];

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'starcode-snippets.showSyncStatus';
    this.loadEventLog();
    this.loadPerformanceHistory();
  }

  public static getInstance(context: vscode.ExtensionContext): SyncStatusManager {
    if (!this.instance) {
      this.instance = new SyncStatusManager(context);
    }
    return this.instance;
  }

  /**
   * 更新同步状态
   */
  public async updateStatus(status: Partial<DetailedSyncStatus>): Promise<void> {
    const currentStatus = await this.getDetailedStatus();
    const newStatus = { ...currentStatus, ...status };
    
    await this.context.globalState.update('detailedSyncStatus', newStatus);
    this.updateStatusBar(newStatus);
    
    // 记录状态变更事件
    if (status.isSyncing !== undefined) {
      this.logEvent({
        timestamp: Date.now(),
        type: status.isSyncing ? 'start' : 'success',
        operation: 'sync_status_change',
        details: status
      });
    }
  }

  /**
   * 获取详细同步状态
   */
  public async getDetailedStatus(): Promise<DetailedSyncStatus> {
    const defaultStatus: DetailedSyncStatus = {
      isConnected: false,
      isSyncing: false,
      lastSyncTime: null,
      lastError: null
    };
    
    return this.context.globalState.get('detailedSyncStatus', defaultStatus);
  }

  /**
   * 记录同步事件
   */
  public logEvent(event: SyncEvent): void {
    this.eventLog.unshift(event);
    
    // 限制日志条目数量
    if (this.eventLog.length > this.maxLogEntries) {
      this.eventLog = this.eventLog.slice(0, this.maxLogEntries);
    }
    
    this.saveEventLog();
    
    // 如果是错误事件，更新状态
    if (event.type === 'error') {
      this.updateStatus({
        lastError: event.error || '未知错误',
        isSyncing: false
      });
    }
  }

  /**
   * 记录性能指标
   */
  public recordPerformance(duration: number, success: boolean, dataSize: number = 0): void {
    const metric = {
      timestamp: Date.now(),
      duration,
      success,
      dataSize
    };
    
    this.performanceHistory.unshift(metric);
    
    // 保留最近100次记录
    if (this.performanceHistory.length > 100) {
      this.performanceHistory = this.performanceHistory.slice(0, 100);
    }
    
    this.savePerformanceHistory();
    this.updatePerformanceMetrics();
  }

  /**
   * 开始同步操作
   */
  public async startSync(operation: string): Promise<void> {
    await this.updateStatus({
      isSyncing: true,
      lastError: null,
      syncProgress: {
        current: 0,
        total: 100,
        operation
      }
    });
    
    this.logEvent({
      timestamp: Date.now(),
      type: 'start',
      operation
    });
  }

  /**
   * 更新同步进度
   */
  public async updateProgress(current: number, total: number, operation: string): Promise<void> {
    const status = await this.getDetailedStatus();
    await this.updateStatus({
      syncProgress: {
        current,
        total,
        operation
      }
    });
    
    this.logEvent({
      timestamp: Date.now(),
      type: 'progress',
      operation,
      details: { current, total, percentage: Math.round((current / total) * 100) }
    });
  }

  /**
   * 完成同步操作
   */
  public async completeSync(operation: string, duration: number, success: boolean, error?: string): Promise<void> {
    await this.updateStatus({
      isSyncing: false,
      lastSyncTime: Date.now(),
      lastError: success ? null : (error || '同步失败'),
      syncProgress: undefined
    });
    
    this.recordPerformance(duration, success);
    
    this.logEvent({
      timestamp: Date.now(),
      type: success ? 'success' : 'error',
      operation,
      duration,
      error
    });
  }

  /**
   * 记录冲突事件
   */
  public logConflict(operation: string, conflictDetails: any): void {
    this.logEvent({
      timestamp: Date.now(),
      type: 'conflict',
      operation,
      details: conflictDetails
    });
  }

  /**
   * 获取事件日志
   */
  public getEventLog(limit?: number): SyncEvent[] {
    return limit ? this.eventLog.slice(0, limit) : [...this.eventLog];
  }

  /**
   * 获取性能统计
   */
  public getPerformanceStats(): {
    averageDuration: number;
    successRate: number;
    totalSyncs: number;
    lastWeekSyncs: number;
    averageThroughput: number;
  } {
    if (this.performanceHistory.length === 0) {
      return {
        averageDuration: 0,
        successRate: 0,
        totalSyncs: 0,
        lastWeekSyncs: 0,
        averageThroughput: 0
      };
    }
    
    const totalSyncs = this.performanceHistory.length;
    const successfulSyncs = this.performanceHistory.filter(h => h.success).length;
    const averageDuration = this.performanceHistory.reduce((sum, h) => sum + h.duration, 0) / totalSyncs;
    
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const lastWeekSyncs = this.performanceHistory.filter(h => h.timestamp > oneWeekAgo).length;
    
    const throughputData = this.performanceHistory.filter(h => h.dataSize > 0);
    const averageThroughput = throughputData.length > 0 
      ? throughputData.reduce((sum, h) => sum + (h.dataSize / h.duration), 0) / throughputData.length
      : 0;
    
    return {
      averageDuration,
      successRate: (successfulSyncs / totalSyncs) * 100,
      totalSyncs,
      lastWeekSyncs,
      averageThroughput
    };
  }

  /**
   * 清理旧数据
   */
  public cleanupOldData(daysToKeep: number = 30): void {
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    
    this.eventLog = this.eventLog.filter(event => event.timestamp > cutoffTime);
    this.performanceHistory = this.performanceHistory.filter(metric => metric.timestamp > cutoffTime);
    
    this.saveEventLog();
    this.savePerformanceHistory();
  }

  /**
   * 导出同步报告
   */
  public generateSyncReport(): string {
    const status = this.context.globalState.get('detailedSyncStatus') as DetailedSyncStatus;
    const stats = this.getPerformanceStats();
    const recentEvents = this.getEventLog(20);
    
    let report = '# StarCode Snippets 同步报告\n\n';
    
    // 当前状态
    report += '## 当前状态\n';
    report += `- 连接状态: ${status?.isConnected ? '已连接' : '未连接'}\n`;
    report += `- 同步状态: ${status?.isSyncing ? '同步中' : '空闲'}\n`;
    report += `- 最后同步: ${status?.lastSyncTime ? new Date(status.lastSyncTime).toLocaleString() : '从未同步'}\n`;
    report += `- 最后错误: ${status?.lastError || '无'}\n\n`;
    
    // 性能统计
    report += '## 性能统计\n';
    report += `- 总同步次数: ${stats.totalSyncs}\n`;
    report += `- 成功率: ${stats.successRate.toFixed(1)}%\n`;
    report += `- 平均耗时: ${stats.averageDuration.toFixed(0)}ms\n`;
    report += `- 最近一周同步: ${stats.lastWeekSyncs} 次\n`;
    report += `- 平均吞吐量: ${(stats.averageThroughput / 1024).toFixed(1)} KB/s\n\n`;
    
    // 最近事件
    report += '## 最近事件\n';
    recentEvents.forEach(event => {
      const time = new Date(event.timestamp).toLocaleString();
      const type = this.getEventTypeIcon(event.type);
      report += `- ${time} ${type} ${event.operation}`;
      if (event.duration) {
        report += ` (${event.duration}ms)`;
      }
      if (event.error) {
        report += ` - 错误: ${event.error}`;
      }
      report += '\n';
    });
    
    return report;
  }

  /**
   * 更新状态栏
   */
  private updateStatusBar(status: DetailedSyncStatus): void {
    let text = '$(cloud)';
    let tooltip = 'StarCode Snippets 云端同步';
    
    if (status.isSyncing) {
      text = '$(sync~spin)';
      tooltip = '正在同步...';
      if (status.syncProgress) {
        const percentage = Math.round((status.syncProgress.current / status.syncProgress.total) * 100);
        tooltip += ` (${percentage}%)`;
      }
    } else if (!status.isConnected) {
      text = '$(cloud-offline)';
      tooltip = '云端同步未连接';
    } else if (status.lastError) {
      text = '$(warning)';
      tooltip = `同步错误: ${status.lastError}`;
    } else if (status.lastSyncTime) {
      const lastSync = new Date(status.lastSyncTime);
      tooltip = `最后同步: ${lastSync.toLocaleString()}`;
    }
    
    this.statusBarItem.text = text;
    this.statusBarItem.tooltip = tooltip;
    this.statusBarItem.show();
  }

  /**
   * 更新性能指标
   */
  private async updatePerformanceMetrics(): Promise<void> {
    const stats = this.getPerformanceStats();
    const status = await this.getDetailedStatus();
    
    await this.updateStatus({
      performanceMetrics: {
        averageSyncTime: stats.averageDuration,
        successRate: stats.successRate,
        lastThroughput: stats.averageThroughput
      }
    });
  }

  /**
   * 保存事件日志
   */
  private saveEventLog(): void {
    this.context.globalState.update('syncEventLog', this.eventLog);
  }

  /**
   * 加载事件日志
   */
  private loadEventLog(): void {
    this.eventLog = this.context.globalState.get('syncEventLog', []);
  }

  /**
   * 保存性能历史
   */
  private savePerformanceHistory(): void {
    this.context.globalState.update('syncPerformanceHistory', this.performanceHistory);
  }

  /**
   * 加载性能历史
   */
  private loadPerformanceHistory(): void {
    this.performanceHistory = this.context.globalState.get('syncPerformanceHistory', []);
  }

  /**
   * 获取事件类型图标
   */
  private getEventTypeIcon(type: string): string {
    switch (type) {
      case 'start': return '🔄';
      case 'progress': return '⏳';
      case 'success': return '✅';
      case 'error': return '❌';
      case 'conflict': return '⚠️';
      default: return '📝';
    }
  }

  /**
   * 释放资源
   */
  public dispose(): void {
    this.statusBarItem.dispose();
  }
} 