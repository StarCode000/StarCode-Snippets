import * as vscode from 'vscode'
import { CodeSnippetV1, DirectoryV1, CodeSnippetV2, DirectoryV2 } from '../types/types'
import { StorageManager } from '../storage/storageManager'
import { PathBasedManager } from './pathBasedManager'

/**
 * 存储策略接口
 * 定义不同版本存储实现的通用接口
 */
export interface StorageStrategy {
  // 基本CRUD操作
  getAllSnippets(): Promise<any[]>
  getAllDirectories(): Promise<any[]>
  getSnippetById?(id: string): Promise<any | null>
  getDirectoryById?(id: string): Promise<any | null>
  saveSnippet(snippet: any): Promise<void>
  updateSnippet(snippet: any): Promise<void>
  deleteSnippet(id: string): Promise<void>
  createDirectory(directory: any): Promise<void>
  updateDirectory(directory: any): Promise<void>
  deleteDirectory(id: string): Promise<void>
  clearCache(): Promise<void>

  // 版本特定操作
  getSnippetByPath?(path: string): Promise<any | null>
  getDirectoryByPath?(path: string): Promise<any | null>
  getContext(): vscode.ExtensionContext
  getVersion(): string // 返回 "v1" 或 "v2"
}

/**
 * V1存储策略实现
 * 基于ID的存储逻辑，封装现有的StorageManager
 */
export class V1StorageStrategy implements StorageStrategy {
  private storageManager: StorageManager
  private context: vscode.ExtensionContext

  constructor(context: vscode.ExtensionContext) {
    this.context = context
    this.storageManager = new StorageManager(context)
  }

  async getAllSnippets(): Promise<CodeSnippetV1[]> {
    // 从StorageManager获取数据
    const snippets = await this.storageManager.getAllSnippets()

    // 如果没有数据，尝试从旧版本的globalState获取
    if (snippets.length === 0) {
      // console.log('V1StorageStrategy: 从StorageManager获取的代码片段为空，尝试从旧版本globalState获取')
      const oldSnippets = this.context.globalState.get<CodeSnippetV1[]>('snippets', [])
      // console.log(`V1StorageStrategy: 从旧版本globalState找到 ${oldSnippets.length} 个代码片段`)
      return oldSnippets
    }

    // 将V2数据转换为V1格式，或直接返回V1数据
    return snippets as unknown as CodeSnippetV1[]
  }

  async getAllDirectories(): Promise<DirectoryV1[]> {
    // 从StorageManager获取数据
    const directories = await this.storageManager.getAllDirectories()

    // 如果没有数据，尝试从旧版本的globalState获取
    if (directories.length === 0) {
      // console.log('V1StorageStrategy: 从StorageManager获取的目录为空，尝试从旧版本globalState获取')
      const oldDirectories = this.context.globalState.get<DirectoryV1[]>('directories', [])
      // console.log(`V1StorageStrategy: 从旧版本globalState找到 ${oldDirectories.length} 个目录`)
      return oldDirectories
    }

    // 将V2数据转换为V1格式，或直接返回V1数据
    return directories as unknown as DirectoryV1[]
  }

  async getSnippetById(id: string): Promise<CodeSnippetV1 | null> {
    // 从所有代码片段中查找
    const snippets = await this.getAllSnippets()
    return snippets.find((s) => s.id === id) || null
  }

  async getDirectoryById(id: string): Promise<DirectoryV1 | null> {
    // 从所有目录中查找
    const directories = await this.getAllDirectories()
    return directories.find((d) => d.id === id) || null
  }

  async saveSnippet(snippet: CodeSnippetV1): Promise<void> {
    return this.storageManager.saveSnippet(snippet as unknown as any)
  }

  async updateSnippet(snippet: CodeSnippetV1): Promise<void> {
    return this.storageManager.updateSnippet(snippet as unknown as any)
  }

  async deleteSnippet(id: string): Promise<void> {
    return this.storageManager.deleteSnippet(id)
  }

  async createDirectory(directory: DirectoryV1): Promise<void> {
    return this.storageManager.createDirectory(directory as unknown as any)
  }

  async updateDirectory(directory: DirectoryV1): Promise<void> {
    return this.storageManager.updateDirectory(directory as unknown as any)
  }

  async deleteDirectory(id: string): Promise<void> {
    return this.storageManager.deleteDirectory(id)
  }

