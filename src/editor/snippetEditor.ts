// src/editor/snippetEditor.ts
import * as vscode from 'vscode';
import { CodeSnippet } from '../models/types';
import * as path from 'path';

export class SnippetEditor {
    private static currentPanel: vscode.WebviewPanel | undefined;
    private static extensionContext: vscode.ExtensionContext;

    public static initialize(context: vscode.ExtensionContext) {
        SnippetEditor.extensionContext = context;
    }

    public static async edit(snippet: CodeSnippet): Promise<CodeSnippet | undefined> {
        if (!SnippetEditor.extensionContext) {
            throw new Error('SnippetEditor not initialized');
        }

        // 如果已经有打开的面板，先关闭它
        if (SnippetEditor.currentPanel) {
            SnippetEditor.currentPanel.dispose();
        }

        // 创建新的webview面板
        const panel = vscode.window.createWebviewPanel(
            'snippetEditor',
            `编辑: ${snippet.name}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(SnippetEditor.extensionContext.extensionUri, 'dist')
                ]
            }
        );

        SnippetEditor.currentPanel = panel;

        return new Promise<CodeSnippet | undefined>((resolve, reject) => {
            let isResolved = false;

            // 设置webview的HTML内容
            panel.webview.html = getWebviewContent(panel.webview, snippet, SnippetEditor.extensionContext);

            // 处理webview发来的消息
            panel.webview.onDidReceiveMessage(
                async (message) => {
                    switch (message.command) {
                        case 'save':
                            const updatedSnippet = {
                                ...snippet,
                                code: message.code
                            };
                            resolve(updatedSnippet);
                            break;
                        case 'cancel':
                            if (!isResolved) {
                                isResolved = true;
                                panel.dispose();
                                resolve(undefined);
                            }
                            break;
                    }
                },
                undefined,
                []
            );

            // 处理面板关闭事件
            panel.onDidDispose(() => {
                if (!isResolved) {
                    isResolved = true;
                    resolve(undefined);
                }
            });

            // 设置超时（5分钟）
            const timeout = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    panel.dispose();
                    reject(new Error('编辑会话超时'));
                }
            }, 5 * 60 * 1000);
        });
    }
}

function getWebviewContent(
    webview: vscode.Webview,
    snippet: CodeSnippet,
    context: vscode.ExtensionContext
): string {
    // 获取本地Monaco编辑器资源的URI
    const monacoBase = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'dist', 'monaco-editor')
    );

    return `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>编辑代码片段</title>
        <style>
            body {
                padding: 0;
                margin: 0;
                width: 100vw;
                height: 100vh;
                overflow: hidden;
            }
            #container {
                width: 100%;
                height: calc(100% - 40px);
            }
            #toolbar {
                height: 40px;
                display: flex;
                align-items: center;
                padding: 0 10px;
                background-color: var(--vscode-editor-background);
                border-top: 1px solid var(--vscode-panel-border);
            }
            .button {
                padding: 4px 12px;
                margin-right: 8px;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 2px;
                cursor: pointer;
            }
            .button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
        </style>
    </head>
    <body>
        <div id="container"></div>
        <div id="toolbar">
            <button class="button" onclick="saveSnippet()">保存</button>
            <button class="button" onclick="cancelEdit()">取消</button>
        </div>
        <script src="${monacoBase}/vs/loader.js"></script>
        <script>
            const vscode = acquireVsCodeApi();

            // 配置Monaco加载器
            require.config({
                paths: { vs: '${monacoBase}/vs' }
            });

            // 配置Monaco环境
            window.MonacoEnvironment = {
                getWorkerUrl: function(workerId, label) {
                    return '${monacoBase}/vs/base/worker/workerMain.js';
                }
            };

            let editor;
            require(['vs/editor/editor.main'], function() {
                editor = monaco.editor.create(document.getElementById('container'), {
                    value: ${JSON.stringify(snippet.code)},
                    language: 'typescript',
                    theme: 'vs-dark',
                    automaticLayout: true,
                    minimap: {
                        enabled: false
                    },
                    scrollBeyondLastLine: false,
                    fontSize: 14,
                    lineNumbers: 'on',
                    renderLineHighlight: 'all',
                    roundedSelection: false,
                    selectOnLineNumbers: true,
                    wordWrap: 'on'
                });

                // 添加快捷键支持
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveSnippet);
                editor.addCommand(monaco.KeyCode.Escape, cancelEdit);

                // 自动聚焦编辑器
                editor.focus();
            });

            function saveSnippet() {
                const code = editor.getValue();
                vscode.postMessage({
                    command: 'save',
                    code: code
                });
                showSaveSuccess();
            }

            function cancelEdit() {
                vscode.postMessage({
                    command: 'cancel'
                });
            }

            function showSaveSuccess() {
                const messageContainerId = 'message-container';
                let container = document.getElementById(messageContainerId);
                if (!container) {
                    container = document.createElement('div');
                    container.id = messageContainerId;
                    container.style.position = 'fixed';
                    container.style.bottom = '60px';
                    container.style.right = '20px';
                    container.style.padding = '8px 16px';
                    container.style.backgroundColor = 'var(--vscode-inputValidation-infoBackground)';
                    container.style.color = 'var(--vscode-inputValidation-infoForeground)';
                    container.style.borderRadius = '4px';
                    container.style.zIndex = '1000';
                    document.body.appendChild(container);
                }
                container.textContent = '保存成功';
                setTimeout(() => {
                    container.remove();
                }, 2000);
            }

            // 处理窗口大小变化
            window.addEventListener('resize', () => {
                if (editor) {
                    editor.layout();
                }
            });
        </script>
    </body>
    </html>`;
}