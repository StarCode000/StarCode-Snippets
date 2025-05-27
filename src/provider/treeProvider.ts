import * as vscode from 'vscode'
import { StorageManager } from '../storage/storageManager'
import { CodeSnippet, Directory, CodeSnippetV2, DirectoryV2 } from '../types/types'
import { SearchManager } from '../utils/searchManager'
import { SettingsManager } from '../utils/settingsManager'
import { PathBasedManager } from '../utils/pathBasedManager'

export class SnippetTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly snippet?: CodeSnippet | CodeSnippetV2,
    public readonly directory?: Directory | DirectoryV2,
    public readonly isSearchResult?: boolean
  ) {
    super(label, collapsibleState)

    // 设置图标
    if (directory) {
      this.iconPath = new vscode.ThemeIcon('folder')
      this.contextValue = 'directory'

      // 添加目录的内联按钮
      this.tooltip = `目录: ${directory.name}`

      // 为目录添加按钮 - 注意VSCode的树视图中这些会显示为图标
      // 不需要在这里添加，通过 package.json 的 view/item/context 配置
    } else if (snippet) {
      // 如果是搜索结果，使用不同的图标
      this.iconPath = isSearchResult ? new vscode.ThemeIcon('search') : new vscode.ThemeIcon('symbol-variable')
      this.contextValue = 'snippet'

      // 添加代码片段的tooltip显示代码预览
      const codePreview = snippet.code.length > 500 ? snippet.code.substring(0, 500) + '...' : snippet.code
      this.tooltip = new vscode.MarkdownString(`**${snippet.name}**\n\`\`\`${snippet.language}\n${codePreview}\n\`\`\``)

      // 为代码片段添加命令 - 双击时预览
      this.command = {
        command: 'starcode-snippets.previewSnippet',
        title: '预览代码片段',
        arguments: [snippet],
      }
    }
  }
}

