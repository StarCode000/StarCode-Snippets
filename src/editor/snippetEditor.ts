// src/editor/snippetEditor.ts
import * as vscode from 'vscode'
import { CodeSnippet } from '../types/types'
// import { v4 as uuidv4 } from 'uuidv4' // May not be needed for panel keys if snippet ID is used
import { StorageManager } from '../storage/storageManager'
import { ContextManager } from '../utils/contextManager'

/**
 * SnippetEditor负责创建和管理代码片段编辑会话 (使用WebView)
 */
export class SnippetEditor {
  private static _instance: SnippetEditor | undefined
  private storageManager: StorageManager
  private extensionContext: vscode.ExtensionContext // Store context

  // 跟踪当前正在编辑的Webview面板
  // Key: snippet fullPath, Value: { snippet: CodeSnippet, panel: vscode.WebviewPanel, currentCode: string, lastSavedCode: string, isDirtyInWebview: boolean }
  private editingWebviews = new Map<
    string,
    {
      snippet: CodeSnippet
      panel: vscode.WebviewPanel
      currentCode: string
      lastSavedCode: string
      isDirtyInWebview: boolean
    }
  >()

  private _onDidSaveSnippet = new vscode.EventEmitter<CodeSnippet>()
  public readonly onDidSaveSnippet = this._onDidSaveSnippet.event

  private constructor(context: vscode.ExtensionContext, storageManager: StorageManager) {
    this.extensionContext = context
    this.storageManager = storageManager
  }

  public static initialize(context: vscode.ExtensionContext, storageManager: StorageManager): SnippetEditor {
    if (!SnippetEditor._instance) {
      SnippetEditor._instance = new SnippetEditor(context, storageManager)
    }
    return SnippetEditor._instance
  }

  public static getInstance(): SnippetEditor {
    if (!SnippetEditor._instance) {
      throw new Error('SnippetEditor未初始化，请先调用initialize')
    }
    return SnippetEditor._instance
  }

