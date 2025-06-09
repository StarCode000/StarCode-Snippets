import * as vscode from 'vscode'
import { CodeSnippet, Directory } from '../types/types'

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
  private readonly cacheLifetime = 10000 // 缓存有效期10秒
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

      // 预加载缓存
      this.preloadCache()
    } catch (error) {
      vscode.window.showErrorMessage(`初始化存储失败: ${error}`)
      throw error
    }
  }

  // 预加载缓存方法
  private preloadCache() {
    setTimeout(async () => {
      try {
        await Promise.all([this.getAllSnippets(), this.getAllDirectories()])
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

    const existingPromise = this.fileReadPromises.get(fileKey)
    if (existingPromise) {
      return existingPromise
    }

    const promise = this.readFileWithRetry(file, retries).finally(() => {
      this.fileReadPromises.delete(fileKey)
    })

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

      await vscode.workspace.fs.writeFile(tempFile, Buffer.from(JSON.stringify(data, null, 2)))

      const tempContent = await this.readFileWithRetry(tempFile)
      if (JSON.stringify(tempContent) !== JSON.stringify(data)) {
        throw new Error('文件验证失败')
      }

      await vscode.workspace.fs.rename(tempFile, file, { overwrite: true })

      // 更新缓存并清除读取Promise缓存
      const fileKey = file.toString()
      this.fileReadPromises.delete(fileKey)

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
      const now = Date.now()
      if (this.snippetsCache && now - this.lastSnippetsRead < this.cacheLifetime) {
        // console.log(`StorageManager: 使用缓存返回 ${this.snippetsCache.length} 个代码片段`)
        return this.snippetsCache
      }

      const snippets = await this.getFileReadPromise(this.snippetsFile)

      this.snippetsCache = snippets
      this.lastSnippetsRead = now

      // console.log(`StorageManager: 从文件读取 ${snippets.length} 个代码片段`)
      if (snippets.length > 0) {
        // console.log(
        //   '代码片段列表:',
        //   JSON.stringify(
        //     snippets.map((s: CodeSnippet) => ({ id: s.id, name: s.name, parentId: s.parentId })),
        //     null,
        //     2
        //   )
        // )
      }

      return snippets
    } catch (error) {
      console.error('读取代码片段失败:', error)
      return []
    }
  }

  // 获取所有目录
  public async getAllDirectories(): Promise<Directory[]> {
    try {
      const now = Date.now()
      if (this.directoriesCache && now - this.lastDirectoriesRead < this.cacheLifetime) {
        return this.directoriesCache
      }

      const directories = await this.getFileReadPromise(this.directoriesFile)

      this.directoriesCache = directories
      this.lastDirectoriesRead = now

      return directories
    } catch (error) {
      console.error('读取目录失败:', error)
      return []
    }
  }

  // 保存代码片段（如果已存在相同路径的代码片段则更新，否则新增）
  public async saveSnippet(snippet: CodeSnippet): Promise<void> {
    try {
      const snippets = await this.getAllSnippets()
      const existingIndex = snippets.findIndex((s) => s.fullPath === snippet.fullPath)
      
      if (existingIndex >= 0) {
        // 已存在相同路径的代码片段，更新它
        const existing = snippets[existingIndex]
        
        if (!this.hasSnippetChanged(existing, snippet)) {
          // console.log(`代码片段无变化，跳过保存: ${snippet.name}`)
          return
        }
        
        snippets[existingIndex] = snippet
        // console.log(`代码片段已更新: ${snippet.name}`)
      } else {
        // 不存在相同路径的代码片段，新增
        snippets.push(snippet)
        // console.log(`代码片段已新增: ${snippet.name}`)
      }
      
      await this.writeFileWithRetry(this.snippetsFile, snippets)
    } catch (error) {
      console.error('保存代码片段失败:', error)
      throw error
    }
  }

  // 更新代码片段
  public async updateSnippet(snippet: CodeSnippet): Promise<void> {
    try {
      const snippets = await this.getAllSnippets()
      const index = snippets.findIndex((s) => s.fullPath === snippet.fullPath)

      if (index === -1) {
        throw new Error(`代码片段不存在: ${snippet.fullPath}`)
      }

      const existing = snippets[index]

      if (!this.hasSnippetChanged(existing, snippet)) {
        // console.log(`代码片段无变化，跳过更新: ${snippet.name}`)
        return
      }

      snippets[index] = snippet
      await this.writeFileWithRetry(this.snippetsFile, snippets)
      // console.log(`代码片段已更新: ${snippet.name}`)
    } catch (error) {
      console.error('更新代码片段失败:', error)
      throw error
    }
  }

  // 删除代码片段
  public async deleteSnippet(fullPath: string): Promise<void> {
    try {
      const snippets = await this.getAllSnippets()
      const index = snippets.findIndex((s) => s.fullPath === fullPath)

      if (index === -1) {
        throw new Error(`代码片段不存在: ${fullPath}`)
      }

      const deletedSnippet = snippets[index]
      snippets.splice(index, 1)
      await this.writeFileWithRetry(this.snippetsFile, snippets)
      // console.log(`代码片段已删除: ${deletedSnippet.name}`)
    } catch (error) {
      console.error('删除代码片段失败:', error)
      throw error
    }
  }

  // 创建目录
  public async createDirectory(directory: Directory): Promise<void> {
    try {
      const directories = await this.getAllDirectories()
      directories.push(directory)
      await this.writeFileWithRetry(this.directoriesFile, directories)
      // console.log(`目录已创建: ${directory.name}`)
    } catch (error) {
      console.error('创建目录失败:', error)
      throw error
    }
  }

  // 更新目录
  public async updateDirectory(directory: Directory): Promise<void> {
    try {
      const directories = await this.getAllDirectories()
      const index = directories.findIndex((d) => d.fullPath === directory.fullPath)

      if (index === -1) {
        throw new Error(`目录不存在: ${directory.fullPath}`)
      }

      const existing = directories[index]

      if (!this.hasDirectoryChanged(existing, directory)) {
        // console.log(`目录无变化，跳过更新: ${directory.name}`)
        return
      }

      directories[index] = directory
      await this.writeFileWithRetry(this.directoriesFile, directories)
      // console.log(`目录已更新: ${directory.name}`)
    } catch (error) {
      console.error('更新目录失败:', error)
      throw error
    }
  }

  // 删除目录
  public async deleteDirectory(fullPath: string): Promise<void> {
    try {
      const [directories, snippets] = await Promise.all([this.getAllDirectories(), this.getAllSnippets()])

      const directoryIndex = directories.findIndex((d) => d.fullPath === fullPath)
      if (directoryIndex === -1) {
        throw new Error(`目录不存在: ${fullPath}`)
      }

      const deletedDirectory = directories[directoryIndex]

      // 递归删除子目录和代码片段（基于路径前缀）
      const toDelete = this.findAllChildItemsByPath(fullPath, directories, snippets)

      // 删除所有子项目
      for (const item of toDelete.snippets) {
        const snippetIndex = snippets.findIndex((s) => s.fullPath === item.fullPath)
        if (snippetIndex >= 0) {
          snippets.splice(snippetIndex, 1)
        }
      }

      for (const item of toDelete.directories) {
        const dirIndex = directories.findIndex((d) => d.fullPath === item.fullPath)
        if (dirIndex >= 0) {
          directories.splice(dirIndex, 1)
        }
      }

      // 删除目录本身
      directories.splice(directoryIndex, 1)

      // 保存更改
      await Promise.all([
        this.writeFileWithRetry(this.directoriesFile, directories),
        this.writeFileWithRetry(this.snippetsFile, snippets),
      ])

      // console.log(`目录及其内容已删除: ${deletedDirectory.name}`)
    } catch (error) {
      console.error('删除目录失败:', error)
      throw error
    }
  }

  // 递归查找所有子项目（基于路径前缀）
  private findAllChildItemsByPath(
    parentPath: string,
    directories: Directory[],
    snippets: CodeSnippet[]
  ): {
    directories: Directory[]
    snippets: CodeSnippet[]
  } {
    // 确保父路径以 '/' 结尾，以便正确匹配子路径
    const normalizedParentPath = parentPath.endsWith('/') ? parentPath : parentPath + '/'
    
    // 查找所有以父路径为前缀的子目录和代码片段
    const childDirectories = directories.filter((d) => 
      d.fullPath.startsWith(normalizedParentPath) && d.fullPath !== parentPath
    )
    const childSnippets = snippets.filter((s) => 
      s.fullPath.startsWith(normalizedParentPath)
    )

    return {
      directories: childDirectories,
      snippets: childSnippets,
    }
  }

  // 更新代码片段顺序
  public async updateSnippetsOrder(snippets: CodeSnippet[]): Promise<void> {
    await this.writeFileWithRetry(this.snippetsFile, snippets)
  }

  // 更新目录顺序
  public async updateDirectoriesOrder(directories: Directory[]): Promise<void> {
    await this.writeFileWithRetry(this.directoriesFile, directories)
  }

  // 清除缓存
  public clearCache(): void {
    this.snippetsCache = null
    this.directoriesCache = null
    this.lastSnippetsRead = 0
    this.lastDirectoriesRead = 0
  }

  // 检查代码片段是否有变化
  private hasSnippetChanged(existing: CodeSnippet, updated: CodeSnippet): boolean {
    return (
      existing.name !== updated.name ||
      existing.code !== updated.code ||
      existing.language !== updated.language ||
      existing.fullPath !== updated.fullPath
    )
  }

  // 检查目录是否有变化
  private hasDirectoryChanged(existing: Directory, updated: Directory): boolean {
    return existing.name !== updated.name || existing.fullPath !== updated.fullPath || existing.order !== updated.order
  }

  // 获取扩展上下文
  public getContext(): vscode.ExtensionContext {
    return this.context
  }
}
