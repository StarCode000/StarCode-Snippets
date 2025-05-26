// src/editor/snippetEditor.ts
import * as vscode from 'vscode'
import { CodeSnippet } from '../models/types'
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
  // Key: snippet.id, Value: { snippet: CodeSnippet, panel: vscode.WebviewPanel, currentCode: string, lastSavedCode: string, isDirtyInWebview: boolean }
  private editingWebviews = new Map<string, { snippet: CodeSnippet, panel: vscode.WebviewPanel, currentCode: string, lastSavedCode: string, isDirtyInWebview: boolean }>()
  
  private _onDidSaveSnippet = new vscode.EventEmitter<CodeSnippet>()
  public readonly onDidSaveSnippet = this._onDidSaveSnippet.event

  private constructor(context: vscode.ExtensionContext, storageManager: StorageManager) {
    this.extensionContext = context;
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
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  public async edit(snippet: CodeSnippet): Promise<void> {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    const existingSession = this.editingWebviews.get(snippet.id);
    if (existingSession) {
      existingSession.panel.reveal(column);
      return;
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
            vscode.Uri.joinPath(this.extensionContext.extensionUri, 'dist', 'monaco-editor'),
            vscode.Uri.joinPath(this.extensionContext.extensionUri, 'dist', 'monaco-editor', 'node_modules'),
            vscode.Uri.joinPath(this.extensionContext.extensionUri, 'dist', 'monaco-editor', 'node_modules', 'monaco-editor'),
            vscode.Uri.joinPath(this.extensionContext.extensionUri, 'dist', 'monaco-editor', 'node_modules', 'monaco-editor', 'min'),
            vscode.Uri.joinPath(this.extensionContext.extensionUri, 'media') // 如果有其他media资源
        ]
      }
    );
    
    const initialCode = snippet.code || '';
    const session = {
      snippet,
      panel,
      currentCode: initialCode,
      lastSavedCode: initialCode,
      isDirtyInWebview: false, // Webview会通过消息更新这个状态
    };
    this.editingWebviews.set(snippet.id, session);

    panel.webview.html = this._getWebviewContent(panel.webview, snippet);

    panel.onDidDispose(() => {
      const disposedSession = this.editingWebviews.get(snippet.id);
      if (disposedSession && disposedSession.isDirtyInWebview) {
        console.log(`Webview for ${snippet.name} disposed with unsaved changes. Auto-saving.`);
        // 自动保存逻辑
        const codeToSave = disposedSession.currentCode; // 使用webview同步过来的最新代码
        const languageToSave = this.mapVSCodeLanguageIdToOurs(
            this.mapLanguageToVSCode(disposedSession.snippet.language || 'plaintext'), // 假设webview用的也是这个
            disposedSession.snippet.language
        );
        const updatedSnippet: CodeSnippet = {
          ...disposedSession.snippet,
          code: codeToSave,
          language: languageToSave,
        };
        this.storageManager.updateSnippet(updatedSnippet)
          .then(() => {
            this._onDidSaveSnippet.fire(updatedSnippet);
            console.log(`代码片段 "${updatedSnippet.name}" 已在关闭时自动保存。`);
          })
          .catch(error => {
            console.error(`关闭时自动保存代码片段 "${updatedSnippet.name}" 失败:`, error);
            vscode.window.showErrorMessage(`关闭时自动保存代码片段 "${updatedSnippet.name}" 失败。`);
          });
      }
      this.editingWebviews.delete(snippet.id);
      if (this.editingWebviews.size === 0) {
        ContextManager.setEditingSnippet(false);
      }
    }, null, this.extensionContext.subscriptions);

    panel.webview.onDidReceiveMessage(
      async message => {
        console.log('收到WebView消息:', message.type, message.snippetId);
        
        const currentSession = this.editingWebviews.get(message.snippetId || snippet.id); 
        if (!currentSession) {
            console.warn('Received message for non-existent session:', message.snippetId);
            return;
        }

        switch (message.type) {
          case 'ready': 
            console.log('收到WebView ready消息，准备发送代码片段数据');
            console.log('代码片段内容长度:', currentSession.currentCode.length);
            if (currentSession.currentCode) {
              console.log('代码片段内容前50个字符:', currentSession.currentCode.substring(0, 50));
            }
            
            panel.webview.postMessage({
                type: 'loadSnippet',
                data: {
                    code: currentSession.currentCode, 
                    language: this.mapLanguageToVSCode(currentSession.snippet.language || 'plaintext'),
                    snippetId: currentSession.snippet.id,
                }
            });
            console.log('已发送loadSnippet消息到WebView');
            break;
          case 'saveSnippet':
            {
              const codeToSave = message.data.code;
              const languageFromWebview = message.data.language; 
              const languageToSave = this.mapVSCodeLanguageIdToOurs(languageFromWebview, currentSession.snippet.language);
              
              currentSession.currentCode = codeToSave;

              const updatedSnippet: CodeSnippet = {
                ...currentSession.snippet,
                code: codeToSave,
                language: languageToSave,
              };
              try {
                await this.storageManager.updateSnippet(updatedSnippet);
                currentSession.snippet = updatedSnippet; 
                currentSession.lastSavedCode = codeToSave;
                currentSession.isDirtyInWebview = false; 
                this._onDidSaveSnippet.fire(updatedSnippet);
                vscode.window.showInformationMessage(`代码片段 "${updatedSnippet.name}" 已保存。`);
                panel.webview.postMessage({ type: 'saveSuccess', snippetId: currentSession.snippet.id }); 
              } catch (error) {
                console.error('保存代码片段失败 (来自webview):', error);
                vscode.window.showErrorMessage(`保存代码片段 "${updatedSnippet.name}" 失败。`);
                panel.webview.postMessage({ type: 'saveError', snippetId: currentSession.snippet.id });
              }
              break;
            }
          case 'contentChanged': 
            {
              currentSession.currentCode = message.data.code;
              currentSession.isDirtyInWebview = true; 
              break;
            }
        }
      },
      null,
      this.extensionContext.subscriptions
    );
    
    ContextManager.setEditingSnippet(true);
  }

  private mapLanguageToVSCode(language: string): string {
    switch (language.toLowerCase()) {
      case 'vue': return 'html'; 
      case 'shell': return 'shellscript';
      case 'c#': case 'csharp': return 'csharp';
      case 'c++': case 'cpp': return 'cpp';
      case 'yaml': case 'yml': return 'yaml';
      default: return language;
    }
  }
  
  private mapVSCodeLanguageIdToOurs(vscodeLangId: string, originalLanguage?: string): string {
    if (originalLanguage) {
      const lowerOriginal = originalLanguage.toLowerCase();
      if (vscodeLangId === 'html' && lowerOriginal === 'vue') return 'vue';
      if (vscodeLangId === 'shellscript' && lowerOriginal === 'shell') return 'shell';
    }
    if (vscodeLangId === 'shellscript') return 'shell';
    return vscodeLangId;
  }

  private _getWebviewContent(webview: vscode.Webview, snippet: CodeSnippet): string {
    const extensionUri = this.extensionContext.extensionUri;
    
    // 修改monaco路径，指向正确的目录结构
    const monacoBasePath = vscode.Uri.joinPath(extensionUri, 'dist', 'monaco-editor', 'node_modules', 'monaco-editor', 'min');
    const monacoLoaderUri = webview.asWebviewUri(vscode.Uri.joinPath(monacoBasePath, 'vs', 'loader.js'));
    const monacoBaseWebViewUri = webview.asWebviewUri(monacoBasePath);
    
    // 日志记录初始代码片段内容是否为空
    console.log(`初始化WebView，代码片段[${snippet.id}]内容${snippet.code ? '非空' : '为空'}`);
    if (snippet.code) {
      console.log(`代码片段内容前50个字符: "${snippet.code.substring(0, 50)}..."`);
    }

    const nonce = this.getNonce();

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
        <style nonce="${nonce}">
          body, html { margin: 0; padding: 0; height: 100%; overflow: hidden; display: flex; flex-direction: column; font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background);}
          #editor-container { flex-grow: 1; }
          .controls { padding: 8px 12px; background-color: var(--vscode-sideBar-background, #252526); border-bottom: 1px solid var(--vscode-editorWidget-border, #454545); display: flex; align-items: center; }
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
            top: 5px;
            right: 5px;
            background-color: rgba(30, 30, 30, 0.8);
            color: #ffffff;
            padding: 5px;
            border-radius: 3px;
            font-size: 0.8em;
            max-width: 300px;
            max-height: 200px;
            overflow: auto;
            z-index: 9999;
            display: block; /* 默认显示调试面板 */
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
          <button id="debug-toggle">隐藏调试信息</button>
        </div>
        <div id="editor-container"></div>
        <div id="debug-info"></div>

        <script nonce="${nonce}" src="${monacoLoaderUri}"></script>
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          let editor;
          let currentSnippetId = "${snippet.id}"; 
          let currentLanguage = ""; 
          let internalDirtyFlag = false;
          let saveInProgress = false;
          const statusMessageElement = document.getElementById('status-message');
          const debugInfoElement = document.getElementById('debug-info');
          const languageSelect = document.getElementById('language-select');
          const debugToggleButton = document.getElementById('debug-toggle');
          let isDebugVisible = true; // 默认显示调试面板
          
          // 添加全局错误处理
          window.onerror = function(message, source, lineno, colno, error) {
            debugLog('Error: ' + message + ' at ' + source + ':' + lineno + ':' + colno);
            if (error && error.stack) {
              debugLog('Stack: ' + error.stack);
            }
            return false;
          };
          
          // 添加资源加载错误处理
          window.addEventListener('error', function(e) {
            if (e.target && (e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK')) {
              debugLog('Resource error: ' + e.target.src || e.target.href);
            }
          }, true);
          
          // 初始化调试面板切换按钮
          debugToggleButton.addEventListener('click', () => {
            isDebugVisible = !isDebugVisible;
            debugInfoElement.style.display = isDebugVisible ? 'block' : 'none';
            debugToggleButton.textContent = isDebugVisible ? '隐藏调试信息' : '显示调试信息';
            
            // 如果打开调试面板，滚动到最新的日志
            if (isDebugVisible) {
              debugInfoElement.scrollTop = debugInfoElement.scrollHeight;
            }
          });
          
          // 调试日志函数
          function debugLog(message) {
            console.log(message);
            if (debugInfoElement) {
              debugInfoElement.innerHTML += message + '<br>';
              debugInfoElement.scrollTop = debugInfoElement.scrollHeight;
            }
          }

          debugLog('WebView 初始化完成');
          debugLog('Snippet ID: ' + currentSnippetId);

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
            
            // 标记为已修改，这样关闭时会保存新的语言设置
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
                    // 对于不在列表中的语言，如果有效，添加一个新选项
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
                  // 获取正确的路径前缀
                  const monacoPath = "${monacoBaseWebViewUri.toString().replace(/\\\\/g, '/')}";
                  debugLog('Monaco 基础路径: ' + monacoPath);
                  
                  // 准备多个可能的路径
                  const possiblePaths = [
                    monacoPath + '/vs',                            // 直接在当前目录
                    monacoPath.replace('/min', '') + '/vs',        // 不包含min
                    monacoPath.replace('/min', '/vs'),             // min替换为vs
                    monacoPath + '/../vs'                          // 上一级目录
                  ];
                  
                  debugLog('尝试以下路径:');
                  possiblePaths.forEach(p => debugLog(' - ' + p));
                  
                  // 添加一个尝试不同路径的加载函数
                  function tryLoadMonaco(pathIndex) {
                    if (pathIndex >= possiblePaths.length) {
                      debugLog('所有路径都尝试失败，无法加载Monaco');
                      updateStatus('无法加载编辑器，请查看调试信息', true);
                      isDebugVisible = true;
                      debugInfoElement.style.display = 'block';
                      debugToggleButton.textContent = '隐藏调试信息';
                      return;
                    }
                    
                    const currentPath = possiblePaths[pathIndex];
                    debugLog('尝试路径 ' + (pathIndex + 1) + '/' + possiblePaths.length + ': ' + currentPath);
                    
                    // 更新配置
                    require.config({ paths: { 'vs': currentPath } });
                    
                    window.MonacoEnvironment = {
                      getWorkerUrl: function (moduleId, label) {
                        const workerPath = currentPath + '/base/worker/workerMain.js';
                        debugLog('Worker URL: ' + workerPath);
                        return workerPath;
                      }
                    };
                    
                    // 尝试加载
                    require(['vs/editor/editor.main'], function () {
                      debugLog('Monaco成功加载，使用路径: ' + currentPath);
                      // 继续使用现有的编辑器创建逻辑
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
                        
                        // 保存初始代码内容以便于记录
                        const initialCode = message.data.code || '';
                        debugLog('初始代码内容长度: ' + initialCode.length);
                        if (initialCode.length > 0) {
                          debugLog('代码内容前50个字符: "' + initialCode.substring(0, 50) + '..."');
                        } else {
                          debugLog('警告: 初始代码内容为空!');
                        }
                        
                        editor = monaco.editor.create(editorContainer, {
                          value: initialCode,
                          language: currentLanguage,
                          theme: document.body.classList.contains('vscode-dark') ? 'vs-dark' : (document.body.classList.contains('vscode-high-contrast') ? 'hc-black' : 'vs'),
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
                        
                        // 验证编辑器的值是否正确设置
                        setTimeout(() => {
                          const currentValue = editor.getValue();
                          debugLog('编辑器内容长度(延迟检查): ' + currentValue.length);
                          if (currentValue.length === 0 && initialCode.length > 0) {
                            debugLog('警告: 编辑器内容为空，但初始代码不为空!');
                          }
                        }, 500);
                      } catch (error) {
                        debugLog('创建编辑器实例出错: ' + error.toString());
                        console.error('创建编辑器错误:', error);
                      }

                      try {
                        debugLog('设置编辑器事件监听器');
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

                        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KEY_S, function() {
                          debugLog('检测到 Ctrl+S 快捷键');
                          if (!saveInProgress) saveContent();
                        });
                        debugLog('编辑器事件监听器设置完成');
                      } catch (error) {
                        debugLog('设置事件监听器出错: ' + error.toString());
                      }
                    }, function(error) {
                      debugLog('路径 ' + currentPath + ' 加载失败: ' + JSON.stringify(error));
                      // 尝试下一个路径
                      setTimeout(() => tryLoadMonaco(pathIndex + 1), 100);
                    });
                  }
                  
                  // 开始尝试加载
                  tryLoadMonaco(0);
                } catch (error) {
                  debugLog('Monaco配置错误: ' + (error.message || error));
                  updateStatus('Monaco配置错误，请查看调试信息', true);
                  // 显示调试面板
                  isDebugVisible = true;
                  debugInfoElement.style.display = 'block';
                  debugToggleButton.textContent = '隐藏调试信息';
                }
                break;
              case 'saveSuccess':
                debugLog('保存成功');
                internalDirtyFlag = false; 
                saveInProgress = false;
                updateStatus('已保存!');
                break;
              case 'saveError':
                debugLog('保存失败');
                saveInProgress = false;
                updateStatus('保存失败!', true);
                break;
            }
          });

          function saveContent() {
            if (editor && internalDirtyFlag && !saveInProgress) {
              saveInProgress = true;
              updateStatus('正在保存...');
              const codeToSave = editor.getValue();
              debugLog('保存内容，长度: ' + codeToSave.length);
              debugLog('保存语言: ' + currentLanguage);
              vscode.postMessage({
                type: 'saveSnippet',
                snippetId: currentSnippetId,
                data: {
                  code: codeToSave,
                  language: currentLanguage 
                }
              });
            } else if (editor && !internalDirtyFlag && !saveInProgress) {
               updateStatus('内容未更改。');
               debugLog('内容未更改，不需要保存');
            }
          }
          document.getElementById('save-button').addEventListener('click', () => {
             debugLog('点击保存按钮');
             if (!saveInProgress) saveContent();
          });

          window.addEventListener('beforeunload', (event) => {
            if (internalDirtyFlag && editor && !saveInProgress) {
              debugLog('beforeunload: 内容有改动，准备自动保存');
            }
          });

        </script>
      </body>
      </html>`;
  }
}

