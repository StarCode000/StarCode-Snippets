import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import * as vscode from 'vscode';
import { CloudSyncConfig, CloudSyncStatus, CodeSnippet, Directory } from '../models/types';
import { SettingsManager } from './settingsManager';
import { ChangelogManager, OperationType, HistoryEntry, ChangeSet } from './changelogManager';
import { DiffMergeManager, MergeResult } from './diffMergeManager';
import { ContextManager } from './contextManager';
import { DeviceManager } from './deviceManager';
import * as crypto from 'crypto';

// 云端元数据接口
interface CloudMetadata {
  version: string;
  lastSyncTimestamp: string;
  historyFileHash: string;
  files: { [path: string]: { hash: string } };
  directories: { [path: string]: {} };
}

// 同步结果接口
interface SyncResult {
  success: boolean;
  message: string;
  conflictsDetected?: boolean;
  conflictDetails?: string[];
}

export class CloudSyncManager {
  private s3Client: S3Client | null = null;
  private config: CloudSyncConfig;
  private context: vscode.ExtensionContext | null = null;
  private storageManager: any = null; // 临时使用 any，避免循环依赖
  private readonly HISTORY_FILE_KEY = 'history.txt';
  private readonly METADATA_FILE_KEY = 'metadata.json';
  private readonly SNIPPETS_PREFIX = 'snippets/';
  
  constructor(context?: vscode.ExtensionContext, storageManager?: any) {
    this.config = SettingsManager.getCloudSyncConfig();
    this.context = context || null;
    this.storageManager = storageManager || null;
    this.initializeS3Client();
  }
  
  /**
   * 初始化S3客户端
   */
  private initializeS3Client(): void {
    if (!this.config.endpoint || !this.config.accessKey || !this.config.secretKey) {
      console.log('S3配置不完整，跳过客户端初始化');
      return;
    }
    
    try {
      this.s3Client = new S3Client({
        endpoint: this.config.endpoint,
        region: this.config.region,
        credentials: {
          accessKeyId: this.config.accessKey,
          secretAccessKey: this.config.secretKey,
        },
        forcePathStyle: this.config.addressing === 'path-style',
        requestHandler: {
          requestTimeout: this.config.timeout * 1000,
        },
      });
      
      console.log('S3客户端初始化成功');
    } catch (error) {
      console.error('S3客户端初始化失败:', error);
      this.s3Client = null;
    }
  }
  
  /**
   * 更新配置并重新初始化客户端
   */
  public updateConfig(newConfig: CloudSyncConfig): void {
    this.config = newConfig;
    this.initializeS3Client();
  }
  
  /**
   * 检查是否已配置并连接
   */
  public isConfigured(): boolean {
    return this.s3Client !== null;
  }

  /**
   * 测试S3连接
   */
  public async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      // 首先验证配置完整性
      const validation = SettingsManager.validateConfig(this.config);
      if (!validation.isValid) {
        return {
          success: false,
          message: `配置验证失败: ${validation.errors.join(', ')}`
        };
      }

      // 重新初始化S3客户端以确保使用最新配置
      this.initializeS3Client();
      
      if (!this.s3Client) {
        return {
          success: false,
          message: 'S3客户端初始化失败'
        };
      }

