import * as vscode from 'vscode'
import { StorageManager } from '../storage/storageManager'
import { StorageStrategyFactory, V1StorageStrategy, V2StorageStrategy } from '../utils/storageStrategy'
import { StorageContext } from '../utils/storageContext'
import { CodeSnippet, Directory, CodeSnippetV2, DirectoryV2 } from '../types/types'

export class DataViewerWebviewProvider {
  public static readonly viewType = 'starcode-data-viewer'
  
  private static currentPanel: vscode.WebviewPanel | undefined

  public static createOrShow(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined

    // 如果已经有面板，则激活它
    if (DataViewerWebviewProvider.currentPanel) {
      DataViewerWebviewProvider.currentPanel.reveal(column)
      return
    }

    // 创建新的面板
    const panel = vscode.window.createWebviewPanel(
      DataViewerWebviewProvider.viewType,
      '数据查看器',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
      }
    )

    DataViewerWebviewProvider.currentPanel = panel
    const provider = new DataViewerWebviewProvider(extensionUri, context)
    
    // 初始化webview内容
    provider._setupWebviewContent(panel)

    // 监听面板销毁事件
    panel.onDidDispose(() => {
      DataViewerWebviewProvider.currentPanel = undefined
    }, null)
  }

  constructor(private readonly _extensionUri: vscode.Uri, private readonly _context: vscode.ExtensionContext) {}

  private _setupWebviewContent(panel: vscode.WebviewPanel) {
    panel.webview.html = this._getHtmlForWebview()

    // 监听来自webview的消息
    panel.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'loadData':
          await this._loadAndDisplayData(panel)
          break
        case 'refreshData':
          await this._loadAndDisplayData(panel)
          break
      }
    })

    // 初始加载数据
    this._loadAndDisplayData(panel)
  }

  private async _loadAndDisplayData(panel: vscode.WebviewPanel) {
    try {
      // 加载V1数据
      const v1Data = await this._loadV1Data()
      
      // 加载V2数据
      const v2Data = await this._loadV2Data()

      // 加载当前活跃的数据（通过StorageManager）
      const currentData = await this._loadCurrentData()

      // 获取当前存储策略信息
      const storageInfo = await this._getStorageInfo()

      // 发送数据到webview
      panel.webview.postMessage({
        type: 'dataLoaded',
        data: {
          v1: v1Data,
          v2: v2Data,
          current: currentData,
          storageInfo: storageInfo,
          timestamp: new Date().toLocaleString('zh-CN')
        }
      })
    } catch (error) {
      console.error('加载数据失败:', error)
      panel.webview.postMessage({
        type: 'error',
        message: `加载数据失败: ${error}`
      })
    }
  }

  private async _loadV1Data(): Promise<{ snippets: CodeSnippet[], directories: Directory[] }> {
    try {
      // 使用V1存储策略直接获取数据
      const v1Strategy = new V1StorageStrategy(this._context)
      const v1Snippets = await v1Strategy.getAllSnippets()
      const v1Directories = await v1Strategy.getAllDirectories()

      // console.log(`数据查看器 - V1数据: ${v1Snippets.length}个代码片段, ${v1Directories.length}个目录`)

      return {
        snippets: v1Snippets,
        directories: v1Directories
      }
    } catch (error) {
      console.error('加载V1数据失败:', error)
      return { snippets: [], directories: [] }
    }
  }

  private async _loadV2Data(): Promise<{ snippets: CodeSnippetV2[], directories: DirectoryV2[] }> {
    try {
      // 使用V2存储策略直接获取数据
      const v2Strategy = new V2StorageStrategy(this._context)
      const v2Snippets = await v2Strategy.getAllSnippets()
      const v2Directories = await v2Strategy.getAllDirectories()

      // console.log(`数据查看器 - V2数据: ${v2Snippets.length}个代码片段, ${v2Directories.length}个目录`)

      return {
        snippets: v2Snippets,
        directories: v2Directories
      }
    } catch (error) {
      console.error('加载V2数据失败:', error)
      return { snippets: [], directories: [] }
    }
  }

  private async _loadCurrentData(): Promise<{ snippets: any[], directories: any[] }> {
    try {
      // 使用StorageManager获取当前活跃的数据
      const storageManager = new StorageManager(this._context)
      const currentSnippets = await storageManager.getAllSnippets()
      const currentDirectories = await storageManager.getAllDirectories()

      // console.log(`数据查看器 - 当前活跃数据: ${currentSnippets.length}个代码片段, ${currentDirectories.length}个目录`)

      return {
        snippets: currentSnippets,
        directories: currentDirectories
      }
    } catch (error) {
      console.error('加载当前数据失败:', error)
      return { snippets: [], directories: [] }
    }
  }

  private async _getStorageInfo(): Promise<any> {
    try {
      const storageStrategy = StorageStrategyFactory.createStrategy(this._context)
      
      // 获取存储策略信息
      const settingsManager = vscode.workspace.getConfiguration('starcode-snippets')
      const configuredVersion = settingsManager.get('storageVersion', 'v2')
      
      // 检查是否已迁移
      const migratedToV2 = this._context.globalState.get('migratedToV2', false)
      
      // 获取当前使用的存储策略
      const currentStrategy = storageStrategy.constructor.name
      
      // 获取存储版本
      const strategyVersion = storageStrategy.getVersion ? storageStrategy.getVersion() : 'unknown'
      
      return {
        configuredVersion,
        migratedToV2,
        currentStrategy,
        strategyVersion,
        hasV1Data: false, // 将在加载数据后更新
        hasV2Data: false  // 将在加载数据后更新
      }
    } catch (error) {
      console.error('获取存储信息失败:', error)
      return {
        configuredVersion: 'unknown',
        migratedToV2: false,
        currentStrategy: 'unknown',
        strategyVersion: 'unknown',
        hasV1Data: false,
        hasV2Data: false
      }
    }
  }

  private _getHtmlForWebview(): string {
    return `
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>数据库版本查看器</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-size: 13px;
            line-height: 1.4;
          }
          
          .header {
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
          }
          
          .header h1 {
            margin: 0 0 10px 0;
            font-size: 18px;
            font-weight: 600;
          }
          
          .controls {
            margin-bottom: 20px;
          }
          
          .btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            margin-right: 10px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 13px;
          }
          
          .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
          
          .storage-info {
            background-color: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 3px;
            padding: 15px;
            margin-bottom: 20px;
          }
          
          .storage-info h3 {
            margin: 0 0 10px 0;
            font-size: 14px;
            font-weight: 600;
          }
          
          .info-grid {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 8px 15px;
            font-family: monospace;
            font-size: 12px;
          }
          
          .info-label {
            font-weight: 600;
            color: var(--vscode-foreground);
          }
          
          .info-value {
            color: var(--vscode-textPreformat-foreground);
          }
          
          .version-section {
            margin-bottom: 30px;
          }
          
          .version-header {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
          }
          
          .version-title {
            font-size: 16px;
            font-weight: 600;
            margin-right: 15px;
          }
          
          .version-badge {
            padding: 4px 8px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: 500;
          }
          
          .badge-v1 {
            background-color: var(--vscode-debugTokenExpression-error);
            color: white;
          }
          
                     .badge-v2 {
             background-color: var(--vscode-debugTokenExpression-boolean);
             color: white;
           }
           
           .badge-current {
             background-color: var(--vscode-debugTokenExpression-name);
             color: white;
           }
          
          .data-container {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
          }
          
          .data-section {
            background-color: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 3px;
            overflow: hidden;
          }
          
          .data-header {
            background-color: var(--vscode-tab-activeBackground);
            padding: 10px 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
            font-weight: 600;
            font-size: 13px;
          }
          
          .data-content {
            padding: 15px;
            max-height: 400px;
            overflow-y: auto;
          }
          
          .data-item {
            margin-bottom: 15px;
            padding: 10px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
          }
          
          .item-name {
            font-weight: 600;
            margin-bottom: 5px;
            color: var(--vscode-symbolIcon-functionForeground);
          }
          
          .item-details {
            font-family: monospace;
            font-size: 11px;
            color: var(--vscode-textPreformat-foreground);
          }
          
          .item-details div {
            margin-bottom: 3px;
          }
          
          .no-data {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 40px 20px;
          }
          
          .error {
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            color: var(--vscode-errorForeground);
            padding: 15px;
            border-radius: 3px;
            margin: 20px 0;
          }
          
          .timestamp {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
            margin-top: 20px;
            text-align: center;
          }
          
          .loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
          }
          
          @media (max-width: 800px) {
            .data-container {
              grid-template-columns: 1fr;
            }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>代码库数据查看器</h1>
          <div class="controls">
            <button class="btn" onclick="loadData()">加载数据</button>
            <button class="btn" onclick="refreshData()">刷新</button>
          </div>
        </div>
        
        <div id="content">
          <div class="loading">正在加载数据...</div>
        </div>
        
        <script>
          const vscode = acquireVsCodeApi();
          
          function loadData() {
            vscode.postMessage({ type: 'loadData' });
          }
          
          function refreshData() {
            vscode.postMessage({ type: 'refreshData' });
          }
          
          function renderStorageInfo(storageInfo) {
            return \`
              <div class="storage-info">
                <h3>存储策略信息</h3>
                <div class="info-grid">
                  <span class="info-label">配置版本:</span>
                  <span class="info-value">\${storageInfo.configuredVersion}</span>
                  
                  <span class="info-label">已迁移到V2:</span>
                  <span class="info-value">\${storageInfo.migratedToV2 ? '是' : '否'}</span>
                  
                  <span class="info-label">当前存储策略:</span>
                  <span class="info-value">\${storageInfo.currentStrategy}</span>
                  
                  <span class="info-label">策略版本:</span>
                  <span class="info-value">\${storageInfo.strategyVersion}</span>
                  
                  <span class="info-label">当前活跃数据:</span>
                  <span class="info-value">\${storageInfo.hasCurrentData ? '是' : '否'}</span>
                  
                  <span class="info-label">V1数据存在:</span>
                  <span class="info-value">\${storageInfo.hasV1Data ? '是' : '否'}</span>
                  
                  <span class="info-label">V2数据存在:</span>
                  <span class="info-value">\${storageInfo.hasV2Data ? '是' : '否'}</span>
                </div>
              </div>
            \`;
          }
          
                     function renderDataSection(title, data, version) {
             let badgeClass = 'badge-v2';
             if (version === 'v1') {
               badgeClass = 'badge-v1';
             } else if (version === 'current') {
               badgeClass = 'badge-current';
             }
             const snippets = data.snippets || [];
             const directories = data.directories || [];
            
            return \`
              <div class="version-section">
                <div class="version-header">
                  <span class="version-title">\${title}</span>
                  <span class="version-badge \${badgeClass}">\${version.toUpperCase()}</span>
                </div>
                
                <div class="data-container">
                  <div class="data-section">
                    <div class="data-header">目录 (\${directories.length})</div>
                    <div class="data-content">
                      \${directories.length === 0 ? 
                        '<div class="no-data">无目录数据</div>' : 
                        directories.map(dir => \`
                          <div class="data-item">
                            <div class="item-name">\${dir.name}</div>
                                                         <div class="item-details">
                               \${version === 'v1' ? \`
                                 <div>ID: \${dir.id}</div>
                                 <div>父ID: \${dir.parentId || '根目录'}</div>
                               \` : version === 'current' ? \`
                                 \${dir.fullPath ? \`<div>路径: \${dir.fullPath}</div>\` : \`
                                   <div>ID: \${dir.id}</div>
                                   <div>父ID: \${dir.parentId || '根目录'}</div>
                                 \`}
                               \` : \`
                                 <div>路径: \${dir.fullPath}</div>
                               \`}
                              <div>排序: \${dir.order}</div>
                              <div>创建: \${new Date(dir.createdAt).toLocaleString('zh-CN')}</div>
                            </div>
                          </div>
                        \`).join('')
                      }
                    </div>
                  </div>
                  
                  <div class="data-section">
                    <div class="data-header">代码片段 (\${snippets.length})</div>
                    <div class="data-content">
                      \${snippets.length === 0 ? 
                        '<div class="no-data">无代码片段数据</div>' : 
                        snippets.map(snippet => \`
                          <div class="data-item">
                            <div class="item-name">\${snippet.name}</div>
                                                         <div class="item-details">
                               \${version === 'v1' ? \`
                                 <div>ID: \${snippet.id}</div>
                                 <div>父ID: \${snippet.parentId || '根目录'}</div>
                               \` : version === 'current' ? \`
                                 \${snippet.fullPath ? \`<div>路径: \${snippet.fullPath}</div>\` : \`
                                   <div>ID: \${snippet.id}</div>
                                   <div>父ID: \${snippet.parentId || '根目录'}</div>
                                 \`}
                               \` : \`
                                 <div>路径: \${snippet.fullPath}</div>
                               \`}
                              <div>语言: \${snippet.language}</div>
                              <div>排序: \${snippet.order}</div>
                              <div>代码长度: \${snippet.code.length} 字符</div>
                              <div>创建: \${new Date(snippet.createdAt).toLocaleString('zh-CN')}</div>
                              \${snippet.updatedAt ? \`<div>更新: \${new Date(snippet.updatedAt).toLocaleString('zh-CN')}</div>\` : ''}
                            </div>
                          </div>
                        \`).join('')
                      }
                    </div>
                  </div>
                </div>
              </div>
            \`;
          }
          
          // 监听来自扩展的消息
          window.addEventListener('message', event => {
            const message = event.data;
            
                         switch (message.type) {
               case 'dataLoaded':
                 const { v1, v2, current, storageInfo, timestamp } = message.data;
                 
                 // 更新存储信息中的数据存在状态
                 storageInfo.hasV1Data = v1.snippets.length > 0 || v1.directories.length > 0;
                 storageInfo.hasV2Data = v2.snippets.length > 0 || v2.directories.length > 0;
                 storageInfo.hasCurrentData = current.snippets.length > 0 || current.directories.length > 0;
                 
                 document.getElementById('content').innerHTML = \`
                   \${renderStorageInfo(storageInfo)}
                   \${renderDataSection('当前活跃数据 (TreeView显示)', current, 'current')}
                   \${renderDataSection('V1格式数据 (ID-基于)', v1, 'v1')}
                   \${renderDataSection('V2格式数据 (路径-基于)', v2, 'v2')}
                   <div class="timestamp">最后更新: \${timestamp}</div>
                 \`;
                 break;
                
              case 'error':
                document.getElementById('content').innerHTML = \`
                  <div class="error">错误: \${message.message}</div>
                \`;
                break;
            }
          });
          
          // 初始加载
          loadData();
        </script>
      </body>
      </html>
    `;
  }
} 