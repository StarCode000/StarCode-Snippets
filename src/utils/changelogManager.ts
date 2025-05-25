import * as crypto from 'crypto';
import { CodeSnippet, Directory } from '../models/types';

// 操作类型枚举
export enum OperationType {
  ADD = '+',
  MODIFY = '~',
  DELETE = '-'
}

// 历史记录条目接口
export interface HistoryEntry {
  operation: OperationType;
  fullPath: string;
  hash: string;
  timestamp: string;
}

// 变更集接口
export interface ChangeSet {
  addedFiles: Array<{ path: string; item: CodeSnippet | Directory }>;
  modifiedFiles: Array<{ path: string; item: CodeSnippet | Directory; oldHash: string }>;
  deletedFiles: Array<{ path: string; hash: string }>;
  addedDirectories: Array<{ path: string; item: Directory }>;
  deletedDirectories: Array<{ path: string }>;
}

export class ChangelogManager {
  public static readonly HASH_PLACEHOLDER = '#';
  
  /**
   * 解析历史记录文本为条目数组
   */
  public static parseHistory(historyText: string): HistoryEntry[] {
    if (!historyText.trim()) {
      return [];
    }
    
    const lines = historyText.split('\n').filter(line => line.trim());
    const entries: HistoryEntry[] = [];
    
    for (const line of lines) {
      const parts = line.split(' | ');
      if (parts.length !== 4) {
        console.warn(`跳过格式错误的历史记录行: ${line}`);
        continue;
      }
      
      const [operation, fullPath, hash, timestamp] = parts;
      
      if (!Object.values(OperationType).includes(operation as OperationType)) {
        console.warn(`跳过未知操作类型: ${operation}`);
        continue;
      }
      
      entries.push({
        operation: operation as OperationType,
        fullPath: fullPath.trim(),
        hash: hash.trim(),
        timestamp: timestamp.trim()
      });
    }
    
    return entries;
  }
  
  /**
   * 将历史记录条目数组转换为文本
   */
  public static formatHistory(entries: HistoryEntry[]): string {
    return entries
      .map(entry => `${entry.operation} | ${entry.fullPath} | ${entry.hash} | ${entry.timestamp}`)
      .join('\n');
  }
  
  /**
   * 添加新的历史记录条目
   */
  public static addEntry(
    existingHistory: string,
    operation: OperationType,
    fullPath: string,
    hash: string,
    timestamp?: string
  ): string {
    const entries = this.parseHistory(existingHistory);
    const newTimestamp = timestamp || new Date().toISOString();
    
    // 检查是否为重复操作（连续的相同操作）
    if (entries.length > 0) {
      const lastEntry = entries[entries.length - 1];
      if (lastEntry.operation === operation && 
          lastEntry.fullPath === fullPath && 
          lastEntry.hash === hash) {
        console.log(`跳过重复操作: ${operation} ${fullPath}`);
        return existingHistory;
      }
    }
    
    const newEntry: HistoryEntry = {
      operation,
      fullPath,
      hash,
      timestamp: newTimestamp
    };
    
    entries.push(newEntry);
    return this.formatHistory(entries);
  }
  
  /**
   * 计算代码片段或目录的哈希值
   */
  public static calculateItemHash(item: CodeSnippet | Directory): string {
    let stableContent: any;
    
    if ('code' in item) {
      // 代码片段
      stableContent = {
        id: item.id,
        name: item.name,
        code: item.code,
        language: item.language,
        parentId: item.parentId
      };
    } else {
      // 目录
      stableContent = {
        id: item.id,
        name: item.name,
        parentId: item.parentId,
        order: item.order
      };
    }
    
    return crypto.createHash('sha256')
      .update(JSON.stringify(stableContent), 'utf8')
      .digest('hex');
  }
  