  async clearCache(): Promise<void> {
    return this.storageManager.clearCache()
  }

  getContext(): vscode.ExtensionContext {
    return this.context
  }

  getVersion(): string {
    return 'v1'
  }
}

/**
 * V2存储策略实现
 * 基于路径的存储逻辑
 */
export class V2StorageStrategy implements StorageStrategy {
  private context: vscode.ExtensionContext
  private snippetsKey = 'snippets.v2'
  private directoriesKey = 'directories.v2'
  private snippetsCache: CodeSnippetV2[] | null = null
  private directoriesCache: DirectoryV2[] | null = null

  constructor(context: vscode.ExtensionContext) {
    this.context = context
  }

  async getAllSnippets(): Promise<CodeSnippetV2[]> {
    if (this.snippetsCache) {
      return this.snippetsCache
    }
    const snippets = this.context.globalState.get<CodeSnippetV2[]>(this.snippetsKey, [])
    this.snippetsCache = snippets
    return snippets
  }

  async getAllDirectories(): Promise<DirectoryV2[]> {
    if (this.directoriesCache) {
      return this.directoriesCache
    }
    const directories = this.context.globalState.get<DirectoryV2[]>(this.directoriesKey, [])
    this.directoriesCache = directories
    return directories
  }

  async getSnippetById(id: string): Promise<CodeSnippetV2 | null> {
    // V2不使用ID，但为了兼容性，生成一个基于路径的ID
    const snippets = await this.getAllSnippets()
    return snippets.find((s) => PathBasedManager.generateIdFromPath(s.fullPath) === id) || null
  }

  async getSnippetByPath(path: string): Promise<CodeSnippetV2 | null> {
    const snippets = await this.getAllSnippets()
    return snippets.find((s) => s.fullPath === path) || null
  }

  async getDirectoryById(id: string): Promise<DirectoryV2 | null> {
    // V2不使用ID，但为了兼容性，生成一个基于路径的ID
    const directories = await this.getAllDirectories()
    return directories.find((d) => PathBasedManager.generateIdFromPath(d.fullPath) === id) || null
  }

  async getDirectoryByPath(path: string): Promise<DirectoryV2 | null> {
    const directories = await this.getAllDirectories()
    return directories.find((d) => d.fullPath === path) || null
  }

  async saveSnippet(snippet: CodeSnippetV2): Promise<void> {
    const snippets = await this.getAllSnippets()
    snippets.push(snippet)
    await this.context.globalState.update(this.snippetsKey, snippets)
    this.snippetsCache = snippets
  }

  async updateSnippet(snippet: CodeSnippetV2): Promise<void> {
    const snippets = await this.getAllSnippets()
    const index = snippets.findIndex((s) => s.fullPath === snippet.fullPath)

    if (index !== -1) {
      snippets[index] = snippet
      await this.context.globalState.update(this.snippetsKey, snippets)
      this.snippetsCache = snippets
    } else {
      throw new Error(`未找到要更新的代码片段: ${snippet.fullPath}`)
    }
  }

  async deleteSnippet(id: string): Promise<void> {
    // 在V2中，需要处理多种ID格式：
    // 1. 基于路径生成的ID
    // 2. 直接的fullPath
    // 3. 可能的V1格式ID（兼容性）
    const snippets = await this.getAllSnippets()
    
    let index = -1
    
    // 首先尝试使用生成的ID匹配
    index = snippets.findIndex((s) => PathBasedManager.generateIdFromPath(s.fullPath) === id)
    
    // 如果没找到，尝试直接用ID作为路径匹配
    if (index === -1) {
      index = snippets.findIndex((s) => s.fullPath === id)
    }
    
    // 如果还没找到，尝试作为V1格式的ID（如果数据中还有V1格式的id字段）
    if (index === -1) {
      index = snippets.findIndex((s) => (s as any).id === id)
    }

    // console.log(`V2删除代码片段: 查找ID "${id}", 找到索引: ${index}`)

    if (index !== -1) {
      const deletedSnippet = snippets[index]
      // console.log(`删除代码片段: ${deletedSnippet.name}, 路径: ${deletedSnippet.fullPath}`)
      
      snippets.splice(index, 1)
      await this.context.globalState.update(this.snippetsKey, snippets)
      this.snippetsCache = snippets
    } else {
      console.warn(`未找到要删除的代码片段: ${id}`)
    }
  }

