// src/extension.ts
import * as vscode from 'vscode'
import { StorageManager } from './storage/storageManager'
import { CopyCodeTreeDataProvider, TreeItem } from './explorer/treeDataProvider'
import { v4 as uuidv4 } from 'uuid'
import { CodeSnippet, Directory } from './models/types'
import { SnippetEditor } from './editor/snippetEditor'

export function activate(context: vscode.ExtensionContext) {
  const storageManager = new StorageManager(context)
  const treeDataProvider = new CopyCodeTreeDataProvider(storageManager)

  // 注册视图
  vscode.window.registerTreeDataProvider('copyCodeExplorer', treeDataProvider)

  // 注册保存代码片段命令
  let saveToLibrary = vscode.commands.registerCommand('copy-code.saveToLibrary', async () => {
    const editor = vscode.window.activeTextEditor
    if (editor) {
      const selection = editor.selection
      const code = editor.document.getText(selection)

      // 获取文件信息
      const fileName = editor.document.fileName.split('/').pop() || ''
      const filePath = editor.document.fileName

      // 提示用户输入名称
      const name = await vscode.window.showInputBox({
        prompt: '为代码片段命名',
      })

      if (name) {
        const snippet: CodeSnippet = {
          id: uuidv4(),
          name,
          code,
          fileName,
          filePath,
          category: 'Default',
          parentId: null,
          order: 0,
          createTime: Date.now(),
        }

        await storageManager.saveSnippet(snippet)
        treeDataProvider.refresh()
      }
    }
  })

  // 注册预览代码片段命令
  let previewSnippet = vscode.commands.registerCommand('copy-code.previewSnippet', async (snippet: CodeSnippet) => {
    const document = await vscode.workspace.openTextDocument({
      content: snippet.code,
      language: 'typescript', // 可以根据文件扩展名决定语言
    })
    await vscode.window.showTextDocument(document)
  })

  // 重命名命令
  let renameItem = vscode.commands.registerCommand('copy-code.rename', async (item: TreeItem) => {
    const newName = await vscode.window.showInputBox({
      prompt: '重命名...',
      value: item.label,
    })

    if (newName && item.snippet) {
      const updatedSnippet = { ...item.snippet, name: newName }
      await storageManager.updateSnippet(updatedSnippet)
      treeDataProvider.refresh()
    }
  })

  // 创建目录命令
  let createDirectory = vscode.commands.registerCommand('copy-code.createDirectory', async () => {
    const name = await vscode.window.showInputBox({
      prompt: '输入目录名',
    })

    if (name) {
      const directory: Directory = {
        id: uuidv4(),
        name,
        parentId: null,
        order: 0,
      }
      await storageManager.createDirectory(directory)
      treeDataProvider.refresh()
    }
  })

  // 追加粘贴命令
  let appendCode = vscode.commands.registerCommand('copy-code.appendCode', async (item: TreeItem) => {
    if (item.snippet) {
      const editor = vscode.window.activeTextEditor
      if (editor) {
        const position = editor.selection.active
        await editor.edit((editBuilder) => {
          editBuilder.insert(position, item.snippet!.code)
        })
      }
    }
  })

  // 编辑代码命令
  let editSnippet = vscode.commands.registerCommand('copy-code.editSnippet', async (item: TreeItem) => {
    if (item.snippet) {
      const updatedSnippet = await SnippetEditor.edit(item.snippet)
      if (updatedSnippet) {
        await storageManager.updateSnippet(updatedSnippet)
        treeDataProvider.refresh()
      }
    }
  })

  context.subscriptions.push(renameItem, createDirectory, appendCode, editSnippet)

  context.subscriptions.push(saveToLibrary, previewSnippet)
}

export function deactivate() {}
