// src/extension.ts
import * as vscode from 'vscode'
import { StorageManager } from './storage/storageManager'
import { SnippetWebviewProvider } from './explorer/webviewProvider'
import { v4 as uuidv4 } from 'uuid'
import { CodeSnippet, Directory } from './models/types'
import { SnippetEditor } from './editor/snippetEditor'

export function activate(context: vscode.ExtensionContext) {
  // 初始化SnippetEditor
  SnippetEditor.initialize(context)

  const storageManager = new StorageManager(context)
  const webviewProvider = new SnippetWebviewProvider(context.extensionUri, storageManager)

  // 注册webview
  const webviewView = vscode.window.registerWebviewViewProvider(
    'copyCodeExplorer',
    webviewProvider
  )

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

  // 检查同一目录下是否有重名代码片段
  async function checkDuplicateSnippetName(name: string, parentId: string | null): Promise<boolean> {
    const snippets = await storageManager.getAllSnippets()
    return snippets.some(s => s.name === name && s.parentId === parentId)
  }

  // 检查同一级别是否有重名目录
  async function checkDuplicateDirectoryName(name: string, parentId: string | null): Promise<boolean> {
    const directories = await storageManager.getAllDirectories()
    return directories.some(d => d.name === name && d.parentId === parentId)
  }

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
          // 检查是否有重名代码片段
          const isDuplicate = await checkDuplicateSnippetName(name, selectedDirectory.id)
          if (isDuplicate) {
            vscode.window.showErrorMessage(`所选目录中已存在名为 "${name}" 的代码片段`)
            return
          }
          // 根据文件扩展名或内容自动检测语言
          let language = 'plaintext'

          // 从文件扩展名检测语言
          const fileExt = fileName.split('.').pop()?.toLowerCase()
          if (fileExt) {
            switch (fileExt) {
              case 'ts':
                language = 'typescript'
                break
              case 'js':
                language = 'javascript'
                break
              case 'html':
                language = 'html'
                break
              case 'css':
                language = 'css'
                break
              case 'json':
                language = 'json'
                break
              case 'vue':
                language = 'vue'
                break
              case 'py':
                language = 'python'
                break
              case 'java':
                language = 'java'
                break
              case 'cs':
                language = 'csharp'
                break
              case 'cpp':
              case 'c':
              case 'h':
                language = 'cpp'
                break
              case 'go':
                language = 'go'
                break
              case 'php':
                language = 'php'
                break
              case 'rb':
                language = 'ruby'
                break
              case 'rs':
                language = 'rust'
                break
              case 'sql':
                language = 'sql'
                break
              case 'md':
                language = 'markdown'
                break
              case 'yml':
              case 'yaml':
                language = 'yaml'
                break
              case 'sh':
              case 'bash':
                language = 'shell'
                break
            }
          }

          // 如果没有从文件扩展名检测到语言，尝试从内容检测
          if (language === 'plaintext') {
            // 检测Vue文件
            if (code.includes('<template>') && (code.includes('<script>') || code.includes('<script setup'))) {
              language = 'vue'
            }
            // 检测HTML文件
            else if (code.includes('<!DOCTYPE html>') || (code.includes('<html') && code.includes('<body'))) {
              language = 'html'
            }
            // 检测JavaScript/TypeScript文件
            else if (
              code.includes('function') ||
              code.includes('const ') ||
              code.includes('let ') ||
              code.includes('class ')
            ) {
              if (
                code.includes(': string') ||
                code.includes(': number') ||
                code.includes(': boolean') ||
                code.includes('interface ')
              ) {
                language = 'typescript'
              } else {
                language = 'javascript'
              }
            }
          }

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
            language: language,
          }

          await storageManager.saveSnippet(snippet)
          webviewProvider.refresh()
        }
      }
    }
  })

  // 注册预览代码片段命令
  let previewSnippet = vscode.commands.registerCommand(
    'starcode-snippets.previewSnippet',
    async (snippet: CodeSnippet) => {
      if (!snippet) {return}

      // 创建并显示webview
      const panel = vscode.window.createWebviewPanel(
        'snippetPreview', // 标识符
        `预览: ${snippet.name}`, // 标题
        vscode.ViewColumn.Beside, // 在旁边打开
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [context.extensionUri]
        }
      );

      // 获取代码语言
      const language = snippet.language || snippet.fileName.split('.').pop() || 'plaintext';
      
      // 生成HTML内容
      panel.webview.html = getPreviewHtml(snippet.code, language, snippet.name);

      // 生成预览HTML
      function getPreviewHtml(code: string, language: string, snippetName: string): string {
        // 转义HTML特殊字符
        const escapedCode = code
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');

        // 获取本地资源的URI
        const highlightJsUri = panel.webview.asWebviewUri(
          vscode.Uri.joinPath(context.extensionUri, 'media', 'highlight', 'highlight.min.js')
        );
        const cssUri = panel.webview.asWebviewUri(
          vscode.Uri.joinPath(context.extensionUri, 'media', 'highlight', 'vs2015.min.css')
        );

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>代码片段预览</title>
            <link rel="stylesheet" href="${cssUri}">
            <script src="${highlightJsUri}"></script>
            <style>
                body {
                    padding: 16px;
                    color: var(--vscode-foreground);
                    font-family: var(--vscode-editor-font-family);
                    font-size: var(--vscode-editor-font-size);
                    background-color: var(--vscode-editor-background);
                }
                .header {
                    margin-bottom: 16px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                .title {
                    font-size: 1.2em;
                    font-weight: bold;
                    margin: 0;
                    padding: 0;
                }
                .language-badge {
                    display: inline-block;
                    background-color: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    border-radius: 4px;
                    padding: 2px 6px;
                    font-size: 0.8em;
                    margin-left: 8px;
                }
                pre {
                    margin: 0;
                    padding: 16px;
                    border-radius: 4px;
                    overflow: auto;
                    background-color: var(--vscode-editor-background);
                }
                code {
                    font-family: var(--vscode-editor-font-family), 'Courier New', monospace;
                    tab-size: 4;
                }
                .hljs {
                    background-color: var(--vscode-editor-background) !important;
                }
                /* 添加基本的语法高亮样式，以防highlight.js无法加载 */
                .token.keyword { color: #569CD6; }
                .token.string { color: #CE9178; }
                .token.comment { color: #6A9955; }
                .token.function { color: #DCDCAA; }
                .token.number { color: #B5CEA8; }
                .token.operator { color: #D4D4D4; }
                .token.class-name { color: #4EC9B0; }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="title">
                    ${snippetName}
                    <span class="language-badge">${language}</span>
                </div>
            </div>
            <pre><code class="language-${getHighlightJsLanguage(language)}">${escapedCode}</code></pre>
            <script>
                // 添加简单的降级方案，以防highlight.js无法正常工作
                function simpleHighlight(code, language) {
                    if (typeof hljs !== 'undefined') {
                        try {
                            hljs.highlightAll();
                            return;
                        } catch (e) {
                            console.error('Highlight.js error:', e);
                        }
                    }
                    
                    // 简单的语法高亮降级方案
                    const codeElement = document.querySelector('code');
                    if (!codeElement) return;
                    
                    // 简单的关键字高亮
                    const keywords = ['function', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'return', 'class', 'import', 'export', 'from'];
                    let html = codeElement.innerHTML;
                    
                    // 高亮关键字
                    keywords.forEach(keyword => {
                        const regex = new RegExp('\\b' + keyword + '\\b', 'g');
                        html = html.replace(regex, '<span class="token keyword">' + keyword + '</span>');
                    });
                    
                    codeElement.innerHTML = html;
                }
                
                document.addEventListener('DOMContentLoaded', () => {
                    simpleHighlight(document.querySelector('code').textContent, '${language}');
                });
                
                // 立即尝试高亮
                simpleHighlight(document.querySelector('code').textContent, '${language}');
            </script>
        </body>
        </html>`;
      }
    }
  )

  // 将VSCode语言ID转换为highlight.js支持的语言ID
  function getHighlightJsLanguage(language: string): string {
    const languageMap: {[key: string]: string} = {
      'typescript': 'typescript',
      'javascript': 'javascript',
      'html': 'html',
      'css': 'css',
      'json': 'json',
      'vue': 'xml', // highlight.js没有专门的vue支持，使用xml
      'python': 'python',
      'java': 'java',
      'csharp': 'csharp',
      'cpp': 'cpp',
      'go': 'go',
      'php': 'php',
      'ruby': 'ruby',
      'rust': 'rust',
      'sql': 'sql',
      'markdown': 'markdown',
      'yaml': 'yaml',
      'shell': 'bash',
      'plaintext': 'plaintext'
    };

    return languageMap[language] || 'plaintext';
  }

  // 重命名命令
  let renameItem = vscode.commands.registerCommand('starcode-snippets.rename', async (item: any) => {
    if (!item) {return}

    const newName = await vscode.window.showInputBox({
      prompt: '重命名...',
      value: item.label,
    })

    if (newName) {
      if (item.snippet) {
        // 检查是否有重名代码片段
        const isDuplicate = await checkDuplicateSnippetName(newName, item.snippet.parentId)
        if (isDuplicate) {
          vscode.window.showErrorMessage(`所选目录中已存在名为 "${newName}" 的代码片段`)
          return
        }
        const updatedSnippet = { ...item.snippet, name: newName }
        await storageManager.updateSnippet(updatedSnippet)
      } else if (item.directory) {
        // 检查是否有重名目录
        const isDuplicate = await checkDuplicateDirectoryName(newName, item.directory.parentId)
        if (isDuplicate) {
          vscode.window.showErrorMessage(`当前层级已存在名为 "${newName}" 的目录`)
          return
        }
        const updatedDirectory = { ...item.directory, name: newName }
        await storageManager.updateDirectory(updatedDirectory)
      }
      webviewProvider.refresh()
    }
  })

  // 创建目录命令
  let createDirectory = vscode.commands.registerCommand('starcode-snippets.createDirectory', async () => {
    const name = await vscode.window.showInputBox({
      prompt: '输入目录名',
      placeHolder: '新建目录',
    })

    if (name) {
      // 检查是否有重名目录
      const isDuplicate = await checkDuplicateDirectoryName(name, null)
      if (isDuplicate) {
        vscode.window.showErrorMessage(`根目录下已存在名为 "${name}" 的目录`)
        return
      }

      const directory: Directory = {
        id: uuidv4(),
        name,
        parentId: null,
        order: 0,
      }
      await storageManager.createDirectory(directory)
      webviewProvider.refresh()
    }
  })

  // 在指定目录中创建代码片段命令
  let createSnippetInDirectory = vscode.commands.registerCommand(
    'starcode-snippets.createSnippetInDirectory',
    async (item: any) => {
      if (!item?.directory) {return}

      const name = await vscode.window.showInputBox({
        prompt: '输入代码片段名称',
        placeHolder: '新建代码片段',
      })

      if (name) {
        // 检查是否有重名代码片段
        const isDuplicate = await checkDuplicateSnippetName(name, item.directory.id)
        if (isDuplicate) {
          vscode.window.showErrorMessage(`目录 "${item.directory.name}" 中已存在名为 "${name}" 的代码片段`)
          return
        }

        // 让用户选择语言
        const languageOptions = [
          { label: '纯文本', value: 'plaintext' },
          { label: 'TypeScript', value: 'typescript' },
          { label: 'JavaScript', value: 'javascript' },
          { label: 'HTML', value: 'html' },
          { label: 'CSS', value: 'css' },
          { label: 'JSON', value: 'json' },
          { label: 'Vue', value: 'vue' },
          { label: 'Python', value: 'python' },
          { label: 'Java', value: 'java' },
          { label: 'C#', value: 'csharp' },
          { label: 'C++', value: 'cpp' },
          { label: 'Go', value: 'go' },
          { label: 'PHP', value: 'php' },
          { label: 'Ruby', value: 'ruby' },
          { label: 'Rust', value: 'rust' },
          { label: 'SQL', value: 'sql' },
          { label: 'Markdown', value: 'markdown' },
          { label: 'YAML', value: 'yaml' },
          { label: 'Shell', value: 'shell' },
        ]

        const selectedLanguage = await vscode.window.showQuickPick(languageOptions, {
          placeHolder: '选择代码语言',
        })

        if (!selectedLanguage) {return} // 用户取消了选择

        // 根据选择的语言设置文件名
        let fileName = 'snippet'
        switch (selectedLanguage.value) {
          case 'typescript':
            fileName += '.ts'
            break
          case 'javascript':
            fileName += '.js'
            break
          case 'html':
            fileName += '.html'
            break
          case 'css':
            fileName += '.css'
            break
          case 'json':
            fileName += '.json'
            break
          case 'vue':
            fileName += '.vue'
            break
          case 'python':
            fileName += '.py'
            break
          case 'java':
            fileName += '.java'
            break
          case 'csharp':
            fileName += '.cs'
            break
          case 'cpp':
            fileName += '.cpp'
            break
          case 'go':
            fileName += '.go'
            break
          case 'php':
            fileName += '.php'
            break
          case 'ruby':
            fileName += '.rb'
            break
          case 'rust':
            fileName += '.rs'
            break
          case 'sql':
            fileName += '.sql'
            break
          case 'markdown':
            fileName += '.md'
            break
          case 'yaml':
            fileName += '.yml'
            break
          case 'shell':
            fileName += '.sh'
            break
          default:
            fileName += '.txt'
        }

        const snippet: CodeSnippet = {
          id: uuidv4(),
          name,
          code: '',
          fileName: fileName,
          filePath: '',
          category: item.directory.name,
          parentId: item.directory.id,
          order: 0,
          createTime: Date.now(),
          language: selectedLanguage.value,
        }

        await storageManager.saveSnippet(snippet)
        webviewProvider.refresh()

        // 打开编辑器编辑代码片段
        const updatedSnippet = await SnippetEditor.edit(snippet)
        if (updatedSnippet) {
          await storageManager.updateSnippet(updatedSnippet)
          webviewProvider.refresh()
        }
      }
    }
  )

  // 删除命令
  let deleteItem = vscode.commands.registerCommand('starcode-snippets.delete', async (item: any) => {
    if (!item) {return}

    const confirmMessage = item.snippet
      ? `确定要删除代码片段 "${item.snippet.name}" 吗？`
      : `确定要删除目录 "${item.directory.name}" 及其所有内容吗？`

    const confirm = await vscode.window.showWarningMessage(confirmMessage, { modal: true }, '确定')

    if (confirm === '确定') {
      if (item.snippet) {
        await storageManager.deleteSnippet(item.snippet.id)
      } else if (item.directory) {
        await storageManager.deleteDirectory(item.directory.id)
      }
      webviewProvider.refresh()
    }
  })

  // 追加粘贴命令
  let appendCode = vscode.commands.registerCommand('starcode-snippets.appendCode', async (item: any) => {
    if (!item?.snippet) {return}

    const editor = vscode.window.activeTextEditor
    if (editor) {
      const position = editor.selection.active
      await editor.edit((editBuilder) => {
        editBuilder.insert(position, item.snippet.code)
      })
    }
  })

  // 编辑代码命令
  let editSnippet = vscode.commands.registerCommand('starcode-snippets.editSnippet', async (item: any) => {
    if (!item?.snippet) {return}

    const updatedSnippet = await SnippetEditor.edit(item.snippet)
    if (updatedSnippet) {
      await storageManager.updateSnippet(updatedSnippet)
      webviewProvider.refresh()
    }
  })

  // 移动到目录命令
  let moveToDirectory = vscode.commands.registerCommand('starcode-snippets.moveToDirectory', async (item: any) => {
    if (!item?.snippet) {return}

    const directories = await storageManager.getAllDirectories()
    const directoryItems = [
      { label: '根目录', id: null },
      ...directories.map((dir) => ({ label: dir.name, id: dir.id })),
    ]

    const selectedDirectory = await vscode.window.showQuickPick(directoryItems, {
      placeHolder: '选择目标目录',
    })

    if (selectedDirectory) {
      // 检查目标目录中是否已有同名代码片段
      const isDuplicate = await checkDuplicateSnippetName(item.snippet.name, selectedDirectory.id)
      if (isDuplicate) {
        vscode.window.showErrorMessage(`目标目录中已存在名为 "${item.snippet.name}" 的代码片段`)
        return
      }

      const updatedSnippet = {
        ...item.snippet,
        parentId: selectedDirectory.id,
        category: selectedDirectory.label,
      }
      await storageManager.updateSnippet(updatedSnippet)
      webviewProvider.refresh()
    }
  })

  // 注册插入代码片段命令
  let insertSnippetCommand = vscode.commands.registerCommand(
    'starcode-snippets.insertSnippet',
    async (snippet: CodeSnippet) => {
      await insertSnippet(snippet)
    }
  )

  // 注册刷新视图命令
  let refreshExplorer = vscode.commands.registerCommand('starcode-snippets.refreshExplorer', () => {
    webviewProvider.refresh()
    console.log('刷新视图')
    vscode.window.showInformationMessage('代码库已刷新')
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
    refreshExplorer,
    webviewView
  )
}

export function deactivate() {}
