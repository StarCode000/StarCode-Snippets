// src/explorer/treeDataProvider.ts
import * as vscode from 'vscode'
import { CodeSnippet, Directory } from '../models/types'
import { StorageManager } from '../storage/storageManager'
import { DragAndDropController } from './dragAndDrop'

export class CopyCodeTreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined> = new vscode.EventEmitter<
    TreeItem | undefined
  >()
  readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined> = this._onDidChangeTreeData.event

  private dragAndDropController: DragAndDropController

  constructor(private storageManager: StorageManager) {
    this.dragAndDropController = new DragAndDropController(this._onDidChangeTreeData)
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined)
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (!element) {
      // 根级别：显示目录和未分类的代码片段
      const [directories, snippets] = await Promise.all([
        this.storageManager.getAllDirectories(),
        this.storageManager.getAllSnippets()
      ])

      const items: TreeItem[] = []

      // 添加目录
      directories
        .filter(dir => dir.parentId === null)
        .sort((a, b) => a.order - b.order)
        .forEach(dir => {
          items.push(new TreeItem(
            dir.name,
            vscode.TreeItemCollapsibleState.Expanded,
            undefined,
            dir
          ))
        })

      // 添加根级别的代码片段
      snippets
        .filter(snippet => snippet.parentId === null)
        .sort((a, b) => a.order - b.order)
        .forEach(snippet => {
          items.push(new TreeItem(
            snippet.name,
            vscode.TreeItemCollapsibleState.None,
            snippet
          ))
        })

      return items
    } else if (element.directory) {
      // 目录内容：显示该目录下的代码片段
      const snippets = await this.storageManager.getAllSnippets()
      return snippets
        .filter(snippet => snippet.parentId === element.directory!.id)
        .sort((a, b) => a.order - b.order)
        .map(snippet => new TreeItem(
          snippet.name,
          vscode.TreeItemCollapsibleState.None,
          snippet
        ))
    }

    return []
  }

  public getDragAndDropController(): vscode.TreeDragAndDropController<any> {
    return this.dragAndDropController
  }
}

export class TreeItem extends vscode.TreeItem {
  children: TreeItem[] = []
  contextValue: string

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly snippet?: CodeSnippet,
    public readonly directory?: Directory
  ) {
    super(label, collapsibleState)

    // 设置上下文值用于控制右键菜单
    this.contextValue = directory ? 'directory' : 'snippet'

    if (snippet) {
      this.tooltip = `${snippet.fileName}\n${snippet.filePath}`
      this.command = {
        command: 'copy-code.previewSnippet',
        title: 'Preview Snippet',
        arguments: [snippet],
      }
      // 设置代码片段图标
      this.iconPath = new vscode.ThemeIcon('symbol-variable')
    } else if (directory) {
      this.tooltip = directory.name
      // 设置目录图标
      this.iconPath = new vscode.ThemeIcon('folder')
    }
  }
}