  /**
   * 生成文件的完整路径
   */
  public static generateFullPath(item: CodeSnippet | Directory, allDirectories: Directory[]): string {
    const pathParts: string[] = [];
    let currentParentId = item.parentId;
    
    // 向上遍历目录结构
    while (currentParentId) {
      const parentDir = allDirectories.find(d => d.id === currentParentId);
      if (!parentDir) {
        break;
      }
      pathParts.unshift(parentDir.name);
      currentParentId = parentDir.parentId;
    }
    
    if ('code' in item) {
      // 代码片段文件
      pathParts.push(`${item.name}.json`);
      return '/' + pathParts.join('/');
    } else {
      // 目录
      pathParts.push(item.name);
      return '/' + pathParts.join('/') + '/';
    }
  }
  
  /**
   * 根据历史记录重建状态快照
   */
  public static rebuildStateFromHistory(historyText: string): {
    files: Map<string, { hash: string; timestamp: string }>;
    directories: Set<string>;
  } {
    const entries = this.parseHistory(historyText);
    const files = new Map<string, { hash: string; timestamp: string }>();
    const directories = new Set<string>();
    
    for (const entry of entries) {
      switch (entry.operation) {
        case OperationType.ADD:
          if (entry.fullPath.endsWith('/')) {
            // 目录
            directories.add(entry.fullPath);
          } else {
            // 文件
            files.set(entry.fullPath, {
              hash: entry.hash,
              timestamp: entry.timestamp
            });
          }
          break;
          
        case OperationType.MODIFY:
          if (!entry.fullPath.endsWith('/')) {
            // 只有文件可以被修改
            files.set(entry.fullPath, {
              hash: entry.hash,
              timestamp: entry.timestamp
            });
          }
          break;
          
        case OperationType.DELETE:
          if (entry.fullPath.endsWith('/')) {
            // 目录
            directories.delete(entry.fullPath);
          } else {
            // 文件
            files.delete(entry.fullPath);
          }
          break;
      }
    }

    return { files, directories };
  }
  
  /**
   * 比较当前状态与历史记录状态，生成变更集
   */
  public static compareWithActualState(
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[],
    lastSyncHistory: string
  ): ChangeSet {
    const changeSet: ChangeSet = {
      addedFiles: [],
      modifiedFiles: [],
      deletedFiles: [],
      addedDirectories: [],
      deletedDirectories: []
    };
    
    // 重建上次同步时的状态
    const { files: lastSyncFiles, directories: lastSyncDirs } = 
      this.rebuildStateFromHistory(lastSyncHistory);
    
    // 当前状态的路径映射
    const currentFilePaths = new Map<string, CodeSnippet>();
    const currentDirPaths = new Map<string, Directory>();
    
    // 构建当前文件路径映射
    for (const snippet of currentSnippets) {
      const fullPath = this.generateFullPath(snippet, currentDirectories);
      currentFilePaths.set(fullPath, snippet);
    }
    
    // 构建当前目录路径映射
    for (const directory of currentDirectories) {
      const fullPath = this.generateFullPath(directory, currentDirectories);
      currentDirPaths.set(fullPath, directory);
    }
    
    // 检查文件变更
    for (const [currentPath, snippet] of currentFilePaths) {
      const currentHash = this.calculateItemHash(snippet);
      const lastSyncFile = lastSyncFiles.get(currentPath);
      
      if (!lastSyncFile) {
        // 新增文件
        changeSet.addedFiles.push({ path: currentPath, item: snippet });
      } else if (lastSyncFile.hash !== currentHash) {
        // 修改文件
        changeSet.modifiedFiles.push({
          path: currentPath,
          item: snippet,
          oldHash: lastSyncFile.hash
        });
      }
    }
    
    // 检查删除的文件
    for (const [lastSyncPath, fileInfo] of lastSyncFiles) {
      if (!currentFilePaths.has(lastSyncPath)) {
        changeSet.deletedFiles.push({
          path: lastSyncPath,
          hash: fileInfo.hash
        });
      }
    }

    // 检查目录变更
    for (const [currentPath, directory] of currentDirPaths) {
      if (!lastSyncDirs.has(currentPath)) {
        // 新增目录
        changeSet.addedDirectories.push({ path: currentPath, item: directory });
      }
    }
    
    // 检查删除的目录
    for (const lastSyncPath of lastSyncDirs) {
      if (!currentDirPaths.has(lastSyncPath)) {
        changeSet.deletedDirectories.push({ path: lastSyncPath });
      }
    }
    
    return changeSet;
  }
  
