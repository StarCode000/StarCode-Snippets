import * as vscode from 'vscode'
import { StorageManager } from '../storage/storageManager'
import { CodeSnippet, Directory } from '../models/types'

export class SnippetWebviewProvider {
  private _view?: vscode.WebviewView
  private _storageManager: StorageManager
  private _cachedDirectories: Directory[] = [] 
  private _cachedSnippets: CodeSnippet[] = []
  private _isInitialized: boolean = false
  private _isRendering: boolean = false
  private _pendingRefresh: boolean = false

  constructor(private readonly _extensionUri: vscode.Uri, storageManager: StorageManager) {
    this._storageManager = storageManager
    // 在构造函数中预加载数据
    this._preloadData()
  }

  // 预加载数据方法
  private async _preloadData() {
    try {
      // 异步预加载数据
      const [directories, snippets] = await Promise.all([
        this._storageManager.getAllDirectories(),
        this._storageManager.getAllSnippets()
      ])
      this._cachedDirectories = directories
      this._cachedSnippets = snippets
    } catch (error) {
      console.error('预加载数据失败:', error)
    }
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

    // 立即设置框架HTML结构，不等待数据加载
    webviewView.webview.html = this._getSkeletonHtmlForWebview(webviewView.webview)

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
        case 'ready': 
          // 当webview通知已准备好加载数据时
          this._sendCachedDataOrRefresh()
          break
        case 'renderComplete':
          // 渲染完成时更新状态
          this._isRendering = false
          if (this._pendingRefresh) {
            this._pendingRefresh = false
            this._sendCachedDataOrRefresh()
          }
          break
      }
    })

    // 主体结构已经设置好，现在可以开始异步加载数据
    // 延迟50ms，确保框架已渲染
    setTimeout(() => {
      this._sendCachedDataOrRefresh()
    }, 50)
  }

  // 发送缓存的数据或刷新数据
  private _sendCachedDataOrRefresh() {
    if (!this._view) {return}
    
    // 如果正在渲染，标记为待刷新并返回
    if (this._isRendering) {
      this._pendingRefresh = true
      return
    }
    
    this._isRendering = true
    
    if (this._cachedDirectories.length > 0 || this._cachedSnippets.length > 0) {
      // 如果有缓存数据，直接发送
      this._view.webview.postMessage({
        type: 'updateData',
        directories: this._cachedDirectories,
        snippets: this._cachedSnippets
      })
      this._isInitialized = true
    } else {
      // 否则刷新数据
      this._getSnippetsAndDirectories()
    }
  }

  private async _getSnippetsAndDirectories() {
    if (!this._view) {return}

    try {
      // 如果正在渲染，标记为待刷新并返回
      if (this._isRendering) {
        this._pendingRefresh = true
        return
      }
      
      this._isRendering = true
      
      // 通知webview开始加载数据
      this._view.webview.postMessage({
        type: 'startLoading'
      })

      const [directories, snippets] = await Promise.all([
        this._storageManager.getAllDirectories(),
        this._storageManager.getAllSnippets()
      ])

      // 更新缓存
      this._cachedDirectories = directories
      this._cachedSnippets = snippets
      this._isInitialized = true

      // 发送数据到webview
      this._view.webview.postMessage({
        type: 'updateData',
        directories,
        snippets
      })
    } catch (error) {
      console.error('获取数据失败:', error)
      vscode.window.showErrorMessage(`加载代码片段失败: ${error}`)
      this._isRendering = false
    }
  }

  // 返回最基本的HTML骨架，仅包含UI框架
  private _getSkeletonHtmlForWebview(webview: vscode.Webview) {
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
                -webkit-user-select: none; /* Safari */
                -moz-user-select: none; /* Firefox */
                -ms-user-select: none; /* IE 10+/Edge */
                user-select: none; /* Standard syntax */
            }
            .container {
                padding: 10px;
            }
            .toolbar {
                border: 2px solid var(--vscode-button-background);
                border-radius: 6px;
                padding: 5px;
                display: flex;
                justify-content: flex-end;
                margin-bottom: 10px;
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
                transition: 0.4s;
            }
            .toolbar button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
            .loading {
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100px;
                flex-direction: column;
            }
            @keyframes pulse {
                0% { opacity: 0.6; }
                50% { opacity: 1; }
                100% { opacity: 0.6; }
            }
            .skeleton-item {
                height: 24px;
                margin: 6px 0;
                background-color: var(--vscode-button-background);
                opacity: 0.3;
                border-radius: 3px;
                animation: pulse 1.5s infinite;
            }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            .spinner {
                border: 3px solid rgba(0, 0, 0, 0.1);
                border-radius: 50%;
                border-top: 3px solid var(--vscode-progressBar-background);
                width: 20px;
                height: 20px;
                animation: spin 1s linear infinite;
                margin-bottom: 8px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="toolbar">
                <button onclick="refreshContent()" title="刷新代码库">🔄 刷新</button>
                <button onclick="createDirectory()" title="新建目录">📁 新建目录</button>
            </div>
            <div id="content">
                <!-- 占位骨架屏 -->
                <div class="skeleton-item" style="width: 60%;"></div>
                <div class="skeleton-item" style="width: 70%; margin-left: 20px;"></div>
                <div class="skeleton-item" style="width: 65%; margin-left: 20px;"></div>
                <div class="skeleton-item" style="width: 80%;"></div>
                <div class="skeleton-item" style="width: 55%; margin-left: 20px;"></div>
                <div class="skeleton-item" style="width: 75%;"></div>
            </div>
        </div>
        <script>
            document.addEventListener('contextmenu', function(event) {
              event.preventDefault(); // 阻止默认的右键菜单
            });
            const vscode = acquireVsCodeApi();
            let directories = [];
            let snippets = [];
            let isRendering = false;
            let pendingData = null;

            // 告诉扩展webview已准备好接收数据
            window.addEventListener('load', () => {
                vscode.postMessage({ type: 'ready' });
            });

            // 监听来自扩展的消息
            window.addEventListener('message', event => {
                const message = event.data;
                switch (message.type) {
                    case 'startLoading':
                        showLoadingIndicator();
                        break;
                    case 'updateData':
                        if (isRendering) {
                            // 如果正在渲染，存储数据等待稍后处理
                            pendingData = message;
                            return;
                        }
                        isRendering = true;
                        directories = message.directories;
                        snippets = message.snippets;
                        
                        // 使用requestAnimationFrame确保在下一帧渲染
                        requestAnimationFrame(() => {
                            renderContent();
                            // 通知扩展渲染完成
                            setTimeout(() => {
                                isRendering = false;
                                vscode.postMessage({ type: 'renderComplete' });
                                
                                // 处理待处理的数据
                                if (pendingData) {
                                    const data = pendingData;
                                    pendingData = null;
                                    
                                    // 递归处理
                                    window.dispatchEvent(new MessageEvent('message', {
                                        data: data
                                    }));
                                }
                            }, 50);
                        });
                        break;
                }
            });

            function showLoadingIndicator() {
                const content = document.getElementById('content');
                content.innerHTML = '<div class="loading"><div class="spinner"></div><div>正在加载数据...</div></div>';
            }

            // 优化的渲染函数，分批次渲染大量数据
            function renderContent() {
                const content = document.getElementById('content');
                content.innerHTML = ''; // 清空内容
                
                // 分批次渲染以提高性能
                setTimeout(() => {
                    // 创建一个文档片段来存储所有要渲染的元素
                    const fragment = document.createDocumentFragment();
                    
                    // 渲染根级别的代码片段
                    const rootSnippets = snippets.filter(s => s.parentId === null);
                    if (rootSnippets.length > 0) {
                        rootSnippets
                            .sort((a, b) => a.order - b.order)
                            .forEach(snippet => {
                                fragment.appendChild(createSnippetElement(snippet));
                            });
                    }

                    // 渲染目录树，使用批量处理
                    batchRenderDirectory(null, fragment);
                    
                    // 一次性添加完整的文档片段
                    content.appendChild(fragment);
                }, 0);
            }

            // 批量渲染目录，提高性能
            function batchRenderDirectory(parentId, container) {
                // 获取当前层级的目录
                const currentLevelDirs = directories
                    .filter(dir => dir.parentId === parentId)
                    .sort((a, b) => a.order - b.order);
                
                // 如果没有目录，直接返回
                if (currentLevelDirs.length === 0) {
                    return;
                }
                
                currentLevelDirs.forEach(dir => {
                    const dirContainer = document.createElement('div');
                    dirContainer.className = 'directory-container';
                    
                    const dirElement = createDirectoryElement(dir);
                    dirContainer.appendChild(dirElement);
                    
                    const childrenContainer = document.createElement('div');
                    childrenContainer.className = 'directory-children';
                    
                    // 获取当前目录下的所有代码片段
                    const dirSnippets = snippets.filter(s => s.parentId === dir.id);
                    
                    // 添加代码片段
                    if (dirSnippets.length > 0) {
                        dirSnippets
                            .sort((a, b) => a.order - b.order)
                            .forEach(snippet => {
                                childrenContainer.appendChild(createSnippetElement(snippet));
                            });
                    }
                    
                    // 递归渲染子目录
                    batchRenderDirectory(dir.id, childrenContainer);
                    
                    dirContainer.appendChild(childrenContainer);
                    container.appendChild(dirContainer);
                });
            }

            // 定义样式一次，避免重复创建
            const directoryStyles = 
                '.directory {' +
                '    height: 24px;' +
                '    padding: 5px;' +
                '    cursor: pointer;' +
                '    display: flex;' +
                '    align-items: center;' +
                '    border-radius: 3px;' +
                '    position: relative;' +
                '}' +
                '.directory:hover {' +
                '    background-color: var(--vscode-list-hoverBackground);' +
                '}' +
                '.directory-icon {' +
                '    margin-right: 5px;' +
                '    color: var(--vscode-symbolIcon-folderForeground);' +
                '    transition: transform 0.2s;' +
                '    transform: rotate(45deg);' +
                '}' +
                '.directory.collapsed .directory-icon {' +
                '    transform: rotate(-45deg);' +
                '}' +
                '.directory-children {' +
                '    margin-left: 20px;' +
                '    display: block;' +
                '    transition: height 0.2s;' +
                '}' +
                '.directory.collapsed + .directory-children {' +
                '    display: none;' +
                '}' +
                '.actions {' +
                '    margin-left: auto;' +
                '    display: none;' +
                '}' +
                '.directory:hover .actions,' +
                '.snippet:hover .actions {' +
                '    display: flex;' +
                '    position: absolute;' +
                '    right: 5px;' +
                '    background-color: var(--vscode-editor-background);' +
                '    opacity: 0.9;' +
                '    box-shadow: 0 0 5px rgba(0, 0, 0, 0.2);' +
                '    border-radius: 3px;' +
                '    padding: 0 4px;' +
                '    z-index: 10;' +
                '}' +
                '.action-button {' +
                '    border-radius: 3px;' +
                '    padding: 2px;' +
                '    margin-left: 4px;' +
                '    cursor: pointer;' +
                '    border: none;' +
                '    background: none;' +
                '    color: var(--vscode-foreground);' +
                '    transition: 0.4s;' +
                '}' +
                '.action-button:hover {' +
                '    color: var(--vscode-button-foreground);' +
                '    background-color: var(--vscode-button-background);' +
                '}' +
                '.snippet {' +
                '    height: 24px;' +
                '    padding: 5px;' +
                '    cursor: pointer;' +
                '    display: flex;' +
                '    align-items: center;' +
                '    border-radius: 3px;' +
                '    margin: 2px 0;' +
                '    position: relative;' +
                '}' +
                '.snippet:hover {' +
                '    background-color: var(--vscode-list-hoverBackground);' +
                '}' +
                '.snippet-icon {' +
                '    margin-right: 5px;' +
                '    color: var(--vscode-symbolIcon-variableForeground);' +
                '}' +
                '.directory-name, .snippet-name {' +
                '    overflow: hidden;' +
                '    text-overflow: ellipsis;' +
                '    white-space: nowrap;' +
                '    flex: 1;' +
                '}';

            // 只添加一次样式
            (function addStyles() {
                const style = document.createElement('style');
                style.textContent = directoryStyles;
                document.head.appendChild(style);
            })();

            function createDirectoryElement(directory) {
                const div = document.createElement('div');
                div.className = 'directory';
                div.innerHTML = \`
                    <span class="directory-icon">◢</span>
                    <span class="directory-name">📁 \${directory.name}</span>
                    <div class="actions">
                        <button class="action-button" onclick="createSnippetInDirectory('\${directory.id}')" title="新建代码片段">➕</button>
                        <button class="action-button" onclick="renameDirectory('\${directory.id}')" title="重命名目录">📝</button>
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
                    <span class="snippet-name">\${snippet.name}</span>
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
                showLoadingIndicator();
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