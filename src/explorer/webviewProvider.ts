import * as vscode from 'vscode'
import { StorageManager } from '../storage/storageManager'
import { CodeSnippet, Directory } from '../models/types'

export class SnippetWebviewProvider {
  private _view?: vscode.WebviewView
  private _storageManager: StorageManager

  constructor(private readonly _extensionUri: vscode.Uri, storageManager: StorageManager) {
    this._storageManager = storageManager
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    }

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)

    // 处理来自webview的消息
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'getSnippets':
          await this._getSnippetsAndDirectories()
          break
        case 'insertSnippet':
          await vscode.commands.executeCommand('starcode-snippets.insertSnippet', data.snippet)
          break
        case 'previewSnippet':
          await vscode.commands.executeCommand('starcode-snippets.previewSnippet', data.snippet)
          break
        case 'editSnippet':
          await vscode.commands.executeCommand('starcode-snippets.editSnippet', { snippet: data.snippet })
          break
        case 'deleteItem':
          await vscode.commands.executeCommand('starcode-snippets.delete', { 
            snippet: data.snippet,
            directory: data.directory,
            label: data.name
          })
          break
        case 'createDirectory':
          await vscode.commands.executeCommand('starcode-snippets.createDirectory')
          break
        case 'createSnippet':
          await vscode.commands.executeCommand('starcode-snippets.createSnippetInDirectory', {
            directory: data.directory
          })
          break
        case 'moveToDirectory':
          await vscode.commands.executeCommand('starcode-snippets.moveToDirectory', {
            snippet: data.snippet
          })
          break
        case 'rename':
          await vscode.commands.executeCommand('starcode-snippets.rename', {
            snippet: data.snippet,
            directory: data.directory,
            label: data.name
          })
          break
      }
    })

    // 初始加载数据
    this._getSnippetsAndDirectories()
  }

  private async _getSnippetsAndDirectories() {
    if (!this._view) return

    const [directories, snippets] = await Promise.all([
      this._storageManager.getAllDirectories(),
      this._storageManager.getAllSnippets()
    ])

    // 发送数据到webview
    this._view.webview.postMessage({
      type: 'updateData',
      directories,
      snippets
    })
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>代码片段库</title>
        <style>
            body {
                padding: 0;
                color: var(--vscode-foreground);
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                background-color: var(--vscode-editor-background);
            }
            .container {
                padding: 10px;
            }
            .directory-container {
                margin: 2px 0;
            }
            .directory {
                padding: 5px;
                cursor: pointer;
                display: flex;
                align-items: center;
                border-radius: 3px;
            }
            .directory:hover {
                background-color: var(--vscode-list-hoverBackground);
            }
            .directory-icon {
                margin-right: 5px;
                color: var(--vscode-symbolIcon-folderForeground);
                transition: transform 0.2s;
                transform: rotate(45deg);
            }
            .directory.collapsed .directory-icon {
                transform: rotate(-45deg);
            }
            .directory-children {
                margin-left: 20px;
                display: block;
                transition: height 0.2s;
            }
            .directory.collapsed + .directory-children {
                display: none;
            }
            .snippet {
                padding: 5px;
                cursor: pointer;
                display: flex;
                align-items: center;
                border-radius: 3px;
                margin: 2px 0;
            }
            .snippet:hover {
                background-color: var(--vscode-list-hoverBackground);
            }
            .snippet-icon {
                margin-right: 5px;
                color: var(--vscode-symbolIcon-variableForeground);
            }
            .actions {
                margin-left: auto;
                display: none;
            }
            .directory:hover .actions,
            .snippet:hover .actions {
                display: flex;
            }
            .action-button {
                padding: 2px;
                margin-left: 4px;
                cursor: pointer;
                border: none;
                background: none;
                color: var(--vscode-foreground);
            }
            .action-button:hover {
                color: var(--vscode-button-foreground);
                background-color: var(--vscode-button-background);
            }
            .toolbar {
                background-color:#181b24;
                padding: 5px;
                display: flex;
                justify-content: flex-end;
            }
            .toolbar button {
                margin-left: 5px;
                padding: 2px 4px;
                font-size: 12px;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 3px;
                cursor: pointer;
            }
            .toolbar button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="toolbar">
                <button onclick="refreshContent()" title="刷新代码库">🔄 刷新</button>
                <button onclick="createDirectory()" title="新建目录">📁 新建目录</button>
            </div>
            <div id="content"></div>
        </div>
        <script>
            const vscode = acquireVsCodeApi();
            let directories = [];
            let snippets = [];

            // 初始化时请求数据
            vscode.postMessage({ type: 'getSnippets' });

            // 监听来自扩展的消息
            window.addEventListener('message', event => {
                const message = event.data;
                switch (message.type) {
                    case 'updateData':
                        directories = message.directories;
                        snippets = message.snippets;
                        renderContent();
                        break;
                }
            });

            function renderContent() {
                const content = document.getElementById('content');
                content.innerHTML = '';

                function renderDirectory(parentId, container) {
                    // 渲染当前层级的目录
                    directories
                        .filter(dir => dir.parentId === parentId)
                        .sort((a, b) => a.order - b.order)
                        .forEach(dir => {
                            const dirContainer = document.createElement('div');
                            dirContainer.className = 'directory-container';
                            
                            const dirElement = createDirectoryElement(dir);
                            dirContainer.appendChild(dirElement);
                            
                            const childrenContainer = document.createElement('div');
                            childrenContainer.className = 'directory-children';
                            
                            // 递归渲染子目录
                            renderDirectory(dir.id, childrenContainer);
                            
                            // 渲染当前目录下的代码片段
                            snippets
                                .filter(s => s.parentId === dir.id)
                                .sort((a, b) => a.order - b.order)
                                .forEach(snippet => {
                                    childrenContainer.appendChild(createSnippetElement(snippet));
                                });
                            
                            dirContainer.appendChild(childrenContainer);
                            container.appendChild(dirContainer);
                        });
                }

                // 渲染根级别的代码片段
                snippets
                    .filter(s => s.parentId === null)
                    .sort((a, b) => a.order - b.order)
                    .forEach(snippet => {
                        content.appendChild(createSnippetElement(snippet));
                    });

                // 从根级别开始渲染目录树
                renderDirectory(null, content);
            }

            function createDirectoryElement(directory) {
                const div = document.createElement('div');
                div.className = 'directory';
                div.innerHTML = \`
                    <span class="directory-icon">◢</span>
                    <span>📁 \${directory.name}</span>
                    <div class="actions">
                        <button class="action-button" onclick="createSnippetInDirectory('\${directory.id}')" title="新建代码片段">➕</button>
                        <button class="action-button" onclick="renameDirectory('\${directory.id}')" title="重命名目录">✏️</button>
                        <button class="action-button" onclick="deleteDirectory('\${directory.id}')" title="删除目录">🗑️</button>
                    </div>
                \`;

                // 添加点击事件处理折叠/展开
                div.addEventListener('click', (e) => {
                    // 如果点击的是按钮，不处理折叠
                    if (e.target.classList.contains('action-button')) {
                        return;
                    }
                    div.classList.toggle('collapsed');
                });

                return div;
            }

            function createSnippetElement(snippet) {
                const div = document.createElement('div');
                div.className = 'snippet';
                div.innerHTML = \`
                    <span class="snippet-icon">📄</span>
                    <span>\${snippet.name}</span>
                    <div class="actions">
                        <button class="action-button" onclick="insertSnippet('\${snippet.id}')" title="插入代码">📋</button>
                        <button class="action-button" onclick="previewSnippet('\${snippet.id}')" title="预览代码">👁️</button>
                        <button class="action-button" onclick="editSnippet('\${snippet.id}')" title="编辑代码">✏️</button>
                        <button class="action-button" onclick="moveSnippet('\${snippet.id}')" title="移动到其他目录">📦</button>
                        <button class="action-button" onclick="renameSnippet('\${snippet.id}')" title="重命名代码片段">📝</button>
                        <button class="action-button" onclick="deleteSnippet('\${snippet.id}')" title="删除代码片段">🗑️</button>
                    </div>
                \`;
                return div;
            }

            // 事件处理函数
            function createDirectory() {
                vscode.postMessage({ type: 'createDirectory' });
            }

            function createSnippetInDirectory(dirId) {
                const directory = directories.find(d => d.id === dirId);
                vscode.postMessage({ 
                    type: 'createSnippet',
                    directory
                });
            }

            function insertSnippet(snippetId) {
                const snippet = snippets.find(s => s.id === snippetId);
                vscode.postMessage({ 
                    type: 'insertSnippet',
                    snippet
                });
            }

            function previewSnippet(snippetId) {
                const snippet = snippets.find(s => s.id === snippetId);
                vscode.postMessage({ 
                    type: 'previewSnippet',
                    snippet
                });
            }

            function editSnippet(snippetId) {
                const snippet = snippets.find(s => s.id === snippetId);
                vscode.postMessage({ 
                    type: 'editSnippet',
                    snippet
                });
            }

            function moveSnippet(snippetId) {
                const snippet = snippets.find(s => s.id === snippetId);
                vscode.postMessage({ 
                    type: 'moveToDirectory',
                    snippet
                });
            }

            function renameSnippet(snippetId) {
                const snippet = snippets.find(s => s.id === snippetId);
                vscode.postMessage({ 
                    type: 'rename',
                    snippet,
                    name: snippet.name
                });
            }

            function renameDirectory(dirId) {
                const directory = directories.find(d => d.id === dirId);
                vscode.postMessage({ 
                    type: 'rename',
                    directory,
                    name: directory.name
                });
            }

            function deleteSnippet(snippetId) {
                const snippet = snippets.find(s => s.id === snippetId);
                vscode.postMessage({ 
                    type: 'deleteItem',
                    snippet,
                    name: snippet.name
                });
            }

            function deleteDirectory(dirId) {
                const directory = directories.find(d => d.id === dirId);
                vscode.postMessage({
                    type: 'deleteItem',
                    directory,
                    name: directory.name
                });
            }

            function refreshContent() {
                vscode.postMessage({ type: 'getSnippets' });
            }
        </script>
    </body>
    </html>`
  }

  public refresh() {
    this._getSnippetsAndDirectories()
  }
}