  /**
   * 将变更集转换为历史记录条目
   */
  public static changeSetToHistoryEntries(changeSet: ChangeSet): HistoryEntry[] {
    const entries: HistoryEntry[] = [];
    const timestamp = new Date().toISOString();
    
    // 先添加目录（按层级顺序）
    const sortedDirs = changeSet.addedDirectories.sort((a, b) => {
      const aDepth = (a.path.match(/\//g) || []).length;
      const bDepth = (b.path.match(/\//g) || []).length;
      return aDepth - bDepth;
    });
    
    for (const { path } of sortedDirs) {
      entries.push({
        operation: OperationType.ADD,
        fullPath: path,
        hash: this.HASH_PLACEHOLDER,
        timestamp
      });
    }
    
    // 添加新增文件
    for (const { path, item } of changeSet.addedFiles) {
      entries.push({
        operation: OperationType.ADD,
        fullPath: path,
        hash: this.calculateItemHash(item),
        timestamp
      });
    }
    
    // 添加修改文件
    for (const { path, item } of changeSet.modifiedFiles) {
      entries.push({
        operation: OperationType.MODIFY,
        fullPath: path,
        hash: this.calculateItemHash(item),
        timestamp
      });
    }
    
    // 删除文件（先删除文件，再删除目录）
    for (const { path, hash } of changeSet.deletedFiles) {
      entries.push({
        operation: OperationType.DELETE,
        fullPath: path,
        hash: this.HASH_PLACEHOLDER,
        timestamp
      });
    }
    
    // 删除目录（按层级倒序）
    const sortedDelDirs = changeSet.deletedDirectories.sort((a, b) => {
      const aDepth = (a.path.match(/\//g) || []).length;
      const bDepth = (b.path.match(/\//g) || []).length;
      return bDepth - aDepth;
    });
    
    for (const { path } of sortedDelDirs) {
      entries.push({
        operation: OperationType.DELETE,
        fullPath: path,
        hash: this.HASH_PLACEHOLDER,
        timestamp
      });
    }
    
    return entries;
  }
  
  /**
   * 验证历史记录的完整性
   */
  public static validateHistory(historyText: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    const entries = this.parseHistory(historyText);
    
    if (entries.length === 0) {
      return { isValid: true, errors: [] };
    }
    
    // 检查第一条记录必须是新增操作
    if (entries[0].operation !== OperationType.ADD) {
      errors.push('历史记录的第一条记录必须是新增操作');
    }
    
    // 检查时间戳顺序
    for (let i = 1; i < entries.length; i++) {
      const prevTime = new Date(entries[i - 1].timestamp);
      const currTime = new Date(entries[i].timestamp);
      
      if (currTime < prevTime) {
        errors.push(`时间戳顺序错误: ${entries[i].timestamp} 早于 ${entries[i - 1].timestamp}`);
      }
    }
    
    // 检查目录和文件的操作逻辑
    const state = new Set<string>();
    
    for (const entry of entries) {
      switch (entry.operation) {
        case OperationType.ADD:
          if (state.has(entry.fullPath)) {
            errors.push(`重复添加: ${entry.fullPath}`);
          } else {
            state.add(entry.fullPath);
          }
          break;
          
        case OperationType.MODIFY:
          if (!state.has(entry.fullPath)) {
            errors.push(`修改不存在的项目: ${entry.fullPath}`);
          }
          break;
          
        case OperationType.DELETE:
          if (!state.has(entry.fullPath)) {
            errors.push(`删除不存在的项目: ${entry.fullPath}`);
          } else {
            state.delete(entry.fullPath);
          }
          break;
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
} 