      // 尝试列出存储桶内容来测试连接
      // 使用HeadBucket操作来测试访问权限
      try {
        const command = new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: 'test-connection-probe'
        });
        
        // 这个操作会测试：
        // 1. 网络连接
        // 2. 认证信息
        // 3. 存储桶访问权限
        await this.s3Client.send(command);
        
        // 如果到这里没有抛出异常，说明连接成功
        return {
          success: true,
          message: '连接测试成功'
        };
        
      } catch (error: any) {
        // 404错误是正常的，说明连接成功但文件不存在
        if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
          return {
            success: true,
            message: '连接测试成功'
          };
        }
        
        // 403错误说明认证失败
        if (error.$metadata?.httpStatusCode === 403) {
          return {
            success: false,
            message: '访问被拒绝，请检查Access Key和Secret Key是否正确'
          };
        }
        
        // 其他网络或配置错误
        throw error;
      }
      
    } catch (error: any) {
      console.error('连接测试失败:', error);
      
      let errorMessage = '连接测试失败';
      
      if (error.code === 'NetworkingError' || error.name === 'NetworkingError') {
        errorMessage = '网络连接失败，请检查Endpoint地址和网络连接';
      } else if (error.code === 'InvalidAccessKeyId') {
        errorMessage = 'Access Key无效';
      } else if (error.code === 'SignatureDoesNotMatch') {
        errorMessage = 'Secret Key错误';
      } else if (error.code === 'NoSuchBucket') {
        errorMessage = '存储桶不存在';
      } else if (error.message) {
        errorMessage = `连接测试失败: ${error.message}`;
      }
      
      return {
        success: false,
        message: errorMessage
      };
    }
  }
  
  /**
   * 从S3下载文件内容
   */
  private async downloadFile(key: string): Promise<string | null> {
    if (!this.s3Client) {
      throw new Error('S3客户端未初始化');
    }
    
    try {
      const command = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      });
      
      const response = await this.s3Client.send(command);
      
      if (response.Body) {
        const chunks: Uint8Array[] = [];
        const reader = response.Body.transformToWebStream().getReader();
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        
        const buffer = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
          buffer.set(chunk, offset);
          offset += chunk.length;
        }
        
        return new TextDecoder().decode(buffer);
      }
      
      return null;
    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return null; // 文件不存在
      }
      throw error;
    }
  }

  /**
   * 上传文件到S3
   */
  private async uploadFile(key: string, content: string): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3客户端未初始化');
    }
    
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: content,
      ContentType: key.endsWith('.json') ? 'application/json' : 'text/plain',
    });
    
    await this.s3Client.send(command);
  }
  
  /**
   * 从S3删除文件
   */
  private async deleteFile(key: string): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3客户端未初始化');
    }
    
    const command = new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    });
    
    await this.s3Client.send(command);
  }
  
  /**
   * 检查文件是否存在
   */
  private async fileExists(key: string): Promise<boolean> {
    if (!this.s3Client) {
      throw new Error('S3客户端未初始化');
    }
    
    try {
      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      });
      
      await this.s3Client.send(command);
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * 计算字符串的哈希值
   */
  private calculateHash(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }
  
  /**
   * 获取本地存储的上次同步历史记录
   */
  private getLocalSyncHistory(): string {
    if (!this.context) {
      return '';
    }
    
    return this.context.globalState.get('cloudSync.lastHistory', '');
  }
  
  /**
   * 保存本地同步历史记录
   */
  private async saveLocalSyncHistory(history: string): Promise<void> {
    if (!this.context) {
      return;
    }

    await this.context.globalState.update('cloudSync.lastHistory', history);
  }
  
  /**
   * 获取本地存储的上次同步元数据
   */
  private getLocalSyncMetadata(): CloudMetadata | null {
    if (!this.context) {
      return null;
    }
    
    return this.context.globalState.get('cloudSync.lastMetadata', null);
  }
  
  /**
   * 保存本地同步元数据
   */
  private async saveLocalSyncMetadata(metadata: CloudMetadata): Promise<void> {
    if (!this.context) {
      return;
    }

    await this.context.globalState.update('cloudSync.lastMetadata', metadata);
  }
  
  /**
   * 生成代码片段的S3键名
   */
  private generateSnippetKey(fullPath: string): string {
    // 移除开头的斜杠，添加snippets前缀和.json后缀
    const cleanPath = fullPath.startsWith('/') ? fullPath.substring(1) : fullPath;
    return this.SNIPPETS_PREFIX + cleanPath + '.json';
  }
  
  /**
   * 将代码片段转换为JSON字符串
   */
  private snippetToJson(snippet: CodeSnippet): string {
    return JSON.stringify(snippet, null, 2);
  }
  
  /**
   * 从JSON字符串解析代码片段
   */
  private jsonToSnippet(json: string): CodeSnippet {
    return JSON.parse(json);
  }
  
  /**
   * 检测本地变更
   */
  public async detectLocalChanges(
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[]
  ): Promise<ChangeSet> {
    const lastSyncHistory = this.getLocalSyncHistory();
    
    return ChangelogManager.compareWithActualState(
      currentSnippets,
      currentDirectories,
      lastSyncHistory
    );
  }
  
  /**
   * 检查云端是否有更新
   */
  public async checkRemoteUpdates(): Promise<{ hasUpdates: boolean; remoteHistory?: string; remoteMetadata?: CloudMetadata }> {
    if (!this.isConfigured()) {
      throw new Error('云端同步未配置');
    }
    
    try {
      // 下载远端元数据
      const remoteMetadataText = await this.downloadFile(this.METADATA_FILE_KEY);
      if (!remoteMetadataText) {
        // 云端没有数据
        return { hasUpdates: false };
      }
      
      const remoteMetadata: CloudMetadata = JSON.parse(remoteMetadataText);
      const localMetadata = this.getLocalSyncMetadata();
      
      // 比较历史文件哈希
      if (!localMetadata || localMetadata.historyFileHash !== remoteMetadata.historyFileHash) {
        const remoteHistory = await this.downloadFile(this.HISTORY_FILE_KEY);
        return {
          hasUpdates: true,
          remoteHistory: remoteHistory || '',
          remoteMetadata
        };
      }
      
      return { hasUpdates: false };
    } catch (error) {
      console.error('检查远端更新失败:', error);
      throw error;
    }
  }

  /**
   * 执行完整同步（智能检测是否需要初始化）
   */
  public async performSync(
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[]
  ): Promise<SyncResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: '云端同步未配置'
      };
    }

    // 检查是否正在编辑代码片段
    if (ContextManager.isEditingSnippet()) {
      return {
        success: false,
        message: '用户正在编辑代码片段，无法进行同步'
      };
    }

    // 设置同步状态为进行中
    const status = SettingsManager.getCloudSyncStatus();
    status.isSyncing = true;
    await SettingsManager.saveCloudSyncStatus(status);

    try {
      console.log('开始云端同步...');
      
      // 阶段0: 检查是否需要初始化云端存储
      const needsInitialization = await this.checkIfNeedsInitialization();
      
      if (needsInitialization) {
        console.log('检测到云端为空，执行初始化...');
        return await this.initializeCloudStorage(currentSnippets, currentDirectories);
      }
      
      // 阶段1: 检测本地变更
      const localChanges = await this.detectLocalChanges(currentSnippets, currentDirectories);
      const hasLocalChanges = this.hasChanges(localChanges);
      
      // 阶段2: 检查远端更新
      const remoteCheck = await this.checkRemoteUpdates();
      
      console.log(`本地变更: ${hasLocalChanges}, 远端更新: ${remoteCheck.hasUpdates}`);
      
      if (!hasLocalChanges && !remoteCheck.hasUpdates) {
        // 即使没有变更，也要更新同步时间
        const status = SettingsManager.getCloudSyncStatus();
        status.lastSyncTime = Date.now();
        status.lastError = null;
        await SettingsManager.saveCloudSyncStatus(status);
        
        return {
          success: true,
          message: '没有需要同步的变更，同步时间已更新'
        };
      }
      
      // 阶段3: 处理不同的同步场景
      if (hasLocalChanges && !remoteCheck.hasUpdates) {
        // 只有本地变更，直接推送
        return await this.pushLocalChanges(localChanges, currentSnippets, currentDirectories);
      } else if (!hasLocalChanges && remoteCheck.hasUpdates) {
        // 只有远端变更，直接拉取
        return await this.pullRemoteChanges(remoteCheck.remoteHistory!, remoteCheck.remoteMetadata!);
      } else {
        // 本地和远端都有变更，需要冲突检测
        return await this.handleConflicts(
          localChanges,
          remoteCheck.remoteHistory!,
          remoteCheck.remoteMetadata!,
          currentSnippets,
          currentDirectories
        );
          }
      
    } catch (error) {
      console.error('同步失败:', error);
      
      // 更新同步状态
      const status = SettingsManager.getCloudSyncStatus();
      status.isSyncing = false;
      status.lastError = error instanceof Error ? error.message : '未知错误';
      await SettingsManager.saveCloudSyncStatus(status);
      
      return {
        success: false,
        message: `同步失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    } finally {
      // 确保同步状态被重置
      const status = SettingsManager.getCloudSyncStatus();
      status.isSyncing = false;
      await SettingsManager.saveCloudSyncStatus(status);
    }
  }

  /**
   * 检查是否需要初始化云端存储
   */
  private async checkIfNeedsInitialization(): Promise<boolean> {
    try {
      // 检查云端是否有元数据文件
      const hasMetadata = await this.fileExists(this.METADATA_FILE_KEY);
      return !hasMetadata;
    } catch (error) {
      console.error('检查初始化状态失败:', error);
      // 如果检查失败，假设需要初始化
      return true;
    }
  }

  /**
   * 检查变更集是否包含变更
   */
  private hasChanges(changeSet: ChangeSet): boolean {
    return changeSet.addedFiles.length > 0 ||
           changeSet.modifiedFiles.length > 0 ||
           changeSet.deletedFiles.length > 0 ||
           changeSet.addedDirectories.length > 0 ||
           changeSet.deletedDirectories.length > 0;
  }
  
  /**
   * 推送本地变更到云端
   */
  private async pushLocalChanges(
    changeSet: ChangeSet,
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[]
  ): Promise<SyncResult> {
    try {
      console.log('推送本地变更到云端...');
      
      // 获取当前云端历史记录
      let remoteHistory = await this.downloadFile(this.HISTORY_FILE_KEY) || '';
      
      // 生成新的历史记录条目
      const newEntries = ChangelogManager.changeSetToHistoryEntries(changeSet, this.context || undefined);
      
      // 执行S3文件操作
      for (const entry of newEntries) {
        await this.executeHistoryEntry(entry, currentSnippets, currentDirectories);
      }
      
      // 更新历史记录
      for (const entry of newEntries) {
        remoteHistory = ChangelogManager.addEntry(
          remoteHistory,
          entry.operation,
          entry.fullPath,
          entry.hash,
          entry.timestamp,
          entry.deviceTag,
          this.context || undefined
        );
      }
      
      // 上传更新后的历史记录
      await this.uploadFile(this.HISTORY_FILE_KEY, remoteHistory);
      
      // 生成并上传新的元数据
      const newMetadata = await this.generateMetadata(remoteHistory, currentSnippets, currentDirectories);
      await this.uploadFile(this.METADATA_FILE_KEY, JSON.stringify(newMetadata, null, 2));
      
      // 更新本地同步状态
      await this.saveLocalSyncHistory(remoteHistory);
      await this.saveLocalSyncMetadata(newMetadata);
      
      // 更新同步状态
      const status = SettingsManager.getCloudSyncStatus();
      status.lastSyncTime = Date.now();
      status.lastError = null;
      await SettingsManager.saveCloudSyncStatus(status);
      
      return {
        success: true,
        message: '本地变更已成功推送到云端'
      };
      
    } catch (error) {
      console.error('推送本地变更失败:', error);
      throw error;
    }
  }

  /**
   * 从云端拉取变更
   */
  private async pullRemoteChanges(
    remoteHistory: string,
    remoteMetadata: CloudMetadata
  ): Promise<SyncResult> {
    try {
      console.log('从云端拉取变更...');
      
      if (!this.storageManager) {
        throw new Error('StorageManager 未初始化，无法拉取变更');
      }
      
      // 1. 检查云端是否有强制清空记录需要处理
      const forceResetResult = await this.checkAndHandleRemoteForceReset(remoteHistory);
      if (forceResetResult) {
        return forceResetResult;
      }
      
      // 2. 解析远端历史记录
      const remoteEntries = ChangelogManager.parseHistory(remoteHistory);
      const localHistory = this.getLocalSyncHistory();
      const localEntries = ChangelogManager.parseHistory(localHistory);
      
      // 3. 找出需要应用的变更（远端有但本地没有的）
      const newEntries = this.findNewEntries(remoteEntries, localEntries);
      
      console.log(`发现 ${newEntries.length} 个新的远端变更需要应用`);
      
      // 4. 按时间顺序应用变更
      for (const entry of newEntries) {
        console.log(`应用远端变更: ${entry.operation} ${entry.fullPath}`);
        await this.applyRemoteEntry(entry);
      }
      
      // 5. 清理StorageManager缓存，确保数据一致性
      if (newEntries.length > 0 && this.storageManager && this.storageManager.clearCache) {
        this.storageManager.clearCache();
        console.log('已清理StorageManager缓存');
      }
      
      // 6. 更新本地同步状态
      await this.saveLocalSyncHistory(remoteHistory);
      await this.saveLocalSyncMetadata(remoteMetadata);
      
      // 7. 更新同步状态
      const status = SettingsManager.getCloudSyncStatus();
      status.lastSyncTime = Date.now();
      status.lastError = null;
      await SettingsManager.saveCloudSyncStatus(status);
      
      return {
        success: true,
        message: `云端变更已成功拉取到本地 (应用了 ${newEntries.length} 个变更)`
      };
      
    } catch (error) {
      console.error('拉取云端变更失败:', error);
      throw error;
    }
  }

  /**
   * 处理冲突
   */
  private async handleConflicts(
    localChanges: ChangeSet,
    remoteHistory: string,
    remoteMetadata: CloudMetadata,
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[]
  ): Promise<SyncResult> {
    console.log('检测到冲突，开始智能冲突处理...');
    
    try {
      // 1. 首先检查云端是否有强制清空记录需要处理
      const forceResetResult = await this.checkAndHandleRemoteForceReset(remoteHistory);
      if (forceResetResult) {
        return forceResetResult;
      }
      
      // 2. 先拉取远端变更，获取远端的代码片段
      await this.pullRemoteChanges(remoteHistory, remoteMetadata);
      
      // 3. 重新获取本地数据（可能已经被拉取操作更新）
      const [updatedSnippets, updatedDirectories] = await Promise.all([
        this.storageManager.getAllSnippets(),
        this.storageManager.getAllDirectories()
      ]);
      
      // 4. 检测具体的冲突文件
      const conflictResults = await this.detectAndResolveConflicts(
        localChanges,
        updatedSnippets,
        updatedDirectories
      );
      
      // 5. 如果有成功合并的文件，保存它们
      const mergedSnippets = conflictResults.filter(r => r.success && r.merged);
      for (const result of mergedSnippets) {
        if (result.merged) {
          await this.storageManager.updateSnippet(result.merged);
          console.log(`成功合并代码片段: ${result.merged.name}`);
        }
      }
      
      // 6. 统计处理结果
      const totalConflicts = conflictResults.length;
      const resolvedConflicts = mergedSnippets.length;
      const unresolvedConflicts = totalConflicts - resolvedConflicts;
      
      // 7. 如果还有未解决的冲突，推送本地变更（本地优先）
      if (unresolvedConflicts > 0) {
        console.log(`${unresolvedConflicts} 个冲突需要本地优先处理`);
        await this.pushLocalChanges(localChanges, currentSnippets, currentDirectories);
      }
      
      // 8. 清理缓存并返回结果
      if (this.storageManager && this.storageManager.clearCache) {
        this.storageManager.clearCache();
      }
      
      return {
        success: true,
        message: `冲突处理完成: ${resolvedConflicts} 个自动合并, ${unresolvedConflicts} 个本地优先`,
        conflictsDetected: true,
        conflictDetails: [
          `总冲突数: ${totalConflicts}`,
          `自动合并: ${resolvedConflicts}`,
          `本地优先: ${unresolvedConflicts}`
        ]
      };
      
    } catch (error) {
      console.error('冲突处理失败:', error);
      
      // 回退到简单的本地优先策略
      console.log('回退到本地优先策略...');
      await this.pullRemoteChanges(remoteHistory, remoteMetadata);
      return await this.pushLocalChanges(localChanges, currentSnippets, currentDirectories);
    }
  }

  /**
   * 检测并解决冲突
   */
  private async detectAndResolveConflicts(
    localChanges: ChangeSet,
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[]
  ): Promise<MergeResult[]> {
    const results: MergeResult[] = [];
    
    // 处理修改的文件冲突
    for (const modifiedFile of localChanges.modifiedFiles) {
      if ('code' in modifiedFile.item) {
        const localSnippet = modifiedFile.item as CodeSnippet;
        
        // 查找对应的远程版本
        const remoteSnippet = currentSnippets.find(s => s.id === localSnippet.id);
        
        if (remoteSnippet && remoteSnippet !== localSnippet) {
          console.log(`检测到代码片段冲突: ${localSnippet.name}`);
          
                      try {
              // 生成详细的差异报告（用于调试）
              const diffReport = DiffMergeManager.generateDiffReport(
                localSnippet.code,
                remoteSnippet.code
              );
              console.log(`代码片段差异报告 [${localSnippet.name}]:\n${diffReport}`);
              
              // 尝试自动合并
              const mergeResult = await DiffMergeManager.mergeSnippets(
                localSnippet,
                remoteSnippet
              );
              
              if (mergeResult.success) {
                console.log(`自动合并成功: ${localSnippet.name}`);
                results.push(mergeResult);
              } else if (mergeResult.requiresUserDecision) {
                // 需要用户决策
                console.log(`需要用户决策: ${localSnippet.name}`);
                
                const userChoice = await DiffMergeManager.showConflictResolutionUI(
                  mergeResult.conflicts || [],
                  localSnippet,
                  remoteSnippet
                );
                
                if (userChoice) {
                  results.push({
                    success: true,
                    merged: userChoice
                  });
                } else {
                  // 用户跳过，使用本地版本
                  results.push({
                    success: true,
                    merged: localSnippet
                  });
                }
              } else {
                // 合并失败，使用本地版本
                console.log(`合并失败，使用本地版本: ${localSnippet.name}`);
                results.push({
                  success: true,
                  merged: localSnippet
                });
              }
            } catch (error) {
              console.error(`处理冲突失败 [${localSnippet.name}]:`, error);
              // 出错时使用本地版本
              results.push({
                success: true,
                merged: localSnippet
              });
            }
        }
      }
    }
    
    return results;
  }
  
  /**
   * 执行历史记录条目对应的S3操作
   */
  private async executeHistoryEntry(
    entry: HistoryEntry,
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[]
  ): Promise<void> {
    switch (entry.operation) {
      case OperationType.ADD:
      case OperationType.MODIFY:
        if (!entry.fullPath.endsWith('/')) {
          // 文件操作
          const snippet = currentSnippets.find(s => 
            ChangelogManager.generateFullPath(s, currentDirectories) === entry.fullPath
          );
          
          if (snippet) {
            const key = this.generateSnippetKey(entry.fullPath);
            const content = this.snippetToJson(snippet);
            await this.uploadFile(key, content);
          }
        }
        // 目录操作不需要在S3中创建实际文件
        break;
        
      case OperationType.DELETE:
        if (!entry.fullPath.endsWith('/')) {
          // 删除文件
          const key = this.generateSnippetKey(entry.fullPath);
          try {
            await this.deleteFile(key);
          } catch (error: any) {
            // 忽略文件不存在的错误
            if (error.name !== 'NoSuchKey' && error.$metadata?.httpStatusCode !== 404) {
              throw error;
            }
          }
        }
        // 目录删除不需要特殊处理
        break;
    }
  }
  
  /**
   * 生成元数据
   */
  private async generateMetadata(
    historyText: string,
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[]
  ): Promise<CloudMetadata> {
    const metadata: CloudMetadata = {
      version: '1.0',
      lastSyncTimestamp: new Date().toISOString(),
      historyFileHash: this.calculateHash(historyText),
      files: {},
      directories: {}
    };
    
    // 添加文件信息
    for (const snippet of currentSnippets) {
      const fullPath = ChangelogManager.generateFullPath(snippet, currentDirectories);
      const hash = ChangelogManager.calculateItemHash(snippet);
      metadata.files[fullPath] = { hash };
    }
    
    // 添加目录信息
    for (const directory of currentDirectories) {
      const fullPath = ChangelogManager.generateFullPath(directory, currentDirectories);
      metadata.directories[fullPath] = {};
    }
    
    return metadata;
  }
  
  /**
   * 找出需要应用的新变更（远端有但本地没有的）
   */
  private findNewEntries(remoteEntries: HistoryEntry[], localEntries: HistoryEntry[]): HistoryEntry[] {
    // 创建本地条目的时间戳集合，用于快速查找
    const localTimestamps = new Set(localEntries.map(entry => entry.timestamp));
    
    // 找出远端有但本地没有的条目
    const newEntries = remoteEntries.filter(entry => !localTimestamps.has(entry.timestamp));
    
    // 按时间戳排序，确保按正确顺序应用变更
    return newEntries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }
  
  /**
   * 应用远端变更条目到本地存储
   */
  private async applyRemoteEntry(entry: HistoryEntry): Promise<void> {
    try {
      switch (entry.operation) {
        case OperationType.ADD:
        case OperationType.MODIFY:
          if (entry.fullPath.endsWith('/')) {
            // 目录操作
            await this.applyDirectoryEntry(entry);
          } else {
            // 文件操作
            await this.applyFileEntry(entry);
          }
          break;
          
        case OperationType.DELETE:
          if (entry.fullPath.endsWith('/')) {
            // 删除目录
            await this.deleteDirectoryByPath(entry.fullPath);
          } else {
            // 删除文件
            await this.deleteFileByPath(entry.fullPath);
          }
          break;
          
        default:
          console.warn(`未知的操作类型: ${entry.operation}`);
      }
    } catch (error) {
      console.error(`应用远端变更失败 [${entry.operation} ${entry.fullPath}]:`, error);
      throw error;
    }
  }
  
  /**
   * 应用目录变更
   */
  private async applyDirectoryEntry(entry: HistoryEntry): Promise<void> {
    if (entry.operation === OperationType.DELETE) {
      return; // 删除操作在 applyRemoteEntry 中处理
    }
    
    // 从路径解析目录信息
    const directory = this.parseDirectoryFromPath(entry.fullPath);
    
    if (entry.operation === OperationType.ADD) {
      // 检查目录是否已存在
      const existingDirs = await this.storageManager.getAllDirectories();
      const exists = existingDirs.some((d: Directory) => d.id === directory.id);
      
      if (!exists) {
        await this.storageManager.createDirectory(directory);
        console.log(`创建目录: ${directory.name}`);
      } else {
        console.log(`目录已存在，跳过创建: ${directory.name}`);
      }
    } else if (entry.operation === OperationType.MODIFY) {
      // 目录修改（通常是重命名）
      await this.storageManager.updateDirectory(directory);
      console.log(`更新目录: ${directory.name}`);
    }
  }
  
  /**
   * 应用文件变更
   */
  private async applyFileEntry(entry: HistoryEntry): Promise<void> {
    if (entry.operation === OperationType.DELETE) {
      return; // 删除操作在 applyRemoteEntry 中处理
    }
    
    // 从云端下载文件内容
    const s3Key = this.generateSnippetKey(entry.fullPath);
    const fileContent = await this.downloadFile(s3Key);
    
    if (!fileContent) {
      throw new Error(`无法从云端下载文件: ${entry.fullPath}`);
    }
    
    // 解析代码片段
    const snippet = this.jsonToSnippet(fileContent);
    
    if (entry.operation === OperationType.ADD) {
      // 检查代码片段是否已存在
      const existingSnippets = await this.storageManager.getAllSnippets();
      const exists = existingSnippets.some((s: CodeSnippet) => s.id === snippet.id);
      
      if (!exists) {
        await this.storageManager.saveSnippet(snippet);
        console.log(`创建代码片段: ${snippet.name}`);
          } else {
        console.log(`代码片段已存在，跳过创建: ${snippet.name}`);
      }
    } else if (entry.operation === OperationType.MODIFY) {
      // 更新代码片段
      await this.storageManager.updateSnippet(snippet);
      console.log(`更新代码片段: ${snippet.name}`);
    }
  }
  
  /**
   * 根据路径删除目录
   */
  private async deleteDirectoryByPath(fullPath: string): Promise<void> {
    const directories = await this.storageManager.getAllDirectories();
    
    // 从路径找到对应的目录
    const directory = directories.find((d: Directory) => {
      const dirPath = ChangelogManager.generateFullPath(d, directories);
      return dirPath === fullPath;
    });
    
    if (directory) {
      await this.storageManager.deleteDirectory(directory.id);
      console.log(`删除目录: ${directory.name}`);
    } else {
      console.warn(`未找到要删除的目录: ${fullPath}`);
    }
  }

  /**
   * 根据路径删除文件
   */
  private async deleteFileByPath(fullPath: string): Promise<void> {
    const [snippets, directories] = await Promise.all([
      this.storageManager.getAllSnippets(),
      this.storageManager.getAllDirectories()
    ]);
    
    // 从路径找到对应的代码片段
    const snippet = snippets.find((s: CodeSnippet) => {
      const snippetPath = ChangelogManager.generateFullPath(s, directories);
      return snippetPath === fullPath;
    });
    
    if (snippet) {
      await this.storageManager.deleteSnippet(snippet.id);
      console.log(`删除代码片段: ${snippet.name}`);
    } else {
      console.warn(`未找到要删除的代码片段: ${fullPath}`);
    }
  }
  
  /**
   * 从路径解析目录信息
   */
  private parseDirectoryFromPath(fullPath: string): Directory {
    // 移除开头和结尾的斜杠
    const cleanPath = fullPath.replace(/^\/+|\/+$/g, '');
    const pathParts = cleanPath.split('/');
    const dirName = pathParts[pathParts.length - 1];
    
    // 生成目录ID（基于路径的哈希）
    const directoryId = crypto.createHash('md5').update(fullPath).digest('hex');
    
    // 确定父目录ID
    let parentId: string | null = null;
    if (pathParts.length > 1) {
      const parentPath = '/' + pathParts.slice(0, -1).join('/') + '/';
      parentId = crypto.createHash('md5').update(parentPath).digest('hex');
    }
    
    return {
      id: directoryId,
      name: dirName,
      parentId: parentId,
      order: 0
    };
  }

  /**
   * 强制重置云端同步（紧急情况下使用）
   * 清空所有云端文件和本地历史记录，然后重新初始化
   */
  public async forceResetCloudSync(
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[]
  ): Promise<SyncResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: '云端同步未配置'
      };
    }

    try {
      console.log('开始强制重置云端同步...');
      
      // 第一步：清空云端所有文件
      await this.clearAllCloudFiles();
      
      // 第二步：创建强制清空记录
      const forceClearHistory = this.createForceClearHistory();
      console.log('强制清空记录:', forceClearHistory);
      
      // 第三步：重新初始化云端存储（传入强制清空记录作为基础）
      const initResult = await this.initializeCloudStorageWithForceReset(
        currentSnippets, 
        currentDirectories, 
        forceClearHistory
      );
      
      if (initResult.success) {
        return {
          success: true,
          message: '强制重置完成，云端同步已重新初始化'
        };
      } else {
        return {
          success: false,
          message: `强制重置失败: ${initResult.message}`
        };
      }
      
    } catch (error) {
      console.error('强制重置失败:', error);
      return {
        success: false,
        message: `强制重置失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 清空云端所有文件
   */
  private async clearAllCloudFiles(): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3客户端未初始化');
    }

    console.log('清空云端所有文件...');
    
    try {
      // 删除历史记录文件
      try {
        await this.deleteFile(this.HISTORY_FILE_KEY);
        console.log('已删除云端历史记录文件');
      } catch (error: any) {
        if (error.name !== 'NoSuchKey' && error.$metadata?.httpStatusCode !== 404) {
          console.warn('删除历史记录文件失败:', error);
        }
      }
      
      // 删除元数据文件
      try {
        await this.deleteFile(this.METADATA_FILE_KEY);
        console.log('已删除云端元数据文件');
      } catch (error: any) {
        if (error.name !== 'NoSuchKey' && error.$metadata?.httpStatusCode !== 404) {
          console.warn('删除元数据文件失败:', error);
        }
      }
      
      // 删除所有代码片段文件
      await this.deleteAllSnippetFiles();
      
      console.log('云端文件清理完成');
      
    } catch (error) {
      console.error('清空云端文件时发生错误:', error);
      throw error;
    }
  }

  /**
   * 删除所有代码片段文件
   */
  private async deleteAllSnippetFiles(): Promise<void> {
    if (!this.s3Client) {
      throw new Error('S3客户端未初始化');
    }

    try {
      console.log('正在列出所有代码片段文件...');
      
      // 列出所有以snippets/开头的文件
      const listCommand = new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: this.SNIPPETS_PREFIX
      });

      const listResponse = await this.s3Client.send(listCommand);
      
      if (listResponse.Contents && listResponse.Contents.length > 0) {
        console.log(`发现 ${listResponse.Contents.length} 个代码片段文件，正在删除...`);
        
        // 逐个删除文件
        for (const object of listResponse.Contents) {
          if (object.Key) {
            try {
              await this.deleteFile(object.Key);
              console.log(`已删除: ${object.Key}`);
            } catch (error: any) {
              console.warn(`删除文件失败 ${object.Key}:`, error);
            }
          }
        }
        
        console.log('所有代码片段文件删除完成');
      } else {
        console.log('没有发现代码片段文件');
      }
      
    } catch (error) {
      console.error('删除代码片段文件时发生错误:', error);
      throw error;
    }
  }

  /**
   * 检查并处理云端强制清空记录
   */
  private async checkAndHandleRemoteForceReset(remoteHistory: string): Promise<SyncResult | null> {
    if (!remoteHistory.trim()) {
      return null; // 云端没有历史记录
    }

    const remoteEntries = ChangelogManager.parseHistory(remoteHistory);
    if (remoteEntries.length === 0) {
      return null;
    }

    // 检查云端第一条记录是否为强制清空
    const firstRemoteEntry = remoteEntries[0];
    if (firstRemoteEntry.operation !== OperationType.FORCE_CLEAR) {
      return null; // 不是强制清空记录
    }

    const localHistory = this.getLocalSyncHistory();
    const localEntries = ChangelogManager.parseHistory(localHistory);

    // 判断是否需要执行云端强制清空
    let shouldApplyRemoteReset = false;

    if (localEntries.length === 0) {
      // 本地没有历史记录，直接应用云端
      shouldApplyRemoteReset = true;
      console.log('本地无历史记录，应用云端强制清空');
    } else {
      // 比较时间戳
      const firstLocalEntry = localEntries[0];
      const remoteTimestamp = new Date(firstRemoteEntry.timestamp);
      const localTimestamp = new Date(firstLocalEntry.timestamp);

      if (remoteTimestamp > localTimestamp) {
        shouldApplyRemoteReset = true;
        console.log(`云端强制清空时间戳更新 (${firstRemoteEntry.timestamp} > ${firstLocalEntry.timestamp})，应用云端重置`);
      } else {
        console.log(`云端强制清空时间戳较旧，忽略 (${firstRemoteEntry.timestamp} <= ${firstLocalEntry.timestamp})`);
      }
    }

    if (!shouldApplyRemoteReset) {
      return null;
    }

    // 执行云端强制清空处理
    try {
      console.log('🚨 检测到云端强制清空，开始清空本地代码库...');

      // 1. 清空本地所有代码片段和目录
      await this.clearLocalCodebase();

      // 2. 从云端重新导入所有数据
      const importResult = await this.importFromRemoteAfterReset(remoteHistory);

      // 3. 更新本地同步状态
      await this.saveLocalSyncHistory(remoteHistory);

      // 4. 更新同步状态
      const status = SettingsManager.getCloudSyncStatus();
      status.lastSyncTime = Date.now();
      status.lastError = null;
      await SettingsManager.saveCloudSyncStatus(status);

      return {
        success: true,
        message: `检测到云端强制重置，已清空本地代码库并重新导入 (导入了 ${importResult.importedCount} 个代码片段)`
      };

    } catch (error) {
      console.error('处理云端强制清空失败:', error);
      return {
        success: false,
        message: `处理云端强制清空失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 清空本地代码库
   */
  private async clearLocalCodebase(): Promise<void> {
    if (!this.storageManager) {
      throw new Error('StorageManager 未初始化');
    }

    console.log('清空本地代码库...');

    try {
      // 获取所有代码片段和目录
      const [snippets, directories] = await Promise.all([
        this.storageManager.getAllSnippets(),
        this.storageManager.getAllDirectories()
      ]);

      // 删除所有代码片段
      for (const snippet of snippets) {
        await this.storageManager.deleteSnippet(snippet.id);
      }
      console.log(`已删除 ${snippets.length} 个代码片段`);

      // 删除所有目录（按层级倒序删除）
      const sortedDirs = directories.sort((a: Directory, b: Directory) => {
        const aPath = ChangelogManager.generateFullPath(a, directories);
        const bPath = ChangelogManager.generateFullPath(b, directories);
        const aDepth = (aPath.match(/\//g) || []).length;
        const bDepth = (bPath.match(/\//g) || []).length;
        return bDepth - aDepth; // 深层目录先删除
      });

      for (const directory of sortedDirs) {
        await this.storageManager.deleteDirectory(directory.id);
      }
      console.log(`已删除 ${directories.length} 个目录`);

      // 清理缓存
      if (this.storageManager.clearCache) {
        this.storageManager.clearCache();
      }

      console.log('本地代码库清空完成');

    } catch (error) {
      console.error('清空本地代码库失败:', error);
      throw error;
    }
  }

  /**
   * 从云端重新导入数据（在强制清空后）
   */
  private async importFromRemoteAfterReset(remoteHistory: string): Promise<{ importedCount: number }> {
    if (!this.storageManager) {
      throw new Error('StorageManager 未初始化');
    }

    console.log('从云端重新导入数据...');

    try {
      const remoteEntries = ChangelogManager.parseHistory(remoteHistory);
      let importedCount = 0;

      // 按时间顺序处理所有条目（跳过强制清空记录）
      for (const entry of remoteEntries) {
        if (entry.operation === OperationType.FORCE_CLEAR) {
          continue; // 跳过强制清空记录
        }

        if (entry.operation === OperationType.DELETE) {
          continue; // 在重新导入时跳过删除操作
        }

        try {
          if (entry.fullPath.endsWith('/')) {
            // 目录操作
            await this.applyDirectoryEntry(entry);
          } else {
            // 文件操作
            await this.applyFileEntry(entry);
            importedCount++;
          }
        } catch (error) {
          console.warn(`导入条目失败 [${entry.operation} ${entry.fullPath}]:`, error);
          // 继续处理其他条目，不中断整个导入过程
        }
      }

      console.log(`从云端重新导入完成，共导入 ${importedCount} 个代码片段`);
      return { importedCount };

    } catch (error) {
      console.error('从云端重新导入失败:', error);
      throw error;
    }
  }

  /**
   * 创建强制清空历史记录
   */
  private createForceClearHistory(): string {
    const timestamp = new Date().toISOString();
    const deviceTag = DeviceManager.getDeviceTag(this.context || undefined);
    const forceClearEntry = `${OperationType.FORCE_CLEAR} | SYSTEM_RESET | ${ChangelogManager.HASH_PLACEHOLDER} | ${timestamp} | ${deviceTag}`;
    
    console.log('创建强制清空记录:', forceClearEntry);
    return forceClearEntry;
  }

  /**
   * 初始化云端存储（首次同步）
   */
  private async initializeCloudStorage(
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[]
  ): Promise<SyncResult> {
    return this.initializeCloudStorageWithForceReset(currentSnippets, currentDirectories, '');
  }

  /**
   * 初始化云端存储（支持强制重置）
   */
  private async initializeCloudStorageWithForceReset(
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[],
    baseHistory: string = ''
  ): Promise<SyncResult> {
    try {
      console.log('初始化云端存储...');
      
      // 生成初始历史记录，如果有基础历史记录（如强制清空记录），则在其基础上添加
      let history = baseHistory;
      const timestamp = new Date().toISOString();
      
      // 按层级顺序添加目录
      const sortedDirs = currentDirectories.sort((a, b) => {
        const aPath = ChangelogManager.generateFullPath(a, currentDirectories);
        const bPath = ChangelogManager.generateFullPath(b, currentDirectories);
        const aDepth = (aPath.match(/\//g) || []).length;
        const bDepth = (bPath.match(/\//g) || []).length;
        return aDepth - bDepth;
      });
      
      for (const directory of sortedDirs) {
        const fullPath = ChangelogManager.generateFullPath(directory, currentDirectories);
        history = ChangelogManager.addEntry(
          history,
          OperationType.ADD,
          fullPath,
          ChangelogManager.HASH_PLACEHOLDER,
          timestamp,
          undefined,
          this.context || undefined
        );
      }
      
      // 添加所有代码片段
      for (const snippet of currentSnippets) {
        const fullPath = ChangelogManager.generateFullPath(snippet, currentDirectories);
        const hash = ChangelogManager.calculateItemHash(snippet);
        
        // 上传代码片段文件
        const key = this.generateSnippetKey(fullPath);
        const content = this.snippetToJson(snippet);
        await this.uploadFile(key, content);
        
        // 添加到历史记录
        history = ChangelogManager.addEntry(
          history,
          OperationType.ADD,
          fullPath,
          hash,
          timestamp,
          undefined,
          this.context || undefined
        );
      }
      
      // 上传历史记录
      await this.uploadFile(this.HISTORY_FILE_KEY, history);
      
      // 生成并上传元数据
      const metadata = await this.generateMetadata(history, currentSnippets, currentDirectories);
      await this.uploadFile(this.METADATA_FILE_KEY, JSON.stringify(metadata, null, 2));
      
      // 更新本地同步状态
      await this.saveLocalSyncHistory(history);
      await this.saveLocalSyncMetadata(metadata);
      
      // 更新同步状态
      const status = SettingsManager.getCloudSyncStatus();
      status.lastSyncTime = Date.now();
      status.lastError = null;
      await SettingsManager.saveCloudSyncStatus(status);
      
      const message = baseHistory ? '强制重置后云端存储初始化成功' : '云端存储初始化成功';
      return {
        success: true,
        message: message
      };
      
    } catch (error) {
      console.error('初始化云端存储失败:', error);
      return {
        success: false,
        message: `初始化失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }
} 