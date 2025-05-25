import * as vscode from 'vscode'
import { StorageManager } from '../storage/storageManager'
import { CodeSnippet, Directory } from '../models/types'
import { SearchManager } from '../utils/searchManager'
import { SettingsManager } from '../utils/settingsManager'

export class SnippetTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly snippet?: CodeSnippet,
    public readonly directory?: Directory,
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

  private _snippets: CodeSnippet[] = []
  private _directories: Directory[] = []
  private _initialized: boolean = false
  private _searchManager: SearchManager
  private _statusUpdateTimer: NodeJS.Timeout | undefined

  constructor(private storageManager: StorageManager, searchManager: SearchManager) {
    this._searchManager = searchManager

    // 监听搜索变化
    this._searchManager.onDidChangeSearch(() => {
      this.refresh()
    })

    // 启动状态更新定时器（每0.5秒更新一次）
    this._startStatusUpdateTimer()

    // 立即加载数据
    this._loadData()
      .then(() => {
        console.log('TreeDataProvider 初始化完成')
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

    // 每0.5秒更新一次状态显示
    this._statusUpdateTimer = setInterval(() => {
      // 只刷新根节点的状态显示，不重新加载数据
      this._onDidChangeTreeData.fire()
    }, 500)
  }

  /**
   * 停止状态更新定时器
   */
  private _stopStatusUpdateTimer(): void {
    if (this._statusUpdateTimer) {
      clearInterval(this._statusUpdateTimer)
      this._statusUpdateTimer = undefined
    }
  }

  /**
   * 销毁资源
   */
  dispose(): void {
    this._stopStatusUpdateTimer()
  }

  refresh(): void {
    this._loadData().then(() => {
      this._onDidChangeTreeData.fire()
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
      // 并行加载数据
      const [directories, snippets] = await Promise.all([
        this.storageManager.getAllDirectories(),
        this.storageManager.getAllSnippets(),
      ])

      this._directories = directories
      this._snippets = snippets

      console.log(`加载了 ${this._directories.length} 个目录和 ${this._snippets.length} 个代码片段`)
    } catch (error) {
      console.error('加载数据失败:', error)
      vscode.window.showErrorMessage(`加载代码片段失败: ${error}`)
    }
  }

  getTreeItem(element: SnippetTreeItem): vscode.TreeItem {
    return element
  }

  async getChildren(element?: SnippetTreeItem): Promise<SnippetTreeItem[]> {
    
    // 如果数据还没加载完成，先等待数据加载
    if (!this._initialized) {
      try {
        await this._loadData()
        this._initialized = true
      } catch (error) {
        console.error('数据加载失败:', error);
        this._initialized = true; // 即使失败也标记为已初始化
      }
    }

    // 应用搜索过滤
    const filteredSnippets = this._searchManager.filterSnippets(this._snippets)
    const filteredDirectories = this._searchManager.filterDirectories(this._directories, filteredSnippets)

    if (!element) {
      // 根节点 - 显示所有顶级目录和代码片段
      const rootItems: SnippetTreeItem[] = []

      // 显示云端同步状态
      let syncStatus: any = { isConnected: false, lastSyncTime: null, lastError: null, isSyncing: false };
      let syncConfig: any = { endpoint: '', autoSync: false };
      
      try {
        syncStatus = SettingsManager.getCloudSyncStatus()
        syncConfig = SettingsManager.getCloudSyncConfig()
      } catch (error) {
        console.error('获取同步配置失败:', error);
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
        
        const syncStatusItem = new SnippetTreeItem(
          statusText,
          vscode.TreeItemCollapsibleState.None
        )
        syncStatusItem.contextValue = 'syncStatus'
        syncStatusItem.iconPath = new vscode.ThemeIcon(statusIcon)
        syncStatusItem.tooltip = `点击打开云端同步设置\n\n配置: ${syncConfig.endpoint || '未配置'}\n状态: ${syncConfig.endpoint ? (syncStatus.isConnected ? '已连接' : '未连接') : '未配置'}`
        syncStatusItem.command = {
          command: 'starcode-snippets.openSettings',
          title: '打开云端同步设置'
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

      // 添加根级别的目录（只显示包含匹配代码片段的目录）
      const rootDirs = filteredDirectories.filter((dir) => dir.parentId === null)
      rootDirs
        .sort((a, b) => a.order - b.order)
        .forEach((dir) => {
          rootItems.push(new SnippetTreeItem(dir.name, vscode.TreeItemCollapsibleState.Expanded, undefined, dir))
        })

      // 添加根级别的代码片段
      const rootSnippets = filteredSnippets.filter((s) => s.parentId === null)
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

      // 添加子目录（只显示包含匹配代码片段的子目录）
      const childDirs = filteredDirectories.filter((dir) => dir.parentId === element.directory?.id)
      childDirs
        .sort((a, b) => a.order - b.order)
        .forEach((dir) => {
          directoryItems.push(new SnippetTreeItem(dir.name, vscode.TreeItemCollapsibleState.Expanded, undefined, dir))
        })

      // 添加目录下的代码片段
      const dirSnippets = filteredSnippets.filter((s) => s.parentId === element.directory?.id)
      dirSnippets
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
