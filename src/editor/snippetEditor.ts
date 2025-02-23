// src/editor/snippetEditor.ts
import * as vscode from 'vscode';
import { CodeSnippet } from '../models/types';

export class SnippetEditor {
    public static async edit(snippet: CodeSnippet): Promise<CodeSnippet | undefined> {
        const document = await vscode.workspace.openTextDocument({
            content: snippet.code,
            language: 'typescript'
        });
        
        const editor = await vscode.window.showTextDocument(document);
        
        return new Promise<CodeSnippet | undefined>((resolve, reject) => {
            let isResolved = false;
            
            // 保存文档的事件监听器
            const saveDisposable = vscode.workspace.onDidSaveTextDocument(async (doc) => {
                if (doc === document && !isResolved) {
                    isResolved = true;
                    cleanup();
                    const updatedSnippet = {
                        ...snippet,
                        code: doc.getText()
                    };
                    resolve(updatedSnippet);
                }
            });

            // 关闭编辑器的事件监听器
            const closeDisposable = vscode.workspace.onDidCloseTextDocument(doc => {
                if (doc === document && !isResolved) {
                    isResolved = true;
                    cleanup();
                    resolve(undefined); // 用户关闭编辑器而不保存
                }
            });

            // 清理函数
            let cleanup = () => {
                saveDisposable.dispose();
                closeDisposable.dispose();
            };

            // 设置超时（5分钟）
            const timeout = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    cleanup();
                    reject(new Error('编辑会话超时'));
                }
            }, 5 * 60 * 1000);

            // 注册命令以取消编辑
            const cancelCommandDisposable = vscode.commands.registerCommand('snippetEditor.cancelEdit', () => {
                if (!isResolved) {
                    isResolved = true;
                    cleanup();
                    resolve(undefined);
                }
            });

            // 错误处理
            try {
                // 添加状态栏提示
                const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
                statusBarItem.text = "$(save) 保存代码片段 | $(x) ESC取消";
                statusBarItem.tooltip = "保存更改或按ESC取消";
                statusBarItem.show();

                // 扩展cleanup函数以包含状态栏清理
                const originalCleanup = cleanup;
                cleanup = () => {
                    originalCleanup();
                    statusBarItem.dispose();
                    cancelCommandDisposable.dispose();
                    clearTimeout(timeout);
                };
            } catch (error) {
                cleanup();
                reject(error);
            }
        });
    }
}