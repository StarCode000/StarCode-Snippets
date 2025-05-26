import * as vscode from 'vscode';
import { CodeSnippetV1, DirectoryV1, CodeSnippetV2, DirectoryV2 } from '../models/types';
import { StorageManager } from '../storage/storageManager';
import { PathBasedManager } from './pathBasedManager';

/**
 * 存储策略接口
 * 定义不同版本存储实现的通用接口
 */
export interface StorageStrategy {
  // 基本CRUD操作
  getAllSnippets(): Promise<any[]>;
  getAllDirectories(): Promise<any[]>;
  getSnippetById?(id: string): Promise<any | null>;
  getDirectoryById?(id: string): Promise<any | null>;
  saveSnippet(snippet: any): Promise<void>;
  updateSnippet(snippet: any): Promise<void>;
  deleteSnippet(id: string): Promise<void>;
  createDirectory(directory: any): Promise<void>;
  updateDirectory(directory: any): Promise<void>;
  deleteDirectory(id: string): Promise<void>;
  clearCache(): Promise<void>;
  
  // 版本特定操作
  getSnippetByPath?(path: string): Promise<any | null>;
  getDirectoryByPath?(path: string): Promise<any | null>;
  getContext(): vscode.ExtensionContext;
  getVersion(): string; // 返回 "v1" 或 "v2"
}

/**
 * V1存储策略实现
 * 基于ID的存储逻辑，封装现有的StorageManager
 */
export class V1StorageStrategy implements StorageStrategy {
  private storageManager: StorageManager;
  private context: vscode.ExtensionContext;
  
  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.storageManager = new StorageManager(context);
  }
  
  async getAllSnippets(): Promise<CodeSnippetV1[]> {
    return this.storageManager.getAllSnippets();
  }
  
  async getAllDirectories(): Promise<DirectoryV1[]> {
    return this.storageManager.getAllDirectories();
  }
  
  async getSnippetById(id: string): Promise<CodeSnippetV1 | null> {
    // 从所有代码片段中查找
    const snippets = await this.getAllSnippets();
    return snippets.find(s => s.id === id) || null;
  }
  
  async getDirectoryById(id: string): Promise<DirectoryV1 | null> {
    // 从所有目录中查找
    const directories = await this.getAllDirectories();
    return directories.find(d => d.id === id) || null;
  }
  
  async saveSnippet(snippet: CodeSnippetV1): Promise<void> {
    return this.storageManager.saveSnippet(snippet);
  }
  
  async updateSnippet(snippet: CodeSnippetV1): Promise<void> {
    return this.storageManager.updateSnippet(snippet);
  }
  
  async deleteSnippet(id: string): Promise<void> {
    return this.storageManager.deleteSnippet(id);
  }
  
  async createDirectory(directory: DirectoryV1): Promise<void> {
    return this.storageManager.createDirectory(directory);
  }
  
  async updateDirectory(directory: DirectoryV1): Promise<void> {
    return this.storageManager.updateDirectory(directory);
  }
  
  async deleteDirectory(id: string): Promise<void> {
    return this.storageManager.deleteDirectory(id);
  }
  
  async clearCache(): Promise<void> {
    return this.storageManager.clearCache();
  }
  
  getContext(): vscode.ExtensionContext {
    return this.context;
  }
  
  getVersion(): string {
    return "v1";
  }
}

/**
 * V2存储策略实现
 * 基于路径的存储逻辑
 */
