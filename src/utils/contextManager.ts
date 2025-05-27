import * as vscode from 'vscode'

/**
 * 上下文管理器 - 管理应用程序的全局状态
 */
export class ContextManager {
  private static _isEditingSnippet: boolean = false
  private static _hasActiveSearch: boolean = false

  /**
   * 设置是否正在编辑代码片段
   */
  public static async setEditingSnippet(isEditing: boolean): Promise<void> {
    this._isEditingSnippet = isEditing
    await vscode.commands.executeCommand('setContext', 'starcode-snippets.isEditingSnippet', isEditing)
  }

  /**
   * 获取是否正在编辑代码片段
   */
  public static isEditingSnippet(): boolean {
    return this._isEditingSnippet
  }

  /**
   * 设置是否有活跃的搜索
   */
  public static async setActiveSearch(hasSearch: boolean): Promise<void> {
    this._hasActiveSearch = hasSearch
    await vscode.commands.executeCommand('setContext', 'starcode-snippets.hasActiveSearch', hasSearch)
  }

  /**
   * 获取是否有活跃的搜索
   */
  public static hasActiveSearch(): boolean {
    return this._hasActiveSearch
  }

  /**
   * 重置所有状态
   */
  public static async resetAll(): Promise<void> {
    await this.setEditingSnippet(false)
    await this.setActiveSearch(false)
  }
}
