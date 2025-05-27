import * as vscode from 'vscode'
import { CodeSnippet } from '../types/types'
import { ConflictInfo } from '../utils/diffMergeManager'

export class ConflictResolutionWebviewProvider {
  private static currentPanel: vscode.WebviewPanel | undefined

  public static async showConflictResolution(
    conflicts: ConflictInfo[],
    localSnippet: CodeSnippet,
    remoteSnippet: CodeSnippet
  ): Promise<CodeSnippet | null> {
    return new Promise((resolve) => {
      const panel = vscode.window.createWebviewPanel(
        'conflictResolution',
        `解决冲突: ${localSnippet.name}`,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      )

      this.currentPanel = panel

      panel.webview.html = this.getWebviewContent(conflicts, localSnippet, remoteSnippet)

      // 处理来自webview的消息
      panel.webview.onDidReceiveMessage((message) => {
        switch (message.type) {
          case 'resolveConflict':
            resolve(message.result)
            panel.dispose()
            break
          case 'cancel':
            resolve(null)
            panel.dispose()
            break
        }
      })

      panel.onDidDispose(() => {
        this.currentPanel = undefined
        resolve(null)
      })
    })
  }

  private static getWebviewContent(
    conflicts: ConflictInfo[],
    localSnippet: CodeSnippet,
    remoteSnippet: CodeSnippet
  ): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>解决冲突</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
        }
        
        .conflict-header {
            background: var(--vscode-editor-selectionBackground);
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
        }
        
        .conflict-item {
            margin-bottom: 20px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 5px;
            overflow: hidden;
        }
        
        .conflict-field {
            background: var(--vscode-editor-lineHighlightBackground);
            padding: 10px;
            font-weight: bold;
        }
        
        .conflict-comparison {
            display: flex;
            height: 300px;
        }
        
        .conflict-side {
            flex: 1;
            display: flex;
            flex-direction: column;
        }
        
        .conflict-side-header {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            padding: 8px 12px;
            font-weight: bold;
            text-align: center;
        }
        
        .conflict-side.local .conflict-side-header {
            background: var(--vscode-gitDecoration-modifiedResourceForeground);
        }
        
        .conflict-side.remote .conflict-side-header {
            background: var(--vscode-gitDecoration-addedResourceForeground);
        }
        
        .conflict-content {
            flex: 1;
            padding: 10px;
            background: var(--vscode-editor-background);
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            white-space: pre-wrap;
            overflow-y: auto;
            border-left: 3px solid transparent;
        }
        
        .conflict-side.local .conflict-content {
            border-left-color: var(--vscode-gitDecoration-modifiedResourceForeground);
        }
        
        .conflict-side.remote .conflict-content {
            border-left-color: var(--vscode-gitDecoration-addedResourceForeground);
        }
        
        .merge-editor {
            margin-top: 20px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 5px;
        }
        
        .merge-editor-header {
            background: var(--vscode-editor-lineHighlightBackground);
            padding: 10px;
            font-weight: bold;
        }
        
        .merge-editor-content {
            height: 300px;
        }
        
        .merge-editor textarea {
            width: 100%;
            height: 100%;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            border: none;
            padding: 10px;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            resize: none;
            outline: none;
        }
        
        .action-buttons {
            margin-top: 20px;
            display: flex;
            gap: 10px;
            justify-content: center;
        }
        
        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 14px;
        }
        
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .btn:hover {
            opacity: 0.8;
        }
        
        .field-conflicts {
            margin-bottom: 20px;
        }
        
        .field-conflict {
            background: var(--vscode-inputValidation-warningBackground);
            border: 1px solid var(--vscode-inputValidation-warningBorder);
            padding: 10px;
            margin-bottom: 10px;
            border-radius: 3px;
        }
        
        .field-conflict-name {
            font-weight: bold;
            color: var(--vscode-inputValidation-warningForeground);
        }
        
        .field-values {
            display: flex;
            gap: 20px;
            margin-top: 8px;
        }
        
        .field-value {
            flex: 1;
        }
        
        .field-value-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
        }
        
        .field-value-content {
            background: var(--vscode-editor-background);
            padding: 8px;
            border-radius: 3px;
            font-family: monospace;
        }
    </style>
</head>
<body>
    <div class="conflict-header">
        <h2>🔀 代码片段冲突解决</h2>
        <p>代码片段 "<strong>${localSnippet.name}</strong>" 在本地和远程都有修改，请选择解决方式。</p>
    </div>

    ${
      conflicts.filter((c) => c.field !== 'code').length > 0
        ? `
    <div class="field-conflicts">
        <h3>字段冲突</h3>
        ${conflicts
          .filter((c) => c.field !== 'code')
          .map(
            (conflict) => `
        <div class="field-conflict">
            <div class="field-conflict-name">${conflict.field}</div>
            <div class="field-values">
                <div class="field-value">
                    <div class="field-value-label">本地值</div>
                    <div class="field-value-content">${JSON.stringify(conflict.localValue)}</div>
                </div>
                <div class="field-value">
                    <div class="field-value-label">远程值</div>
                    <div class="field-value-content">${JSON.stringify(conflict.remoteValue)}</div>
                </div>
            </div>
        </div>
        `
          )
          .join('')}
    </div>
    `
        : ''
    }

    ${
      conflicts.some((c) => c.field === 'code')
        ? `
    <div class="conflict-item">
        <div class="conflict-field">代码内容冲突</div>
        <div class="conflict-comparison">
            <div class="conflict-side local">
                <div class="conflict-side-header">本地版本</div>
                <div class="conflict-content">${this.escapeHtml(localSnippet.code)}</div>
            </div>
            <div class="conflict-side remote">
                <div class="conflict-side-header">远程版本</div>
                <div class="conflict-content">${this.escapeHtml(remoteSnippet.code)}</div>
            </div>
        </div>
    </div>

    <div class="merge-editor">
        <div class="merge-editor-header">手动合并编辑器</div>
        <div class="merge-editor-content">
            <textarea id="mergeEditor" placeholder="在此编辑合并后的代码...">${this.escapeHtml(
              localSnippet.code
            )}</textarea>
        </div>
    </div>
    `
        : ''
    }

    <div class="action-buttons">
        <button class="btn btn-primary" onclick="useLocal()">保留本地版本</button>
        <button class="btn btn-primary" onclick="useRemote()">保留远程版本</button>
        ${
          conflicts.some((c) => c.field === 'code')
            ? `
        <button class="btn btn-primary" onclick="useManualMerge()">使用手动合并</button>
        `
            : ''
        }
        <button class="btn btn-secondary" onclick="cancel()">跳过</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function useLocal() {
            vscode.postMessage({
                type: 'resolveConflict',
                result: ${JSON.stringify(localSnippet)}
            });
        }
        
        function useRemote() {
            vscode.postMessage({
                type: 'resolveConflict',
                result: ${JSON.stringify(remoteSnippet)}
            });
        }
        
        function useManualMerge() {
            const mergedCode = document.getElementById('mergeEditor').value;
            const result = {
                ...${JSON.stringify(localSnippet)},
                code: mergedCode,
                // 对于字段冲突，使用远程值作为默认
                ${conflicts
                  .filter((c) => c.field !== 'code')
                  .map((c) => `${c.field}: ${JSON.stringify(c.remoteValue)}`)
                  .join(',\n                ')}
            };
            
            vscode.postMessage({
                type: 'resolveConflict',
                result: result
            });
        }
        
        function cancel() {
            vscode.postMessage({
                type: 'cancel'
            });
        }
    </script>
</body>
</html>`
  }

  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
}
