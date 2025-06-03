import * as vscode from 'vscode'
import { SettingsManager } from '../utils/settingsManager'

export class HistoryWebviewProvider {
  public static readonly viewType = 'starcode-snippets.history'
  private static currentPanel: vscode.WebviewPanel | undefined

  private constructor() {}

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined

    // 如果已经有历史记录面板打开，就激活它
    if (HistoryWebviewProvider.currentPanel) {
      HistoryWebviewProvider.currentPanel.reveal(column)
      return
    }

    // 创建新的WebView面板
    const panel = vscode.window.createWebviewPanel(
      HistoryWebviewProvider.viewType,
      '同步历史记录',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: true,
      }
    )

    HistoryWebviewProvider.currentPanel = panel
    const provider = new HistoryWebviewProvider()
    provider._setupWebview(panel, extensionUri)

    // 当面板被关闭时，清理引用
    panel.onDidDispose(() => {
      HistoryWebviewProvider.currentPanel = undefined
    }, null)
  }

  private _setupWebview(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    panel.webview.html = this._getHtmlForWebview(panel.webview, extensionUri)

    // 处理来自webview的消息
    panel.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'openGitLog':
          await this._openGitLog()
          break
        case 'openSyncSettings':
          await this._openSyncSettings()
          break
      }
    })
  }

  private async _openGitLog() {
    try {
      const config = SettingsManager.getCloudSyncConfig()
      if (!config.localPath) {
        vscode.window.showWarningMessage('请先配置本地Git仓库路径')
        return
      }

      // 打开Git仓库文件夹
      const folderUri = vscode.Uri.file(config.localPath)
      await vscode.commands.executeCommand('vscode.openFolder', folderUri, { forceNewWindow: true })
      
      // 然后用户可以使用VS Code内置的Git功能查看历史
      vscode.window.showInformationMessage(
        '已打开Git仓库文件夹。您可以使用VS Code的源代码管理面板查看Git历史记录。',
        '了解更多'
      ).then(selection => {
        if (selection === '了解更多') {
          vscode.env.openExternal(vscode.Uri.parse('https://code.visualstudio.com/docs/sourcecontrol/overview'))
        }
      })
    } catch (error) {
      vscode.window.showErrorMessage(`打开Git仓库失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  private async _openSyncSettings() {
    await vscode.commands.executeCommand('starcode-snippets.openSettings')
  }

  private _getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>同步历史记录</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 40px;
            margin: 0;
            line-height: 1.6;
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
            text-align: center;
        }

        .header {
            margin-bottom: 40px;
        }

        .header h1 {
            margin: 0 0 10px 0;
            font-size: 28px;
            font-weight: 600;
        }

        .migration-notice {
            background-color: var(--vscode-notificationsInfoIcon-foreground);
            color: var(--vscode-editor-background);
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
        }

        .migration-notice h3 {
            margin: 0 0 15px 0;
            font-size: 18px;
        }

        .migration-notice p {
            margin: 0 0 10px 0;
        }

        .feature-section {
            margin: 30px 0;
            padding: 20px;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 8px;
            background-color: var(--vscode-sideBar-background);
        }

        .feature-section h3 {
            margin: 0 0 15px 0;
            color: var(--vscode-textLink-foreground);
        }

        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-family: inherit;
            font-size: inherit;
            margin: 5px;
            transition: background-color 0.2s;
        }

        .btn-primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .btn-primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .git-features {
            text-align: left;
            margin: 20px 0;
        }

        .git-features ul {
            margin: 10px 0;
            padding-left: 20px;
        }

        .git-features li {
            margin: 5px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 同步历史记录</h1>
        </div>

        <div class="migration-notice">
            <h3>🎉 升级到 Git 同步</h3>
            <p>StarCode Snippets 现在使用 Git 进行代码片段同步，提供更强大的版本控制功能！</p>
            <p>Git 提供了比之前的同步方式更完整、更可靠的历史记录管理。</p>
        </div>

        <div class="feature-section">
            <h3>🔍 查看 Git 历史记录</h3>
            <p>使用 Git 的强大历史功能查看您的代码片段变更记录：</p>
            <div class="git-features">
                <ul>
                    <li>✅ 完整的提交历史</li>
                    <li>✅ 详细的变更对比</li>
                    <li>✅ 分支和标签管理</li>
                    <li>✅ 回滚到任意版本</li>
                    <li>✅ 协作和冲突解决</li>
                </ul>
            </div>
            <button id="openGitLogBtn" class="btn btn-primary">📂 打开 Git 仓库</button>
            <p style="margin-top: 15px; font-size: 14px; color: var(--vscode-descriptionForeground);">
                这将打开您的本地 Git 仓库，您可以使用 VS Code 内置的源代码管理功能查看完整的历史记录。
            </p>
        </div>

        <div class="feature-section">
            <h3>⚙️ 配置 Git 同步</h3>
            <p>如果您还没有配置 Git 同步，请前往设置页面进行配置：</p>
            <button id="openSettingsBtn" class="btn btn-secondary">🔧 打开同步设置</button>
        </div>

        <div class="feature-section">
            <h3>💡 Git 历史记录使用提示</h3>
            <div class="git-features">
                <p><strong>在 VS Code 中查看 Git 历史：</strong></p>
                <ul>
                    <li>使用源代码管理面板 (Ctrl+Shift+G)</li>
                    <li>安装 GitLens 扩展获得更丰富的功能</li>
                    <li>使用终端运行 <code>git log</code> 命令</li>
                    <li>右键文件选择"查看文件历史记录"</li>
                </ul>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        document.getElementById('openGitLogBtn').addEventListener('click', () => {
            vscode.postMessage({
                type: 'openGitLog'
            });
        });

        document.getElementById('openSettingsBtn').addEventListener('click', () => {
            vscode.postMessage({
                type: 'openSyncSettings'
            });
        });
    </script>
</body>
</html>`
  }
}
