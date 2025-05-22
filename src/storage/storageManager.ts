import * as vscode from 'vscode'
import { CodeSnippet, Directory } from '../models/types'

export class StorageManager {
  private context: vscode.ExtensionContext
  private storagePath: vscode.Uri
  private snippetsFile: vscode.Uri
  private directoriesFile: vscode.Uri
  private writeLock: boolean = false
  private writeQueue: Array<() => Promise<void>> = []
  private readonly maxRetries = 3
  private readonly retryDelay = 1000 // 1秒
  
  // 添加缓存
  private snippetsCache: CodeSnippet[] | null = null
  private directoriesCache: Directory[] | null = null
  private lastSnippetsRead: number = 0
  private lastDirectoriesRead: number = 0
  private readonly cacheLifetime = 10000 // 缓存有效期10秒，增加缓存时间减少IO
  private fileReadPromises: Map<string, Promise<any>> = new Map() // 读取承诺缓存

  constructor(context: vscode.ExtensionContext) {
    this.context = context
    this.storagePath = context.globalStorageUri
    this.snippetsFile = vscode.Uri.joinPath(this.storagePath, 'snippets.json')
    this.directoriesFile = vscode.Uri.joinPath(this.storagePath, 'directories.json')
    this.initializeStorage()
  }

  private async initializeStorage() {
    try {
      // 创建存储目录
      await vscode.workspace.fs.createDirectory(this.storagePath)

      // 初始化snippets.json（如果不存在）
      try {
        await vscode.workspace.fs.stat(this.snippetsFile)
      } catch {
        await vscode.workspace.fs.writeFile(this.snippetsFile, Buffer.from(JSON.stringify([], null, 2)))
      }

      // 初始化directories.json（如果不存在）
      try {
        await vscode.workspace.fs.stat(this.directoriesFile)
      } catch {
        await vscode.workspace.fs.writeFile(this.directoriesFile, Buffer.from(JSON.stringify([], null, 2)))
      }
      
      // 预加载缓存 - 非阻塞方式
      this.preloadCache()
    } catch (error) {
      vscode.window.showErrorMessage(`初始化存储失败: ${error}`)
      throw error
    }
  }
  
  // 预加载缓存方法
  private preloadCache() {
    // 使用非阻塞方式预加载
    setTimeout(async () => {
      try {
        await Promise.all([
          this.getAllSnippets(),
          this.getAllDirectories()
        ])
      } catch (error) {
        console.error('预加载缓存失败:', error)
      }
    }, 0)
  }

  // 文件写入锁定机制
  private async acquireLock(): Promise<void> {
    if (this.writeLock) {
      return new Promise((resolve) => {
        this.writeQueue.push(async () => {
          resolve()
        })
      })
    }
    this.writeLock = true
  }

  private releaseLock(): void {
    this.writeLock = false
    const nextWrite = this.writeQueue.shift()
    if (nextWrite) {
      nextWrite()
    }
  }

  // 延迟函数
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // 共享读取承诺，防止并发读取同一文件
  private getFileReadPromise(file: vscode.Uri, retries = this.maxRetries): Promise<any> {
    const fileKey = file.toString()
    
    // 如果已存在读取承诺并且未完成，直接返回
    const existingPromise = this.fileReadPromises.get(fileKey)
    if (existingPromise) {
      return existingPromise
    }

    // 创建新的读取承诺
    const promise = this.readFileWithRetry(file, retries)
      .finally(() => {
        // 完成后从缓存中移除
        this.fileReadPromises.delete(fileKey)
      })
    
    // 缓存承诺
    this.fileReadPromises.set(fileKey, promise)
    return promise
  }

  // 带重试的文件读取
  private async readFileWithRetry(file: vscode.Uri, retries = this.maxRetries): Promise<any> {
    try {
      const data = await vscode.workspace.fs.readFile(file)
      return JSON.parse(data.toString())
    } catch (error) {
      if (retries > 0 && error instanceof vscode.FileSystemError) {
        await this.delay(this.retryDelay)
        return this.readFileWithRetry(file, retries - 1)
      }
      throw error
    }
  }

  // 带重试的文件写入
  private async writeFileWithRetry(file: vscode.Uri, data: any, retries = this.maxRetries): Promise<void> {
    const tempFile = vscode.Uri.joinPath(this.storagePath, `${file.path.split('/').pop()}.tmp`)

    try {
      await this.acquireLock()

      // 写入临时文件
      await vscode.workspace.fs.writeFile(tempFile, Buffer.from(JSON.stringify(data, null, 2)))

      // 验证临时文件
      const tempContent = await this.readFileWithRetry(tempFile)
      if (JSON.stringify(tempContent) !== JSON.stringify(data)) {
        throw new Error('文件验证失败')
      }

      // 原子重命名
      await vscode.workspace.fs.rename(tempFile, file, { overwrite: true })
      
      // 更新缓存
      if (file.path.includes('snippets.json')) {
        this.snippetsCache = data
        this.lastSnippetsRead = Date.now()
      } else if (file.path.includes('directories.json')) {
        this.directoriesCache = data
        this.lastDirectoriesRead = Date.now()
      }
    } catch (error) {
      if (retries > 0) {
        await this.delay(this.retryDelay)
        return this.writeFileWithRetry(file, data, retries - 1)
      }
      throw error
    } finally {
      try {
        // 清理临时文件（如果还存在）
        await vscode.workspace.fs.delete(tempFile)
      } catch {
        // 忽略清理错误
      }
      this.releaseLock()
    }
  }