export class V2StorageStrategy implements StorageStrategy {
  private context: vscode.ExtensionContext;
  private snippetsKey = 'snippets.v2';
  private directoriesKey = 'directories.v2';
  private snippetsCache: CodeSnippetV2[] | null = null;
  private directoriesCache: DirectoryV2[] | null = null;
  
  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }
  
  async getAllSnippets(): Promise<CodeSnippetV2[]> {
    if (this.snippetsCache) {
      return this.snippetsCache;
    }
    const snippets = this.context.globalState.get<CodeSnippetV2[]>(this.snippetsKey, []);
    this.snippetsCache = snippets;
    return snippets;
  }
  
  async getAllDirectories(): Promise<DirectoryV2[]> {
    if (this.directoriesCache) {
      return this.directoriesCache;
    }
    const directories = this.context.globalState.get<DirectoryV2[]>(this.directoriesKey, []);
    this.directoriesCache = directories;
    return directories;
  }
  
  async getSnippetById(id: string): Promise<CodeSnippetV2 | null> {
    // V2不使用ID，但为了兼容性，生成一个基于路径的ID
    const snippets = await this.getAllSnippets();
    return snippets.find(s => PathBasedManager.generateIdFromPath(s.fullPath) === id) || null;
  }
  
  async getSnippetByPath(path: string): Promise<CodeSnippetV2 | null> {
    const snippets = await this.getAllSnippets();
    return snippets.find(s => s.fullPath === path) || null;
  }
  
  async getDirectoryById(id: string): Promise<DirectoryV2 | null> {
    // V2不使用ID，但为了兼容性，生成一个基于路径的ID
    const directories = await this.getAllDirectories();
    return directories.find(d => PathBasedManager.generateIdFromPath(d.fullPath) === id) || null;
  }
  
  async getDirectoryByPath(path: string): Promise<DirectoryV2 | null> {
    const directories = await this.getAllDirectories();
    return directories.find(d => d.fullPath === path) || null;
  }
  
  async saveSnippet(snippet: CodeSnippetV2): Promise<void> {
    const snippets = await this.getAllSnippets();
    snippets.push(snippet);
    await this.context.globalState.update(this.snippetsKey, snippets);
    this.snippetsCache = snippets;
  }
  
  async updateSnippet(snippet: CodeSnippetV2): Promise<void> {
    const snippets = await this.getAllSnippets();
    const index = snippets.findIndex(s => s.fullPath === snippet.fullPath);
    
    if (index !== -1) {
      snippets[index] = snippet;
      await this.context.globalState.update(this.snippetsKey, snippets);
      this.snippetsCache = snippets;
    } else {
      throw new Error(`未找到要更新的代码片段: ${snippet.fullPath}`);
    }
  }
  
  async deleteSnippet(id: string): Promise<void> {
    // 在V2中，我们需要先找到对应的路径
    const snippets = await this.getAllSnippets();
    const index = snippets.findIndex(s => PathBasedManager.generateIdFromPath(s.fullPath) === id);
    
    if (index !== -1) {
      snippets.splice(index, 1);
      await this.context.globalState.update(this.snippetsKey, snippets);
      this.snippetsCache = snippets;
    }
  }
  
  async createDirectory(directory: DirectoryV2): Promise<void> {
    const directories = await this.getAllDirectories();
    
    // 检查是否已存在相同路径的目录
    if (directories.some(d => d.fullPath === directory.fullPath)) {
      throw new Error(`目录已存在: ${directory.fullPath}`);
    }
    
    directories.push(directory);
    await this.context.globalState.update(this.directoriesKey, directories);
    this.directoriesCache = directories;
  }
  
  async updateDirectory(directory: DirectoryV2): Promise<void> {
    const directories = await this.getAllDirectories();
    const index = directories.findIndex(d => d.fullPath === directory.fullPath);
    
    if (index !== -1) {
      directories[index] = directory;
      await this.context.globalState.update(this.directoriesKey, directories);
      this.directoriesCache = directories;
    } else {
      throw new Error(`未找到要更新的目录: ${directory.fullPath}`);
    }
  }
  
  async deleteDirectory(id: string): Promise<void> {
    // 在V2中，我们需要先找到对应的路径
    const directories = await this.getAllDirectories();
    const index = directories.findIndex(d => PathBasedManager.generateIdFromPath(d.fullPath) === id);
    
    if (index !== -1) {
      const dirPath = directories[index].fullPath;
      
      // 删除目录
      directories.splice(index, 1);
      await this.context.globalState.update(this.directoriesKey, directories);
      this.directoriesCache = directories;
      
      // 同时删除该目录下的所有代码片段
      const snippets = await this.getAllSnippets();
      const filteredSnippets = snippets.filter(s => !s.fullPath.startsWith(dirPath));
      
      if (filteredSnippets.length !== snippets.length) {
        await this.context.globalState.update(this.snippetsKey, filteredSnippets);
        this.snippetsCache = filteredSnippets;
      }
    }
  }
  
  async clearCache(): Promise<void> {
    this.snippetsCache = null;
    this.directoriesCache = null;
  }
  
  async saveSnippets(snippets: CodeSnippetV2[]): Promise<void> {
    await this.context.globalState.update(this.snippetsKey, snippets);
    this.snippetsCache = snippets;
  }
  
  async saveDirectories(directories: DirectoryV2[]): Promise<void> {
    await this.context.globalState.update(this.directoriesKey, directories);
    this.directoriesCache = directories;
  }
  
  getContext(): vscode.ExtensionContext {
    return this.context;
  }
  
  getVersion(): string {
    return "v2";
  }
}

/**
 * 存储策略工厂
 * 负责创建合适的存储策略
 */
export class StorageStrategyFactory {
  static createStrategy(context: vscode.ExtensionContext, version?: string): StorageStrategy {
    // 从设置中读取首选版本
    const settings = vscode.workspace.getConfiguration('starcode-snippets');
    const preferredVersion = version || settings.get('storageVersion', 'v1');
    
    // 检查是否已有V2数据
    const hasV2Data = context.globalState.get('snippets.v2', null) !== null;
    
    if (preferredVersion === 'v2' || hasV2Data) {
      console.log('使用V2存储策略（基于路径）');
      return new V2StorageStrategy(context);
    } else {
      console.log('使用V1存储策略（基于ID）');
      return new V1StorageStrategy(context);
    }
  }
} 