export class SnippetsTreeDataProvider implements vscode.TreeDataProvider<SnippetTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<SnippetTreeItem | undefined | null | void> =
    new vscode.EventEmitter<SnippetTreeItem | undefined | null | void>()
  readonly onDidChangeTreeData: vscode.Event<SnippetTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event

  private _snippets: CodeSnippet[] | CodeSnippetV2[] = []
  private _directories: Directory[] | DirectoryV2[] = []
  private _initialized: boolean = false
  private _searchManager: SearchManager
  private _statusUpdateTimer: NodeJS.Timeout | undefined
  private _isV2Format: boolean = false

  constructor(private storageManager: StorageManager, searchManager: SearchManager) {
    this._searchManager = searchManager

    // 监听搜索变化
    this._searchManager.onDidChangeSearch(() => {
      this.refresh()
    })

    // 启动状态更新定时器（每5秒更新一次）
    this._startStatusUpdateTimer() // 暂时禁用定时器避免干扰调试

    // 立即加载数据
    this._loadData()
      .then(() => {
        this._initialized = true
        // 初始化完成后立即触发刷新
        this._onDidChangeTreeData.fire()
      })
      .catch((error) => {
        console.error('TreeDataProvider 初始化失败:', error)
        // 即使失败也标记为已初始化，避免无限等待
        this._initialized = true
        this._onDidChangeTreeData.fire()
      })
  }

  /**
   * 启动状态更新定时器
   */
  private _startStatusUpdateTimer(): void {
    // 清除现有定时器
    if (this._statusUpdateTimer) {
      clearInterval(this._statusUpdateTimer)
    }

    // 减少刷新频率，从5秒改为30秒，减轻循环刷新问题
    this._statusUpdateTimer = setInterval(() => {
      console.log('TreeDataProvider 定时器触发刷新')
      // 只刷新根节点的状态显示，不重新加载数据
      this._onDidChangeTreeData.fire()
    }, 30000) // 30秒刷新一次
  }

  /**
   * 停止状态更新定时器
   */
  private _stopStatusUpdateTimer(): void {
    if (this._statusUpdateTimer) {
      clearInterval(this._statusUpdateTimer)
      this._statusUpdateTimer = undefined
      console.log('TreeDataProvider 定时器已停止')
    }
  }

  /**
   * 销毁资源
   */
  dispose(): void {
    this._stopStatusUpdateTimer()
  }

  refresh(): void {
    console.log('TreeDataProvider.refresh() 被调用')
    this._loadData()
      .then(() => {
        console.log(
          `TreeDataProvider 数据加载完成，触发UI更新，数据统计: ${this._snippets.length}个代码片段，${this._directories.length}个目录`
        )
        this._onDidChangeTreeData.fire()
      })
      .catch((error) => {
        console.error('TreeDataProvider 刷新失败:', error)
        this._onDidChangeTreeData.fire() // 即使失败也触发更新
      })
  }

  /**
   * 生成同步时间显示文本
   */
  private _generateSyncTimeText(lastSyncTime: number): string {
    const now = Date.now()
    const diffSeconds = Math.floor((now - lastSyncTime) / 1000)

    if (diffSeconds <= 15) {
      return '刚刚同步'
    } else if (diffSeconds < 60) {
      return `${diffSeconds}秒前同步`
    } else if (diffSeconds < 3600) {
      const diffMinutes = Math.floor(diffSeconds / 60)
      return `${diffMinutes}分钟前同步`
    } else if (diffSeconds < 86400) {
      const diffHours = Math.floor(diffSeconds / 3600)
      return `${diffHours}小时前同步`
    } else {
      const diffDays = Math.floor(diffSeconds / 86400)
      return `${diffDays}天前同步`
    }
  }

  private async _loadData(): Promise<void> {
    try {
      console.log('TreeDataProvider 开始加载数据...')
      // 并行加载数据
      const [directories, snippets] = await Promise.all([
        this.storageManager.getAllDirectories(),
        this.storageManager.getAllSnippets(),
      ])

      console.log(`TreeDataProvider 成功从存储中获取: ${snippets.length}个代码片段，${directories.length}个目录`)

      this._directories = directories
      this._snippets = snippets

      // 检测数据格式
      if (snippets.length > 0) {
        // 检查是否为V2格式（有fullPath属性）
        this._isV2Format = 'fullPath' in snippets[0]
        console.log(
          `TreeDataProvider: 检测到 ${this._isV2Format ? 'v2' : 'v1'} 格式数据`,
          this._isV2Format
            ? `fullPath: ${(snippets[0] as any).fullPath}`
            : `id: ${(snippets[0] as any).id}, parentId: ${(snippets[0] as any).parentId}`
        )

        // 输出更多片段信息用于调试
        console.log('数据示例:', JSON.stringify(snippets[0]))
      } else if (directories.length > 0) {
        this._isV2Format = 'fullPath' in directories[0]
        console.log(`TreeDataProvider: 检测到 ${this._isV2Format ? 'v2' : 'v1'} 格式目录数据`)
        console.log('目录示例:', JSON.stringify(directories[0]))
      } else {
        // 没有数据时，查询全局状态确定当前版本
        try {
          // 如果已经迁移到V2，即使没有数据也应该使用V2格式
          const migratedToV2 = this.storageManager.getContext().globalState.get('migratedToV2', false)
          this._isV2Format = migratedToV2
          console.log(`TreeDataProvider: 无数据，根据迁移状态使用 ${this._isV2Format ? 'v2' : 'v1'} 格式`)
        } catch (e) {
          console.log('TreeDataProvider: 无法检测数据格式，无数据')
        }
      }
    } catch (error) {
      console.error('加载数据失败:', error)
      vscode.window.showErrorMessage(`加载代码片段失败: ${error}`)
    }
  }

  /**
   * 强制刷新视图并清除缓存
   */
  async forceRefresh(): Promise<void> {
    console.log('TreeDataProvider.forceRefresh() 被调用')
    try {
      // 尝试获取上下文和存储管理器的方法
      if (this.storageManager && typeof this.storageManager.clearCache === 'function') {
        await this.storageManager.clearCache()
        console.log('TreeDataProvider 缓存已清除')
      }

      // 重新加载数据
      await this._loadData()

      // 强制触发视图刷新
      this._onDidChangeTreeData.fire()

      console.log('TreeDataProvider 强制刷新完成')
    } catch (error) {
      console.error('强制刷新失败:', error)
      this._onDidChangeTreeData.fire() // 即使失败也尝试刷新UI
    }
  }

  getTreeItem(element: SnippetTreeItem): vscode.TreeItem {
    return element
  }

  /**
   * 获取指定目录的子目录和片段（兼容V1和V2格式）
   */
  private getChildrenForDirectory(
    directoryId: string | null | undefined,
    directoryPath?: string
  ): {
    childDirs: (Directory | DirectoryV2)[]
    childSnippets: (CodeSnippet | CodeSnippetV2)[]
  } {
    console.log(
      `getChildrenForDirectory 被调用: directoryId=${directoryId}, directoryPath=${directoryPath}, 当前格式=${
        this._isV2Format ? 'v2' : 'v1'
      }`
    )

    if (this._isV2Format) {
      // V2格式：基于路径的数据结构
      const path = directoryPath || '/'
      console.log(`V2格式处理: 使用路径=${path} 进行过滤`)

      // 过滤子目录
      const childDirs = (this._directories as DirectoryV2[]).filter((dir) => {
        if (!path || path === '/') {
          // 根目录只显示一级目录
          const pathParts = dir.fullPath.split('/').filter((p) => p.length > 0)
          const result = pathParts.length === 1
          if (result) {
            console.log(`  根级目录匹配: ${dir.name}, fullPath=${dir.fullPath}`)
          }
          return result
        } else {
          // 其他目录显示直接子目录
          // 修复判断逻辑：确保目录是当前路径的直接子目录
          const isChild = dir.fullPath.startsWith(path) && dir.fullPath !== path

          // 计算路径深度差，确保只是直接子目录
          const pathSegments = path.split('/').filter((p) => p.length > 0)
          const dirSegments = dir.fullPath.split('/').filter((p) => p.length > 0)

          const isDirectChild = isChild && dirSegments.length === pathSegments.length + 1

          if (isDirectChild) {
            console.log(`  子目录匹配: ${dir.name}, fullPath=${dir.fullPath}, 父路径=${path}`)
          }
          return isDirectChild
        }
      })

      // 过滤子代码片段
      const childSnippets = (this._snippets as CodeSnippetV2[]).filter((snippet) => {
        if (!path || path === '/') {
          // 根目录只显示没有路径的代码片段
          const pathParts = snippet.fullPath.split('/').filter((p) => p.length > 0)
          const result = pathParts.length === 1
          if (result) {
            console.log(`  根级片段匹配: ${snippet.name}, fullPath=${snippet.fullPath}`)
          }
          return result
        } else {
          // 其他目录显示直接子代码片段
          // 修复判断逻辑：确保snippet是当前路径的直接子元素

          // 计算路径深度，确保只是直接子元素
          const pathSegments = path.split('/').filter((p) => p.length > 0)
          const snippetSegments = snippet.fullPath.split('/').filter((p) => p.length > 0)

          // 检查snippet的父路径是否与当前目录路径匹配
          const parentPath = '/' + snippetSegments.slice(0, -1).join('/') + '/'
          const result = parentPath === path

          if (result) {
            console.log(`  子片段匹配: ${snippet.name}, fullPath=${snippet.fullPath}, 父路径=${parentPath}`)
          }
          return result
        }
      })

      console.log(`V2格式结果: 找到 ${childDirs.length} 个子目录和 ${childSnippets.length} 个代码片段`)
      return { childDirs, childSnippets }
    } else {
      // V1格式：基于ID的数据结构
      console.log(`V1格式处理: 使用parentId=${directoryId} 进行过滤`)
      const childDirs = (this._directories as Directory[]).filter((dir) => dir.parentId === directoryId)
      const childSnippets = (this._snippets as CodeSnippet[]).filter((snippet) => snippet.parentId === directoryId)

      console.log(`V1格式结果: 找到 ${childDirs.length} 个子目录和 ${childSnippets.length} 个代码片段`)
      return { childDirs, childSnippets }
    }
  }

  async getChildren(element?: SnippetTreeItem): Promise<SnippetTreeItem[]> {
    // 如果数据还没加载完成，先等待数据加载
    if (!this._initialized) {
      try {
        await this._loadData()
        this._initialized = true
      } catch (error) {
        console.error('数据加载失败:', error)
        this._initialized = true // 即使失败也标记为已初始化
      }
    }

    // 应用搜索过滤
    const filteredSnippets = this._searchManager.filterSnippets(this._snippets as any)
    const filteredDirectories = this._searchManager.filterDirectories(this._directories as any, filteredSnippets as any)

    if (!element) {
      // 根节点 - 显示所有顶级目录和代码片段
      const rootItems: SnippetTreeItem[] = []

      // 显示云端同步状态
      let syncStatus: any = { isConnected: false, lastSyncTime: null, lastError: null, isSyncing: false }
      let syncConfig: any = { endpoint: '', autoSync: false }

      try {
        syncStatus = SettingsManager.getCloudSyncStatus()
        syncConfig = SettingsManager.getCloudSyncConfig()
      } catch (error) {
        console.error('获取同步配置失败:', error)
      }

      // 始终显示同步状态，无论是否配置
      {
        let statusText = ''
        let statusIcon = ''

        if (!syncConfig.endpoint) {
          statusText = '未配置云端同步'
          statusIcon = 'cloud-offline'
        } else if (syncStatus.isSyncing) {
          statusText = '正在同步...'
          statusIcon = 'sync~spin'
        } else if (syncStatus.isConnected) {
          if (syncStatus.lastSyncTime) {
            statusText = this._generateSyncTimeText(syncStatus.lastSyncTime)
          } else {
            statusText = '已连接，未同步'
          }
          statusIcon = 'cloud'
        } else {
          statusText = '未连接'
          statusIcon = 'cloud-offline'
        }

        if (syncStatus.lastError) {
          statusText += ` (错误)`
          statusIcon = 'warning'
        }

        const syncStatusItem = new SnippetTreeItem(statusText, vscode.TreeItemCollapsibleState.None)
        syncStatusItem.contextValue = 'syncStatus'
        syncStatusItem.iconPath = new vscode.ThemeIcon(statusIcon)
        syncStatusItem.tooltip = `点击打开云端同步设置\n\n配置: ${syncConfig.endpoint || '未配置'}\n状态: ${
          syncConfig.endpoint ? (syncStatus.isConnected ? '已连接' : '未连接') : '未配置'
        }`
        syncStatusItem.command = {
          command: 'starcode-snippets.openSettings',
          title: '打开云端同步设置',
        }
        // 确保项目可见
        syncStatusItem.resourceUri = undefined
        syncStatusItem.description = undefined
        rootItems.push(syncStatusItem)
      }

      // 如果有搜索，显示搜索状态
      if (this._searchManager.isActive) {
        const statusItem = new SnippetTreeItem(
          `🔍 ${this._searchManager.getSearchStatusDescription()}`,
          vscode.TreeItemCollapsibleState.None
        )
        statusItem.contextValue = 'searchStatus'
        statusItem.iconPath = new vscode.ThemeIcon('info')
        rootItems.push(statusItem)
      }

      // 获取根级别的目录和代码片段
      const { childDirs: rootDirs, childSnippets: rootSnippets } = this.getChildrenForDirectory(undefined, '/')

      // 添加根级别的目录
      rootDirs
        .sort((a, b) => a.order - b.order)
        .forEach((dir) => {
          rootItems.push(new SnippetTreeItem(dir.name, vscode.TreeItemCollapsibleState.Expanded, undefined, dir))
        })

      // 添加根级别的代码片段
      rootSnippets
        .sort((a, b) => a.order - b.order)
        .forEach((snippet) => {
          const isSearchResult = this._searchManager.isActive
          const displayName = this._searchManager.generateHighlightedLabel(
            snippet.name,
            this._searchManager.searchQuery
          )

          const item = new SnippetTreeItem(
            displayName,
            vscode.TreeItemCollapsibleState.None,
            snippet,
            undefined,
            isSearchResult
          )

          rootItems.push(item)
        })

      return rootItems
    } else if (element.directory) {
      // 目录节点 - 显示该目录下的所有子目录和代码片段
      const directoryItems: SnippetTreeItem[] = []

      // 获取目录ID或路径
      let directoryId: string | undefined = undefined
      let directoryPath: string | undefined = undefined

      if (this._isV2Format) {
        // 在V2格式下，使用目录的fullPath作为路径
        directoryPath = (element.directory as DirectoryV2).fullPath
        console.log(`处理V2目录: ${(element.directory as DirectoryV2).name}, 路径=${directoryPath}`)
      } else {
        // 在V1格式下，使用目录的ID
        directoryId = (element.directory as Directory).id
      }

      // 获取该目录的子目录和代码片段
      const { childDirs, childSnippets } = this.getChildrenForDirectory(directoryId, directoryPath)

      // 添加子目录
      childDirs
        .sort((a, b) => a.order - b.order)
        .forEach((dir) => {
          directoryItems.push(new SnippetTreeItem(dir.name, vscode.TreeItemCollapsibleState.Expanded, undefined, dir))
        })

      // 添加目录下的代码片段
      childSnippets
        .sort((a, b) => a.order - b.order)
        .forEach((snippet) => {
          const isSearchResult = this._searchManager.isActive
          const displayName = this._searchManager.generateHighlightedLabel(
            snippet.name,
            this._searchManager.searchQuery
          )

          const item = new SnippetTreeItem(
            displayName,
            vscode.TreeItemCollapsibleState.None,
            snippet,
            undefined,
            isSearchResult
          )

          directoryItems.push(item)
        })

      return directoryItems
    }

    return []
  }
}
