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
        
        return new Promise((resolve) => {
            const disposable = vscode.workspace.onDidSaveTextDocument(async (doc) => {
                if (doc === document) {
                    const updatedSnippet = {
                        ...snippet,
                        code: doc.getText()
                    };
                    disposable.dispose();
                    resolve(updatedSnippet);
                }
            });
        });
    }
}