  // 获取所有代码片段
  public async getAllSnippets(): Promise<CodeSnippet[]> {
    try {
      // 首先检查缓存是否有效
      const now = Date.now()
      if (this.snippetsCache && (now - this.lastSnippetsRead < this.cacheLifetime)) {
        return this.snippetsCache
      }
      
      // 如果缓存无效，则从文件读取，使用共享读取承诺
      const snippets = await this.getFileReadPromise(this.snippetsFile) || []
      
      // 更新缓存
      this.snippetsCache = snippets
      this.lastSnippetsRead = now
      
      return snippets
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return []
      }
      // 如果读取失败但有缓存，使用缓存
      if (this.snippetsCache) {
        console.warn('读取文件失败，使用缓存数据', error)
        return this.snippetsCache
      }
      vscode.window.showErrorMessage(`读取代码片段失败: ${error}`)
      throw error
    }
  }

  // 获取所有目录
  public async getAllDirectories(): Promise<Directory[]> {
    try {
      // 首先检查缓存是否有效
      const now = Date.now()
      if (this.directoriesCache && (now - this.lastDirectoriesRead < this.cacheLifetime)) {
        return this.directoriesCache
      }
      
      // 如果缓存无效，则从文件读取，使用共享读取承诺
      const directories = await this.getFileReadPromise(this.directoriesFile) || []
      
      // 更新缓存
      this.directoriesCache = directories
      this.lastDirectoriesRead = now
      
      return directories
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return []
      }
      // 如果读取失败但有缓存，使用缓存
      if (this.directoriesCache) {
        console.warn('读取文件失败，使用缓存数据', error)
        return this.directoriesCache
      }
      vscode.window.showErrorMessage(`读取目录失败: ${error}`)
      throw error
    }
  }

  // 保存代码片段
  public async saveSnippet(snippet: CodeSnippet): Promise<void> {
    try {
      const snippets = await this.getAllSnippets()
      if (snippets.some((s) => s.id === snippet.id)) {
        throw new Error('代码片段ID已存在')
      }
      snippets.push(snippet)
      await this.writeFileWithRetry(this.snippetsFile, snippets)
    } catch (error) {
      vscode.window.showErrorMessage(`保存代码片段失败: ${error}`)
      throw error
    }
  }

  // 更新代码片段
  public async updateSnippet(snippet: CodeSnippet): Promise<void> {
    try {
      const snippets = await this.getAllSnippets()
      const index = snippets.findIndex((s) => s.id === snippet.id)
      if (index === -1) {
        throw new Error('代码片段不存在')
      }
      snippets[index] = snippet
      await this.writeFileWithRetry(this.snippetsFile, snippets)
    } catch (error) {
      vscode.window.showErrorMessage(`更新代码片段失败: ${error}`)
      throw error
    }
  }

  // 删除代码片段
  public async deleteSnippet(id: string): Promise<void> {
    try {
      const snippets = await this.getAllSnippets()
      const filteredSnippets = snippets.filter((s) => s.id !== id)
      if (filteredSnippets.length === snippets.length) {
        throw new Error('代码片段不存在')
      }
      await this.writeFileWithRetry(this.snippetsFile, filteredSnippets)
    } catch (error) {
      vscode.window.showErrorMessage(`删除代码片段失败: ${error}`)
      throw error
    }
  }

  // 创建目录
  public async createDirectory(directory: Directory): Promise<void> {
    try {
      const directories = await this.getAllDirectories()
      if (directories.some((d) => d.id === directory.id)) {
        throw new Error('目录ID已存在')
      }
      directories.push(directory)
      await this.writeFileWithRetry(this.directoriesFile, directories)
    } catch (error) {
      vscode.window.showErrorMessage(`创建目录失败: ${error}`)
      throw error
    }
  }

  // 更新目录
  public async updateDirectory(directory: Directory): Promise<void> {
    try {
      const directories = await this.getAllDirectories()
      const index = directories.findIndex((d) => d.id === directory.id)
      if (index === -1) {
        throw new Error('目录不存在')
      }
      directories[index] = directory
      await this.writeFileWithRetry(this.directoriesFile, directories)
    } catch (error) {
      vscode.window.showErrorMessage(`更新目录失败: ${error}`)
      throw error
    }
  }

  // 删除目录
  public async deleteDirectory(id: string): Promise<void> {
    try {
      // 删除目录
      const directories = await this.getAllDirectories()
      const filteredDirectories = directories.filter((d) => d.id !== id)
      if (filteredDirectories.length === directories.length) {
        throw new Error('目录不存在')
      }
      await this.writeFileWithRetry(this.directoriesFile, filteredDirectories)

      // 删除该目录下的所有代码片段
      const snippets = await this.getAllSnippets()
      const filteredSnippets = snippets.filter((s) => s.parentId !== id)
      await this.writeFileWithRetry(this.snippetsFile, filteredSnippets)
    } catch (error) {
      vscode.window.showErrorMessage(`删除目录失败: ${error}`)
      throw error
    }
  }

  // 更新代码片段顺序
  public async updateSnippetsOrder(snippets: CodeSnippet[]): Promise<void> {
    try {
      await this.writeFileWithRetry(this.snippetsFile, snippets)
    } catch (error) {
      vscode.window.showErrorMessage(`更新顺序失败: ${error}`)
      throw error
    }
  }

  // 更新目录顺序
  public async updateDirectoriesOrder(directories: Directory[]): Promise<void> {
    try {
      await this.writeFileWithRetry(this.directoriesFile, directories)
    } catch (error) {
      vscode.window.showErrorMessage(`更新目录顺序失败: ${error}`)
      throw error
    }
  }

  // 清除缓存方法
  public clearCache(): void {
    this.snippetsCache = null
    this.directoriesCache = null
  }
}
