import * as vscode from 'vscode';
import { CloudSyncConfig } from '../models/types';

export interface SyncProgress {
  total: number;
  completed: number;
  current: string;
  percentage: number;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

export class SyncPerformanceManager {
  private static readonly DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffFactor: 2
  };

  private static readonly CHUNK_SIZE = 1024 * 1024; // 1MB chunks
  private static readonly MAX_CONCURRENT_UPLOADS = 3;

  /**
   * 带重试机制的异步操作执行器
   */
  public static async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    config: RetryConfig = this.DEFAULT_RETRY_CONFIG
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === config.maxRetries) {
          throw new Error(`${operationName} 失败，已重试 ${config.maxRetries} 次: ${lastError.message}`);
        }
        
        const delay = Math.min(
          config.baseDelay * Math.pow(config.backoffFactor, attempt - 1),
          config.maxDelay
        );
        
        console.warn(`${operationName} 失败 (尝试 ${attempt}/${config.maxRetries}), ${delay}ms 后重试:`, lastError.message);
        await this.sleep(delay);
      }
    }
    
    throw lastError!;
  }

  /**
   * 并发控制的批量操作执行器
   */
  public static async executeBatch<T, R>(
    items: T[],
    operation: (item: T, index: number) => Promise<R>,
    concurrency: number = this.MAX_CONCURRENT_UPLOADS,
    progressCallback?: (progress: SyncProgress) => void
  ): Promise<R[]> {
    const results: R[] = [];
    const total = items.length;
    let completed = 0;

    // 分批处理
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      
      const batchPromises = batch.map(async (item, batchIndex) => {
        const globalIndex = i + batchIndex;
        
        if (progressCallback) {
          progressCallback({
            total,
            completed,
            current: `处理项目 ${globalIndex + 1}`,
            percentage: Math.round((completed / total) * 100)
          });
        }
        
        try {
          const result = await operation(item, globalIndex);
          completed++;
          
          if (progressCallback) {
            progressCallback({
              total,
              completed,
              current: `已完成 ${completed}/${total}`,
              percentage: Math.round((completed / total) * 100)
            });
          }
          
          return result;
        } catch (error) {
          completed++;
          throw error;
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      
      // 处理批次结果
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          throw result.reason;
        }
      }
    }

    return results;
  }

  /**
   * 大文件分块上传
   */
  public static async uploadLargeContent(
    content: string,
    uploadChunk: (chunk: string, chunkIndex: number, totalChunks: number) => Promise<void>,
    progressCallback?: (progress: SyncProgress) => void
  ): Promise<void> {
    const contentBuffer = Buffer.from(content, 'utf8');
    const totalSize = contentBuffer.length;
    
    if (totalSize <= this.CHUNK_SIZE) {
      // 小文件直接上传
      await uploadChunk(content, 0, 1);
      return;
    }

    // 大文件分块上传
    const totalChunks = Math.ceil(totalSize / this.CHUNK_SIZE);
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * this.CHUNK_SIZE;
      const end = Math.min(start + this.CHUNK_SIZE, totalSize);
      const chunk = contentBuffer.slice(start, end).toString('utf8');
      
      if (progressCallback) {
        progressCallback({
          total: totalChunks,
          completed: i,
          current: `上传块 ${i + 1}/${totalChunks}`,
          percentage: Math.round((i / totalChunks) * 100)
        });
      }
      
      await this.executeWithRetry(
        () => uploadChunk(chunk, i, totalChunks),
        `上传块 ${i + 1}/${totalChunks}`
      );
    }
    
    if (progressCallback) {
      progressCallback({
        total: totalChunks,
        completed: totalChunks,
        current: '上传完成',
        percentage: 100
      });
    }
  }

  /**
   * 网络状态检测
   */
  public static async checkNetworkConnectivity(endpoint: string): Promise<boolean> {
    try {
      // 简单的网络连通性检测
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(endpoint, {
        method: 'HEAD',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * 智能同步策略选择
   */
  public static selectSyncStrategy(
    localChangesCount: number,
    remoteChangesCount: number,
    networkQuality: 'good' | 'poor' | 'offline'
  ): 'full' | 'incremental' | 'defer' {
    if (networkQuality === 'offline') {
      return 'defer';
    }
    
    if (networkQuality === 'poor') {
      // 网络质量差时，只有少量变更才同步
      if (localChangesCount + remoteChangesCount <= 5) {
        return 'incremental';
      } else {
        return 'defer';
      }
    }
    
    // 网络质量好时的策略
    if (localChangesCount + remoteChangesCount <= 20) {
      return 'incremental';
    } else {
      return 'full';
    }
  }

  /**
   * 同步状态持久化
   */
  public static async saveSyncCheckpoint(
    context: vscode.ExtensionContext,
    checkpoint: {
      timestamp: number;
      completedOperations: string[];
      pendingOperations: string[];
      lastSuccessfulSync: number;
    }
  ): Promise<void> {
    await context.globalState.update('syncCheckpoint', checkpoint);
  }

  /**
   * 恢复同步状态
   */
  public static getSyncCheckpoint(context: vscode.ExtensionContext): {
    timestamp: number;
    completedOperations: string[];
    pendingOperations: string[];
    lastSuccessfulSync: number;
  } | null {
    return context.globalState.get('syncCheckpoint', null);
  }

  /**
   * 清理同步检查点
   */
  public static async clearSyncCheckpoint(context: vscode.ExtensionContext): Promise<void> {
    await context.globalState.update('syncCheckpoint', undefined);
  }

  /**
   * 计算同步优先级
   */
  public static calculateSyncPriority(
    lastSyncTime: number,
    changeCount: number,
    userActivity: boolean
  ): 'high' | 'medium' | 'low' {
    const timeSinceLastSync = Date.now() - lastSyncTime;
    const hoursAgo = timeSinceLastSync / (1000 * 60 * 60);
    
    if (userActivity && changeCount > 0) {
      return 'high';
    }
    
    if (hoursAgo > 24 || changeCount > 10) {
      return 'high';
    }
    
    if (hoursAgo > 6 || changeCount > 3) {
      return 'medium';
    }
    
    return 'low';
  }

  /**
   * 延迟函数
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 内存使用监控
   */
  public static getMemoryUsage(): {
    used: number;
    total: number;
    percentage: number;
  } {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const usage = process.memoryUsage();
      return {
        used: usage.heapUsed,
        total: usage.heapTotal,
        percentage: (usage.heapUsed / usage.heapTotal) * 100
      };
    }
    
    return { used: 0, total: 0, percentage: 0 };
  }

  /**
   * 同步性能指标收集
   */
  public static collectPerformanceMetrics(
    operationType: string,
    startTime: number,
    endTime: number,
    dataSize: number,
    success: boolean
  ): {
    operation: string;
    duration: number;
    throughput: number;
    success: boolean;
    timestamp: number;
  } {
    const duration = endTime - startTime;
    const throughput = dataSize / (duration / 1000); // bytes per second
    
    return {
      operation: operationType,
      duration,
      throughput,
      success,
      timestamp: startTime
    };
  }
}