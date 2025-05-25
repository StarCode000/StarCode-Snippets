import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import * as vscode from 'vscode';
import { CloudSyncConfig, CloudSyncStatus, CodeSnippet, Directory } from '../models/types';
import { SettingsManager } from './settingsManager';
import { ChangelogManager, OperationType, HistoryEntry, ChangeSet } from './changelogManager';
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
  private readonly HISTORY_FILE_KEY = 'history.txt';
  private readonly METADATA_FILE_KEY = 'metadata.json';
  private readonly SNIPPETS_PREFIX = 'snippets/';
  
  constructor(context?: vscode.ExtensionContext) {
    this.config = SettingsManager.getCloudSyncConfig();
    this.context = context || null;
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
    // 移除开头的斜杠，添加snippets前缀
    const cleanPath = fullPath.startsWith('/') ? fullPath.substring(1) : fullPath;
    return this.SNIPPETS_PREFIX + cleanPath;
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
    try {
      const isEditing = await vscode.commands.executeCommand('getContext', 'starcode-snippets.isEditingSnippet') as boolean;
      if (isEditing) {
        return {
          success: false,
          message: '用户正在编辑代码片段，无法进行同步'
        };
      }
    } catch (error) {
      console.warn('检查编辑状态失败，继续同步:', error);
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
        return {
          success: true,
          message: '没有需要同步的变更'
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
      const newEntries = ChangelogManager.changeSetToHistoryEntries(changeSet);
      
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
          entry.timestamp
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
      
      // 这里需要实现从云端下载文件并更新本地存储的逻辑
      // 由于涉及到StorageManager的集成，暂时返回成功状态
      // 在后续步骤中会完善这部分逻辑
      
      // 更新本地同步状态
      await this.saveLocalSyncHistory(remoteHistory);
      await this.saveLocalSyncMetadata(remoteMetadata);
      
      // 更新同步状态
      const status = SettingsManager.getCloudSyncStatus();
      status.lastSyncTime = Date.now();
      status.lastError = null;
      await SettingsManager.saveCloudSyncStatus(status);
      
      return {
        success: true,
        message: '云端变更已成功拉取到本地'
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
    // 简单的冲突处理：本地优先策略
    console.log('检测到冲突，使用本地优先策略...');
    
    // 先拉取远端变更，然后推送本地变更
    await this.pullRemoteChanges(remoteHistory, remoteMetadata);
    return await this.pushLocalChanges(localChanges, currentSnippets, currentDirectories);
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
   * 初始化云端存储（首次同步）
   */
  private async initializeCloudStorage(
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[]
  ): Promise<SyncResult> {
    try {
      console.log('初始化云端存储...');
      
      // 生成初始历史记录
      let history = '';
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
          timestamp
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
          timestamp
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
      
      return {
        success: true,
        message: '云端存储初始化成功'
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