  private getNonce() {
    let text = ''
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length))
    }
    return text
  }

  // 为V2兼容性提供ID获取方法
  private getSnippetId(snippet: CodeSnippet): string {
    // V2使用fullPath作为唯一标识
    return (snippet as any).fullPath || (snippet as any).id || snippet.name
  }

  public async edit(snippet: CodeSnippet): Promise<void> {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined

    const snippetId = this.getSnippetId(snippet)
    const existingSession = this.editingWebviews.get(snippetId)
    if (existingSession) {
      existingSession.panel.reveal(column)
      return
    }

    const panel = vscode.window.createWebviewPanel(
      'starcodeSnippetEditor',
      `编辑: ${snippet.name}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionContext.extensionUri, 'dist'),
          vscode.Uri.joinPath(this.extensionContext.extensionUri, 'media'), // 本地monaco编辑器资源
          vscode.Uri.joinPath(this.extensionContext.extensionUri, 'media', 'monaco-editor'),
        ],
      }
    )

    const initialCode = snippet.code || ''
    const session = {
      snippet,
      panel,
      currentCode: initialCode,
      lastSavedCode: initialCode,
      isDirtyInWebview: false, // Webview会通过消息更新这个状态
    }
    this.editingWebviews.set(snippetId, session)

    panel.webview.html = this._getWebviewContent(panel.webview, snippet)

    panel.onDidDispose(
      () => {
        const disposedSession = this.editingWebviews.get(snippetId)
        if (disposedSession && disposedSession.isDirtyInWebview) {
          // console.log(`Webview for ${snippet.name} disposed with unsaved changes. Auto-saving.`)
          // 自动保存逻辑
          const codeToSave = disposedSession.currentCode // 使用webview同步过来的最新代码
          const languageToSave = this.mapVSCodeLanguageIdToOurs(
            this.mapLanguageToVSCode(disposedSession.snippet.language || 'plaintext'), // 假设webview用的也是这个
            disposedSession.snippet.language
          )
          const updatedSnippet: CodeSnippet = {
            ...disposedSession.snippet,
            code: codeToSave,
            language: languageToSave,
          }
          this.storageManager
            .updateSnippet(updatedSnippet)
            .then(() => {
              this._onDidSaveSnippet.fire(updatedSnippet)
              // console.log(`代码片段 "${updatedSnippet.name}" 已在关闭时自动保存。`)
            })
            .catch((error) => {
              // console.error(`关闭时自动保存代码片段 "${updatedSnippet.name}" 失败:`, error)
              vscode.window.showErrorMessage(`关闭时自动保存代码片段 "${updatedSnippet.name}" 失败。`)
            })
        }
        this.editingWebviews.delete(snippetId)
        if (this.editingWebviews.size === 0) {
          ContextManager.setEditingSnippet(false)
        }
      },
      null,
      this.extensionContext.subscriptions
    )

    panel.webview.onDidReceiveMessage(
      async (message) => {
        // 【重要修复】检查webview是否已被销毁
        try {
          if (panel.webview === undefined) {
            console.warn('收到消息但webview已被销毁:', message.type)
            return
          }
        } catch (error) {
          console.warn('Webview已被销毁，忽略消息:', message.type)
          return
        }

        // console.log('收到WebView消息:', message.type, message.snippetId)

        const messageSnippetId = message.snippetId || snippetId
        const currentSession = this.editingWebviews.get(messageSnippetId)
        if (!currentSession) {
          console.warn('Received message for non-existent session:', messageSnippetId)
          return
        }
        
        // 【重要修复】再次检查当前session的panel是否还有效
        if (currentSession.panel !== panel || currentSession.panel.webview === undefined) {
          console.warn('Session panel已失效，忽略消息:', message.type)
          return
        }

        switch (message.type) {
          case 'ready':
            // console.log('收到WebView ready消息，准备发送代码片段数据')
            // console.log('代码片段内容长度:', currentSession.currentCode.length)
            if (currentSession.currentCode) {
              // console.log('代码片段内容前50个字符:', currentSession.currentCode.substring(0, 50))
            }

            // 【重要修复】发送消息前检查webview是否还有效
            try {
              panel.webview.postMessage({
                type: 'loadSnippet',
                data: {
                  code: currentSession.currentCode,
                  language: this.mapLanguageToVSCode(currentSession.snippet.language || 'plaintext'),
                  snippetId: this.getSnippetId(currentSession.snippet),
                },
              })
            } catch (error) {
              console.warn('发送loadSnippet消息失败，webview可能已被销毁:', error)
            }
            // console.log('已发送loadSnippet消息到WebView')
            break
          case 'saveSnippet': {
            const codeToSave = message.data.code
            const languageFromWebview = message.data.language
            const languageToSave = this.mapVSCodeLanguageIdToOurs(languageFromWebview, currentSession.snippet.language)
            const saveMethod = message.data.saveMethod || 'unknown' // 获取保存方式



            currentSession.currentCode = codeToSave

            const updatedSnippet: CodeSnippet = {
              ...currentSession.snippet,
              code: codeToSave,
              language: languageToSave,
            }
            try {
              await this.storageManager.updateSnippet(updatedSnippet)
              currentSession.snippet = updatedSnippet
              currentSession.lastSavedCode = codeToSave
              currentSession.isDirtyInWebview = false
              this._onDidSaveSnippet.fire(updatedSnippet)
              
              // 【修复】确保所有保存方式都有明确的用户反馈
              const saveMessage = saveMethod === 'shortcut' 
                ? `代码片段 "${updatedSnippet.name}" 已保存 (Ctrl+S)`
                : `代码片段 "${updatedSnippet.name}" 已保存`
              
              vscode.window.showInformationMessage(saveMessage)
              // 【重要修复】发送消息前检查webview是否还有效
              try {
                panel.webview.postMessage({ 
                  type: 'saveSuccess', 
                  snippetId: this.getSnippetId(currentSession.snippet),
                  saveMethod: saveMethod
                })
              } catch (error) {
                console.warn('发送saveSuccess消息失败，webview可能已被销毁:', error)
              }
            } catch (error) {
              console.error('保存代码片段失败 (来自webview):', error)
              const errorMessage = `保存代码片段 "${updatedSnippet.name}" 失败`
              vscode.window.showErrorMessage(errorMessage)
              
              // 【重要修复】发送消息前检查webview是否还有效
              try {
                panel.webview.postMessage({ 
                  type: 'saveError', 
                  snippetId: this.getSnippetId(currentSession.snippet),
                  saveMethod: saveMethod,
                  error: error instanceof Error ? error.message : '未知错误'
                })
              } catch (error) {
                console.warn('发送saveError消息失败，webview可能已被销毁:', error)
              }
            }
            break
          }
          case 'contentChanged': {
            currentSession.currentCode = message.data.code
            currentSession.isDirtyInWebview = true
            break
          }
        }
      },
      null,
      this.extensionContext.subscriptions
    )

    ContextManager.setEditingSnippet(true)
  }

  public closeAllSessions(): void {
    for (const [id, session] of this.editingWebviews) {
      session.panel.dispose()
    }
    this.editingWebviews.clear()
    ContextManager.setEditingSnippet(false)
  }

  private mapLanguageToVSCode(language: string): string {
    const languageMap: Record<string, string> = {
      js: 'javascript',
      ts: 'typescript',
      py: 'python',
      cpp: 'cpp',
      'c++': 'cpp',
      cs: 'csharp',
      'c#': 'csharp',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      php: 'php',
      java: 'java',
      kt: 'kotlin',
      swift: 'swift',
      plaintext: 'plaintext',
    }
    return languageMap[language?.toLowerCase()] || language?.toLowerCase() || 'plaintext'
  }

  private mapVSCodeLanguageIdToOurs(vscodeLangId: string, originalLanguage?: string): string {
    const reverseMap: Record<string, string> = {
      javascript: 'js',
      typescript: 'ts',
      python: 'py',
      cpp: 'cpp',
      csharp: 'cs',
      ruby: 'rb',
      go: 'go',
      rust: 'rs',
      php: 'php',
      java: 'java',
      kotlin: 'kt',
      swift: 'swift',
      plaintext: 'plaintext',
    }
    return reverseMap[vscodeLangId] || originalLanguage || vscodeLangId || 'plaintext'
  }

  private _getWebviewContent(webview: vscode.Webview, snippet: CodeSnippet): string {
    const extensionUri = this.extensionContext.extensionUri

    // 使用本地下载的Monaco编辑器
    const monacoBasePath = vscode.Uri.joinPath(extensionUri, 'media', 'monaco-editor', 'min')
    const monacoLoaderUri = webview.asWebviewUri(vscode.Uri.joinPath(monacoBasePath, 'vs', 'loader.js'))
    const monacoBaseWebViewUri = webview.asWebviewUri(monacoBasePath)
    const monacoMainCss = webview.asWebviewUri(vscode.Uri.joinPath(monacoBasePath, 'vs', 'editor', 'editor.main.css'))

    // 日志记录初始代码片段内容是否为空
    // console.log(`初始化WebView，代码片段[${snippet.id}]内容${snippet.code ? '非空' : '为空'}`)
    if (snippet.code) {
      // console.log(`代码片段内容前50个字符: "${snippet.code.substring(0, 50)}..."`)
    }

    const nonce = this.getNonce()

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="
          default-src 'none';
          script-src 'nonce-${nonce}' ${webview.cspSource} 'unsafe-eval'; 
          style-src ${webview.cspSource} 'unsafe-inline'; 
          font-src ${webview.cspSource};
          img-src ${webview.cspSource} data:;
        ">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>编辑代码片段</title>
        <link rel="stylesheet" href="${monacoMainCss}">
        <style nonce="${nonce}">
          body, html { margin: 0; padding: 0; height: 100%; overflow: hidden; display: flex; flex-direction: column; font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background);}
          #editor-container { flex-grow: 1; }
          .controls { 
            padding: 8px 12px; 
            background-color: var(--vscode-sideBar-background, #252526); 
            border-bottom: 1px solid var(--vscode-editorWidget-border, #454545); 
            display: flex; 
            align-items: center; 
            min-height: 40px;
            position: relative;
            z-index: 1001; /* 确保控制栏在调试面板之上 */
          }
          #save-button {
            padding: 4px 12px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: 1px solid var(--vscode-button-border, var(--vscode-button-background));
            border-radius: 2px;
            cursor: pointer;
            font-weight: normal;
            outline: none;
            margin-right: 10px;
          }
          #save-button:hover {
            background-color: var(--vscode-button-hoverBackground);
          }
          #save-button:focus {
            border-color: var(--vscode-focusBorder);
          }
          .status-message {
            margin-left: 15px;
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
          }
          #debug-info {
            position: fixed;
            top: 60px; /* 调整位置，避免遮挡控制栏 */
            right: 5px;
            background-color: rgba(30, 30, 30, 0.9);
            color: #ffffff;
            padding: 8px;
            border-radius: 4px;
            font-size: 0.8em;
            max-width: 350px;
            max-height: 250px;
            overflow: auto;
            z-index: 1000; /* 降低z-index，避免遮挡按钮 */
            display: none; /* 默认隐藏调试面板 */
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
          }
          .language-selector-container {
            display: flex;
            align-items: center;
            margin-right: 15px;
          }
          .language-selector-label {
            margin-right: 8px;
            color: var(--vscode-foreground);
          }
          #language-select {
            background-color: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            padding: 4px 8px;
            border-radius: 2px;
            outline: none;
          }
          #language-select:focus {
            border-color: var(--vscode-focusBorder);
          }
          #debug-toggle {
            margin-left: auto; /* 推到控制栏右侧 */
            padding: 4px 8px;
            background-color: var(--vscode-button-secondaryBackground, #3a3d41);
            color: var(--vscode-button-secondaryForeground, #ffffff);
            border: 1px solid var(--vscode-button-border, transparent);
            border-radius: 2px;
            cursor: pointer;
            font-size: 0.9em;
            outline: none;
          }
          #debug-toggle:hover {
            background-color: var(--vscode-button-secondaryHoverBackground, #45494e);
          }
        </style>
      </head>
      <body>
        <div class="controls">
          <button id="save-button" nonce="${nonce}">保存代码片段 (Ctrl+S)</button>
          <div class="language-selector-container">
            <label class="language-selector-label" for="language-select">语言:</label>
            <select id="language-select">
              <option value="plaintext">纯文本</option>
              <option value="typescript">TypeScript</option>
              <option value="javascript">JavaScript</option>
              <option value="html">HTML</option>
              <option value="css">CSS</option>
              <option value="json">JSON</option>
              <option value="vue">Vue</option>
              <option value="python">Python</option>
              <option value="java">Java</option>
              <option value="csharp">C#</option>
              <option value="cpp">C++</option>
              <option value="go">Go</option>
              <option value="php">PHP</option>
              <option value="ruby">Ruby</option>
              <option value="rust">Rust</option>
              <option value="sql">SQL</option>
              <option value="markdown">Markdown</option>
              <option value="yaml">YAML</option>
              <option value="shell">Shell</option>
            </select>
          </div>
          <span id="status-message" class="status-message"></span>
          <button id="debug-toggle">显示调试信息</button>
        </div>
        <div id="editor-container"></div>
        <div id="debug-info"></div>

        <script nonce="${nonce}" src="${monacoLoaderUri}"></script>
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          let editor;
          let currentSnippetId = "${this.getSnippetId(snippet)}"; 
          let currentLanguage = ""; 
          let internalDirtyFlag = false;
          let saveInProgress = false;
          const statusMessageElement = document.getElementById('status-message');
          const debugInfoElement = document.getElementById('debug-info');
          const languageSelect = document.getElementById('language-select');
          let isDebugVisible = false; // 默认隐藏调试面板
          
          // 调试日志函数
          function debugLog(message) {
            console.log(message);
            if (debugInfoElement) {
              debugInfoElement.innerHTML += message + '<br>';
              debugInfoElement.scrollTop = debugInfoElement.scrollHeight;
            }
          }

          // 初始化调试面板状态
          debugInfoElement.style.display = 'none';
          
          // 初始化调试面板切换按钮
          document.getElementById('debug-toggle').addEventListener('click', () => {
            isDebugVisible = !isDebugVisible;
            debugInfoElement.style.display = isDebugVisible ? 'block' : 'none';
          });

          function updateStatus(message, isError = false) {
            if (statusMessageElement) {
              statusMessageElement.textContent = message;
              statusMessageElement.style.color = isError ? 'var(--vscode-errorForeground)' : 'var(--vscode-descriptionForeground)';
              if (message) {
                setTimeout(() => { if (statusMessageElement.textContent === message) statusMessageElement.textContent = ''; }, 3000);
              }
            }
          }
          
          // 初始化语言选择器
          languageSelect.addEventListener('change', function() {
            if (!editor) return;
            
            debugLog('语言切换: ' + currentLanguage + ' -> ' + this.value);
            currentLanguage = this.value;
            
            // 更新Monaco编辑器的语言模式
            monaco.editor.setModelLanguage(editor.getModel(), currentLanguage);
            
            // 标记为已修改
            internalDirtyFlag = true;
            
            // 通知扩展语言已更改
            vscode.postMessage({
              type: 'contentChanged',
              snippetId: currentSnippetId,
              data: { 
                code: editor.getValue(),
                language: currentLanguage 
              }
            });
            
            updateStatus('语言已更改为: ' + currentLanguage);
          });

          debugLog('WebView 初始化完成');
          debugLog('Snippet ID: ' + currentSnippetId);
          debugLog('发送 ready 消息到扩展');
          vscode.postMessage({ type: 'ready', snippetId: currentSnippetId });

          window.addEventListener('message', event => {
            const message = event.data;
            debugLog('收到消息: ' + JSON.stringify(message.type));
            
            if (message.snippetId && message.snippetId !== currentSnippetId) {
              debugLog('消息 snippetId 不匹配，忽略: ' + message.snippetId);
              return;
            }

            switch (message.type) {
              case 'loadSnippet':
                debugLog('收到 loadSnippet 消息');
                debugLog('代码长度: ' + (message.data.code ? message.data.code.length : 0));
                debugLog('语言: ' + message.data.language);
                
                // 更新当前语言并设置选择器的值
                currentLanguage = message.data.language;
                
                // 设置语言选择器的初始值
                if (languageSelect && currentLanguage) {
                  const languageOption = Array.from(languageSelect.options).find(
                    option => option.value.toLowerCase() === currentLanguage.toLowerCase()
                  );
                  if (languageOption) {
                    languageSelect.value = languageOption.value;
                    debugLog('语言选择器设置为: ' + languageOption.value);
                  } else {
                    debugLog('警告: 未找到匹配的语言选项: ' + currentLanguage);
                    if (currentLanguage && currentLanguage.trim() !== '') {
                      const newOption = document.createElement('option');
                      newOption.value = currentLanguage;
                      newOption.text = currentLanguage.charAt(0).toUpperCase() + currentLanguage.slice(1);
                      languageSelect.add(newOption);
                      languageSelect.value = currentLanguage;
                      debugLog('已添加新的语言选项: ' + currentLanguage);
                    }
                  }
                }
                
                try {
                  const monacoPath = "${monacoBaseWebViewUri.toString().replace(/\\\\/g, '/')}";
                  debugLog('Monaco 基础路径: ' + monacoPath);
                  
                  // 直接配置Monaco Editor的路径
                  require.config({ paths: { 'vs': monacoPath + '/vs' } });
                
                  window.MonacoEnvironment = {
                    getWorkerUrl: function (moduleId, label) {
                      const workerPath = monacoPath + '/vs/base/worker/workerMain.js';
                      debugLog('Worker URL: ' + workerPath);
                      return workerPath;
                    }
                  };

                  // 加载Monaco Editor
                  require(['vs/editor/editor.main'], function () {
                    debugLog('Monaco成功加载');
                    
                    if (editor) { 
                      debugLog('销毁现有编辑器');
                      editor.dispose(); 
                    }
                    
                    try {
                      debugLog('创建 Monaco 编辑器实例');
                      const editorContainer = document.getElementById('editor-container');
                      if (!editorContainer) {
                        debugLog('错误: 找不到编辑器容器元素!');
                        return;
                      }
                      
                      debugLog('编辑器容器尺寸: ' + editorContainer.offsetWidth + 'x' + editorContainer.offsetHeight);
                      
                      const initialCode = message.data.code || '';
                      debugLog('初始代码内容长度: ' + initialCode.length);
                      if (initialCode.length > 0) {
                        debugLog('代码内容前50个字符: "' + initialCode.substring(0, 50) + '..."');
                      }
                      
                      editor = monaco.editor.create(editorContainer, {
                        value: initialCode,
                        language: currentLanguage,
                        theme: document.body.classList.contains('vscode-dark') ? 'vs-dark' : 
                               (document.body.classList.contains('vscode-high-contrast') ? 'hc-black' : 'vs'),
                        automaticLayout: true,
                        wordWrap: 'on',
                        minimap: { enabled: true },
                        scrollbar: {
                          useShadows: false,
                          verticalScrollbarSize: 10,
                          horizontalScrollbarSize: 10
                        }
                      });
                      
                      debugLog('Monaco 编辑器实例创建成功');
                      
                      // 设置编辑器事件监听器
                      editor.onDidChangeModelContent(() => {
                        internalDirtyFlag = true;
                        vscode.postMessage({ 
                          type: 'contentChanged', 
                          snippetId: currentSnippetId, 
                          data: { 
                            code: editor.getValue(),
                            language: currentLanguage
                          } 
                        });
                        updateStatus('未保存的更改');
                        debugLog('内容已更改，已发送 contentChanged 消息');
                      });

                      // 【修复】使用多种方式绑定 Ctrl+S 快捷键
                      
                      // 方法1: Monaco Editor 内置命令绑定
                      try {
                        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function() {
                          debugLog('🎯 Monaco快捷键: 检测到 Ctrl+S');
                          if (!saveInProgress) {
                            saveContent('shortcut');
                          }
                          return null; // 阻止默认行为
                        });
                                                 debugLog('✅ Monaco快捷键绑定成功');
                       } catch (monacoKeyError) {
                         debugLog('❌ Monaco快捷键绑定失败: ' + monacoKeyError);
                       }
                      
                      debugLog('编辑器事件监听器设置完成');
                      updateStatus('编辑器已准备就绪');
                      
                    } catch (error) {
                      debugLog('创建编辑器实例出错: ' + error.toString());
                      updateStatus('创建编辑器失败', true);
                    }
                  }, function(error) {
                    debugLog('Monaco加载失败: ' + JSON.stringify(error));
                    updateStatus('Monaco编辑器加载失败', true);
                    // 错误时自动显示调试面板
                    isDebugVisible = true;
                    debugInfoElement.style.display = 'block';
                  });
                  
                } catch (error) {
                  debugLog('Monaco配置错误: ' + (error.message || error));
                  updateStatus('Monaco配置错误，请查看调试信息', true);
                  // 错误时自动显示调试面板
                  isDebugVisible = true;
                  debugInfoElement.style.display = 'block';
                }
                break;
              case 'saveSuccess':
                const saveMethod = message.saveMethod || 'unknown';
                debugLog('保存成功 (方式: ' + saveMethod + ')');
                internalDirtyFlag = false; 
                saveInProgress = false;
                const successMessage = saveMethod === 'shortcut' ? '已保存! (Ctrl+S)' : '已保存!';
                updateStatus(successMessage);
                break;
              case 'saveError':
                const errorSaveMethod = message.saveMethod || 'unknown';
                const errorDetails = message.error || '未知错误';
                debugLog('保存失败 (方式: ' + errorSaveMethod + '): ' + errorDetails);
                saveInProgress = false;
                const errorMessage = errorSaveMethod === 'shortcut' ? '保存失败! (Ctrl+S)' : '保存失败!';
                updateStatus(errorMessage, true);
                // 显示详细错误信息
                debugLog('错误详情: ' + errorDetails);
                break;
            }
          });

                    function saveContent(saveMethod = 'button') {
            if (editor && internalDirtyFlag && !saveInProgress) {
              saveInProgress = true;
              const statusMessage = saveMethod === 'shortcut' ? '正在保存... (Ctrl+S)' : '正在保存...';
              updateStatus(statusMessage);
              const codeToSave = editor.getValue();
              debugLog('保存内容，长度: ' + codeToSave.length + ' (方式: ' + saveMethod + ')');
              debugLog('保存语言: ' + currentLanguage);
              
              vscode.postMessage({
                type: 'saveSnippet',
                snippetId: currentSnippetId,
                data: {
                  code: codeToSave,
                  language: currentLanguage,
                  saveMethod: saveMethod
                }
              });
              
            } else if (editor && !internalDirtyFlag && !saveInProgress) {
                const noChangeMessage = saveMethod === 'shortcut' ? '内容未更改 (Ctrl+S)' : '内容未更改';
                updateStatus(noChangeMessage);
                debugLog('内容未更改，不需要保存 (方式: ' + saveMethod + ')');
             } else if (saveInProgress) {
                updateStatus('保存正在进行中...');
                debugLog('保存已在进行中，忽略重复请求 (方式: ' + saveMethod + ')');
             }
          }
          
          document.getElementById('save-button').addEventListener('click', () => {
             if (!saveInProgress) saveContent('button');
          });

          window.addEventListener('beforeunload', (event) => {
            if (internalDirtyFlag && editor && !saveInProgress) {
              debugLog('beforeunload: 内容有改动，准备自动保存');
            }
          });

        </script>
      </body>
      </html>`
  }
}
