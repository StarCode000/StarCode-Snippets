// src/explorer/dragAndDrop.ts
import * as vscode from 'vscode'
import { isDirectory, isCodeSnippet } from '../utils/typeUtils'

export class DragAndDropController implements vscode.TreeDragAndDropController<any> {
  private readonly _onDidChangeTreeData: vscode.EventEmitter<any | undefined>

  constructor(onDidChangeTreeData: vscode.EventEmitter<any | undefined>) {
    this._onDidChangeTreeData = onDidChangeTreeData
  }

  public dropMimeTypes = ['application/vnd.code.tree.copyCodeExplorer']
  public dragMimeTypes = ['application/vnd.code.tree.copyCodeExplorer']

  public async handleDrag(source: any[], dataTransfer: vscode.DataTransfer) {
    dataTransfer.set('application/vnd.code.tree.copyCodeExplorer', new vscode.DataTransferItem(source))
  }

  public async handleDrop(
    target: any,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    const transferItem = dataTransfer.get('application/vnd.code.tree.copyCodeExplorer')
    if (!transferItem) {
      return
    }

    const sources: any[] = transferItem.value
    // 处理拖拽逻辑
    if (isDirectory(target)) {
      // 将项目移动到目录中
      sources.forEach((source) => {
        if (isCodeSnippet(source)) {
          source.parentId = target.id
        }
      })
    }

    this._onDidChangeTreeData.fire(undefined)
  }
}
