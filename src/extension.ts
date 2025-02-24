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

  // 插入代码片段的通用函数
  async function insertSnippet(snippet: CodeSnippet) {
    const editor = vscode.window.activeTextEditor
    if (editor) {
      const position = editor.selection.active
      await editor.edit((editBuilder) => {
        editBuilder.insert(position, snippet.code)
      })
      // 强制将焦点设置回编辑器
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
      return true
    }
    return false
  }

  // 注册视图
  const treeView = vscode.window.createTreeView('copyCodeExplorer', {
    treeDataProvider,
    dragAndDropController: treeDataProvider.getDragAndDropController(),
    canSelectMany: false,
    showCollapseAll: true,
    manageCheckboxStateManually: true,
  })

  // 注册保存代码片段命令
  let saveToLibrary = vscode.commands.registerCommand('starcode-snippets.saveToLibrary', async () => {
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
        placeHolder: '输入代码片段名称',
      })

      if (name) {
        // 获取所有目录供选择
        const directories = await storageManager.getAllDirectories()
        const directoryItems = [
          { label: '根目录', id: null },
          ...directories.map((dir) => ({ label: dir.name, id: dir.id })),
        ]

        const selectedDirectory = await vscode.window.showQuickPick(directoryItems, {
          placeHolder: '选择保存位置',
        })

        if (selectedDirectory) {
          const snippet: CodeSnippet = {
            id: uuidv4(),
            name,
            code,
            fileName,
            filePath,
            category: selectedDirectory.label,
            parentId: selectedDirectory.id,
            order: 0,
            createTime: Date.now(),
          }

          await storageManager.saveSnippet(snippet)
          treeDataProvider.refresh()
        }
      }
    }
  })

  // 注册预览代码片段命令
  let previewSnippet = vscode.commands.registerCommand('starcode-snippets.previewSnippet', async (snippet: CodeSnippet) => {
    if (!snippet) return

    const document = await vscode.workspace.openTextDocument({
      content: snippet.code,
      language: snippet.fileName.split('.').pop() || 'plaintext',
    })
    await vscode.window.showTextDocument(document, { preview: true })
  })

  // 重命名命令
  let renameItem = vscode.commands.registerCommand('starcode-snippets.rename', async (item: TreeItem) => {
    if (!item) return

    const newName = await vscode.window.showInputBox({
      prompt: '重命名...',
      value: item.label,
    })

    if (newName) {
      if (item.snippet) {
        const updatedSnippet = { ...item.snippet, name: newName }
        await storageManager.updateSnippet(updatedSnippet)
      } else if (item.directory) {
        const updatedDirectory = { ...item.directory, name: newName }
        await storageManager.updateDirectory(updatedDirectory)
      }
      treeDataProvider.refresh()
    }
  })

  // 创建目录命令
  let createDirectory = vscode.commands.registerCommand('starcode-snippets.createDirectory', async () => {
    const name = await vscode.window.showInputBox({
      prompt: '输入目录名',
      placeHolder: '新建目录',
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

  // 在指定目录中创建代码片段命令
  let createSnippetInDirectory = vscode.commands.registerCommand('starcode-snippets.createSnippetInDirectory', async (item: TreeItem) => {
    if (!item?.directory) return

    const name = await vscode.window.showInputBox({
      prompt: '输入代码片段名称',
      placeHolder: '新建代码片段',
    })

    if (name) {
      const snippet: CodeSnippet = {
        id: uuidv4(),
        name,
        code: '', // 初始为空代码
        fileName: 'snippet.txt',
        filePath: '',
        category: item.directory.name,
        parentId: item.directory.id,
        order: 0,
        createTime: Date.now(),
      }

      await storageManager.saveSnippet(snippet)
      treeDataProvider.refresh()

      // 打开编辑器编辑代码片段
      const updatedSnippet = await SnippetEditor.edit(snippet)
      if (updatedSnippet) {
        await storageManager.updateSnippet(updatedSnippet)
        treeDataProvider.refresh()
      }
    }
  })

  // 删除命令
  let deleteItem = vscode.commands.registerCommand('starcode-snippets.delete', async (item: TreeItem) => {
    if (!item) return

    const confirmMessage = item.snippet
      ? `确定要删除代码片段 "${item.label}" 吗？`
      : `确定要删除目录 "${item.label}" 及其所有内容吗？`

    const confirm = await vscode.window.showWarningMessage(confirmMessage, { modal: true }, '确定')

    if (confirm === '确定') {
      if (item.snippet) {
        await storageManager.deleteSnippet(item.snippet.id)
      } else if (item.directory) {
        await storageManager.deleteDirectory(item.directory.id)
      }
      treeDataProvider.refresh()
    }
  })

  // 追加粘贴命令
  let appendCode = vscode.commands.registerCommand('starcode-snippets.appendCode', async (item: TreeItem) => {
    if (!item?.snippet) return

    const editor = vscode.window.activeTextEditor
    if (editor) {
      const position = editor.selection.active
      await editor.edit((editBuilder) => {
        editBuilder.insert(position, item.snippet!.code)
      })
    }
  })

  // 编辑代码命令
  let editSnippet = vscode.commands.registerCommand('starcode-snippets.editSnippet', async (item: TreeItem) => {
    if (!item?.snippet) return

    const updatedSnippet = await SnippetEditor.edit(item.snippet)
    if (updatedSnippet) {
      await storageManager.updateSnippet(updatedSnippet)
      treeDataProvider.refresh()
    }
  })

  // 移动到目录命令
  let moveToDirectory = vscode.commands.registerCommand('starcode-snippets.moveToDirectory', async (item: TreeItem) => {
    if (!item?.snippet) return

    const directories = await storageManager.getAllDirectories()
    const directoryItems = [
      { label: '根目录', id: null },
      ...directories.map((dir) => ({ label: dir.name, id: dir.id })),
    ]

    const selectedDirectory = await vscode.window.showQuickPick(directoryItems, {
      placeHolder: '选择目标目录',
    })

    if (selectedDirectory) {
      const updatedSnippet = {
        ...item.snippet,
        parentId: selectedDirectory.id,
        category: selectedDirectory.label,
      }
      await storageManager.updateSnippet(updatedSnippet)
      treeDataProvider.refresh()
    }
  })

  // 注册插入代码片段命令
  let insertSnippetCommand = vscode.commands.registerCommand('starcode-snippets.insertSnippet', async (snippet: CodeSnippet) => {
    await insertSnippet(snippet)
  })

  // 注册所有命令
  context.subscriptions.push(
    saveToLibrary,
    previewSnippet,
    renameItem,
    createDirectory,
    deleteItem,
    appendCode,
    editSnippet,
    moveToDirectory,
    insertSnippetCommand,
    createSnippetInDirectory,
    treeView
  )
}

export function deactivate() {}
