import * as vscode from 'vscode'
import { CodeSnippet, Directory } from '../types/types'
import { ContextManager } from './contextManager'

export enum SearchMode {
  NAME = 'name',
  CONTENT = 'content',
}

export interface SearchResult {
  snippet: CodeSnippet
  matchType: 'name' | 'content'
  matchText: string
  highlightRanges: Array<{ start: number; end: number }>
}

export class SearchManager {
  private _searchQuery: string = ''
  private _searchMode: SearchMode = SearchMode.NAME
  private _isActive: boolean = false
  private _onDidChangeSearch = new vscode.EventEmitter<void>()

  public readonly onDidChangeSearch = this._onDidChangeSearch.event

  get searchQuery(): string {
    return this._searchQuery
  }

  get searchMode(): SearchMode {
    return this._searchMode
  }

  get isActive(): boolean {
    return this._isActive
  }

  /**
   * 开始搜索
   */
  async startSearch(): Promise<void> {
    const searchQuery = await vscode.window.showInputBox({
      prompt: `搜索代码片段 (当前模式: ${this._searchMode === SearchMode.NAME ? '名称搜索' : '内容搜索'})`,
      placeHolder: '输入搜索关键字...',
      value: this._searchQuery,
    })

    if (searchQuery !== undefined) {
      this._searchQuery = searchQuery.trim()
      this._isActive = this._searchQuery.length > 0

      // 更新上下文
      ContextManager.setActiveSearch(this._isActive)

      this._onDidChangeSearch.fire()

      if (this._isActive) {
        vscode.window.showInformationMessage(
          `搜索模式: ${this._searchMode === SearchMode.NAME ? '名称' : '内容'} | 关键字: "${this._searchQuery}"`
        )
      }
    }
  }

  /**
   * 清除搜索
   */
  clearSearch(): void {
    this._searchQuery = ''
    this._isActive = false

    // 更新上下文
    ContextManager.setActiveSearch(false)

    this._onDidChangeSearch.fire()
    vscode.window.showInformationMessage('已清除搜索')
  }

  /**
   * 切换搜索模式
   */
  async toggleSearchMode(): Promise<void> {
    // 创建模式选项，当前选中的模式放在最上面
    const allModes = [
      { label: '名称搜索', value: SearchMode.NAME, description: '在代码片段名称中搜索' },
      { label: '内容搜索', value: SearchMode.CONTENT, description: '在代码片段内容中搜索' },
    ]

    // 将当前模式移到最前面
    const currentModeIndex = allModes.findIndex((mode) => mode.value === this._searchMode)
    const modes = [...allModes]
    if (currentModeIndex > 0) {
      const currentMode = modes.splice(currentModeIndex, 1)[0]
      modes.unshift(currentMode)
    }

    // 为当前模式添加标识
    modes[0].label = `✓ ${modes[0].label} (当前)`

    const selected = await vscode.window.showQuickPick(modes, {
      placeHolder: '选择搜索模式',
      canPickMany: false,
    })

    if (selected) {
      this._searchMode = selected.value

      if (this._isActive) {
        // 如果有活跃搜索，重新触发搜索
        this._onDidChangeSearch.fire()
      }

      vscode.window.showInformationMessage(`已切换到${selected.label.replace('✓ ', '').replace(' (当前)', '')}模式`)
    }
  }

  /**
   * 搜索代码片段
   */
  searchSnippets(snippets: CodeSnippet[]): SearchResult[] {
    if (!this._isActive || !this._searchQuery) {
      return []
    }

    const results: SearchResult[] = []
    const query = this._searchQuery.toLowerCase()

    for (const snippet of snippets) {
      if (this._searchMode === SearchMode.NAME) {
        // 名称搜索
        const nameMatch = this.findMatches(snippet.name.toLowerCase(), query)
        if (nameMatch.length > 0) {
          results.push({
            snippet,
            matchType: 'name',
            matchText: snippet.name,
            highlightRanges: nameMatch,
          })
        }
      } else {
        // 内容搜索
        const contentMatch = this.findMatches(snippet.code.toLowerCase(), query)
        if (contentMatch.length > 0) {
          // 获取匹配的上下文
          const contextMatch = this.getMatchContext(snippet.code, contentMatch[0], query)
          results.push({
            snippet,
            matchType: 'content',
            matchText: contextMatch,
            highlightRanges: contentMatch,
          })
        }
      }
    }

    return results
  }

  /**
   * 过滤代码片段（用于树视图显示）
   */
  filterSnippets(snippets: CodeSnippet[]): CodeSnippet[] {
    if (!this._isActive) {
      return snippets
    }

    const searchResults = this.searchSnippets(snippets)
    return searchResults.map((result) => result.snippet)
  }

  /**
   * 过滤目录（只显示包含匹配代码片段的目录）
   */
  filterDirectories(directories: Directory[], filteredSnippets: CodeSnippet[]): Directory[] {
    if (!this._isActive) {
      return directories
    }

    const relevantDirectoryIds = new Set<string>()

    // 收集所有相关的目录ID
    for (const snippet of filteredSnippets) {
      let parentId = snippet.parentId
      while (parentId) {
        relevantDirectoryIds.add(parentId)
        const parentDir = directories.find((d) => d.id === parentId)
        parentId = parentDir?.parentId || null
      }
    }

    return directories.filter((dir) => relevantDirectoryIds.has(dir.id))
  }

  /**
   * 查找所有匹配位置
   */
  private findMatches(text: string, query: string): Array<{ start: number; end: number }> {
    const matches: Array<{ start: number; end: number }> = []
    let index = 0

    while (index < text.length) {
      const matchIndex = text.indexOf(query, index)
      if (matchIndex === -1) {
        break
      }

      matches.push({
        start: matchIndex,
        end: matchIndex + query.length,
      })

      index = matchIndex + 1 // 允许重叠匹配
    }

    return matches
  }

  /**
   * 获取匹配的上下文
   */
  private getMatchContext(text: string, match: { start: number; end: number }, query: string): string {
    const contextLength = 50
    const start = Math.max(0, match.start - contextLength)
    const end = Math.min(text.length, match.end + contextLength)

    let context = text.substring(start, end)

    // 添加省略号
    if (start > 0) {
      context = '...' + context
    }
    if (end < text.length) {
      context = context + '...'
    }

    return context
  }

  /**
   * 生成高亮的标签文本
   */
  generateHighlightedLabel(text: string, query: string): string {
    if (!this._isActive || !query) {
      return text
    }

    const matches = this.findMatches(text.toLowerCase(), query.toLowerCase())
    if (matches.length === 0) {
      return text
    }

    // 为了简化，我们在名称前添加搜索图标
    return `🔍 ${text}`
  }

  /**
   * 获取搜索状态描述
   */
  getSearchStatusDescription(): string {
    if (!this._isActive) {
      return ''
    }

    const modeText = this._searchMode === SearchMode.NAME ? '名称' : '内容'
    return `搜索: "${this._searchQuery}" (${modeText}模式)`
  }
}