  async createDirectory(directory: DirectoryV2): Promise<void> {
    const directories = await this.getAllDirectories()

    // 检查是否已存在相同路径的目录
    if (directories.some((d) => d.fullPath === directory.fullPath)) {
      throw new Error(`目录已存在: ${directory.fullPath}`)
    }

    directories.push(directory)
    await this.context.globalState.update(this.directoriesKey, directories)
    this.directoriesCache = directories
  }

  async updateDirectory(directory: DirectoryV2): Promise<void> {
    const directories = await this.getAllDirectories()
    const index = directories.findIndex((d) => d.fullPath === directory.fullPath)

    if (index !== -1) {
      directories[index] = directory
      await this.context.globalState.update(this.directoriesKey, directories)
      this.directoriesCache = directories
    } else {
      throw new Error(`未找到要更新的目录: ${directory.fullPath}`)
    }
  }

  async deleteDirectory(id: string): Promise<void> {
    // 在V2中，需要处理多种ID格式：
    // 1. 基于路径生成的ID
    // 2. 直接的fullPath
    // 3. 可能的V1格式ID（兼容性）
    const directories = await this.getAllDirectories()
    
    let index = -1
    
    // 首先尝试使用生成的ID匹配
    index = directories.findIndex((d) => PathBasedManager.generateIdFromPath(d.fullPath) === id)
    
    // 如果没找到，尝试直接用ID作为路径匹配
    if (index === -1) {
      index = directories.findIndex((d) => d.fullPath === id)
    }
    
    // 如果还没找到，尝试作为V1格式的ID（如果数据中还有V1格式的id字段）
    if (index === -1) {
      index = directories.findIndex((d) => (d as any).id === id)
    }

    // console.log(`V2删除目录: 查找ID "${id}", 找到索引: ${index}`)

    if (index !== -1) {
      const deletedDirectory = directories[index]
      const dirPath = deletedDirectory.fullPath
      
      // console.log(`删除目录: ${deletedDirectory.name}, 路径: ${dirPath}`)

      // 删除目录
      directories.splice(index, 1)
      await this.context.globalState.update(this.directoriesKey, directories)
      this.directoriesCache = directories

      // 同时删除该目录下的所有代码片段
      const snippets = await this.getAllSnippets()
      const filteredSnippets = snippets.filter((s) => !s.fullPath.startsWith(dirPath))

      if (filteredSnippets.length !== snippets.length) {
        // console.log(`同时删除目录下的 ${snippets.length - filteredSnippets.length} 个代码片段`)
        await this.context.globalState.update(this.snippetsKey, filteredSnippets)
        this.snippetsCache = filteredSnippets
      }
    } else {
      console.warn(`未找到要删除的目录: ${id}`)
    }
  }

  async clearCache(): Promise<void> {
    this.snippetsCache = null
    this.directoriesCache = null
  }

  async saveSnippets(snippets: CodeSnippetV2[]): Promise<void> {
    await this.context.globalState.update(this.snippetsKey, snippets)
    this.snippetsCache = snippets
  }

  async saveDirectories(directories: DirectoryV2[]): Promise<void> {
    await this.context.globalState.update(this.directoriesKey, directories)
    this.directoriesCache = directories
  }

  getContext(): vscode.ExtensionContext {
    return this.context
  }

  getVersion(): string {
    return 'v2'
  }
}

/**
 * 存储策略工厂
 * 负责创建合适的存储策略
 */
export class StorageStrategyFactory {
  static createStrategy(context: vscode.ExtensionContext, version?: string): StorageStrategy {
    // 从设置中读取首选版本，与package.json的默认值保持一致
    const settings = vscode.workspace.getConfiguration('starcode-snippets')
    const preferredVersion = version || settings.get('storageVersion', 'v2')

    // 检查是否已有V2数据
    const hasV2Data = context.globalState.get('snippets.v2', null) !== null

    // console.log(`存储版本选择: 配置版本=${preferredVersion}, 有V2数据=${hasV2Data}`)

    if (preferredVersion === 'v2' || hasV2Data) {
      // console.log('使用V2存储策略（基于路径）')
      return new V2StorageStrategy(context)
    } else {
      // console.log('使用V1存储策略（基于ID）')
      return new V1StorageStrategy(context)
    }
  }
}
