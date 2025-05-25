import * as vscode from 'vscode';
import { CloudSyncConfig, CloudSyncStatus } from '../models/types';
import { SettingsManager } from '../utils/settingsManager';
import { CloudSyncManager } from '../utils/cloudSyncManager';
import { StorageManager } from '../storage/storageManager';
import { ContextManager } from '../utils/contextManager';

export class SettingsWebviewProvider {
  public static readonly viewType = 'starcode-snippets.settings';
  private static currentPanel: vscode.WebviewPanel | undefined;

  private constructor() {}

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // 如果已经有设置面板打开，就激活它
    if (SettingsWebviewProvider.currentPanel) {
      SettingsWebviewProvider.currentPanel.reveal(column);
      return;
    }

    // 创建新的WebView面板
    const panel = vscode.window.createWebviewPanel(
      SettingsWebviewProvider.viewType,
      '云端同步设置',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: true
      }
    );

    SettingsWebviewProvider.currentPanel = panel;
    const provider = new SettingsWebviewProvider();
    provider._setupWebview(panel, extensionUri);

    // 当面板被关闭时，清理引用
    panel.onDidDispose(() => {
      SettingsWebviewProvider.currentPanel = undefined;
    }, null);
  }

  private _setupWebview(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    panel.webview.html = this._getHtmlForWebview(panel.webview, extensionUri);

    // 处理来自webview的消息
    panel.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'saveConfig':
          await this._saveConfig(data.config, panel);
          break;
        case 'testConnection':
          await this._testConnection(data.config, panel);
          break;
        case 'resetConfig':
          await this._resetConfig(panel);
          break;

        case 'getConfig':
          await this._sendConfigToWebview(panel);
          break;
        case 'manualSync':
          await this._performManualSync(panel);
          break;
        case 'exportSettings':
          await this._exportSettings(panel);
          break;
        case 'importSettings':
          await this._importSettings(panel);
          break;
        case 'forceResetCloudSync':
          await this._forceResetCloudSync(panel);
          break;
      }
    });

    // 初始加载配置
    this._sendConfigToWebview(panel);
  }

  private async _saveConfig(config: CloudSyncConfig, panel: vscode.WebviewPanel) {
    try {
      const validation = SettingsManager.validateConfig(config);
      if (!validation.isValid) {
        panel.webview.postMessage({
          type: 'validationError',
          errors: validation.errors
        });
        return;
      }

      await SettingsManager.saveCloudSyncConfig(config);
      
      panel.webview.postMessage({
        type: 'saveSuccess',
        message: '配置保存成功'
      });

      vscode.window.showInformationMessage('云端同步配置已保存');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '保存配置时发生错误';
      panel.webview.postMessage({
        type: 'saveError',
        message: errorMessage
      });
      vscode.window.showErrorMessage(`保存配置失败: ${errorMessage}`);
    }
  }

  private async _testConnection(config: CloudSyncConfig, panel: vscode.WebviewPanel) {
    console.log('开始连接测试...');
    try {
      panel.webview.postMessage({
        type: 'testingConnection',
        message: '正在测试连接...'
      });

      // 使用CloudSyncManager进行真实连接测试
      console.log('创建CloudSyncManager实例...');
      const context = SettingsManager.getExtensionContext();
      if (!context) {
        throw new Error('扩展上下文未初始化');
      }
      
      const cloudSyncManager = new CloudSyncManager(context);
      cloudSyncManager.updateConfig(config); // 使用最新配置
      
      console.log('调用testConnection方法...');
      const result = await cloudSyncManager.testConnection();
      console.log('连接测试结果:', result);
      
      panel.webview.postMessage({
        type: 'testResult',
        success: result.success,
        message: result.message
      });

      // 同时显示VSCode通知
      if (result.success) {
        vscode.window.showInformationMessage(`连接测试成功: ${result.message}`);
      } else {
        vscode.window.showWarningMessage(`连接测试失败: ${result.message}`);
      }

      // 更新状态
      const status = SettingsManager.getCloudSyncStatus();
      status.isConnected = result.success;
      status.lastError = result.success ? null : result.message;
      await SettingsManager.saveCloudSyncStatus(status);

      // 只更新状态显示，不重新加载整个配置
      panel.webview.postMessage({
        type: 'statusUpdate',
        status: status
      });

    } catch (error) {
      console.error('连接测试异常:', error);
      const errorMessage = error instanceof Error ? error.message : '连接测试失败';
      
      panel.webview.postMessage({
        type: 'testResult',
        success: false,
        message: errorMessage
      });

      // 显示VSCode错误通知
      vscode.window.showErrorMessage(`连接测试异常: ${errorMessage}`);

      // 更新状态
      const status = SettingsManager.getCloudSyncStatus();
      status.isConnected = false;
      status.lastError = errorMessage;
      await SettingsManager.saveCloudSyncStatus(status);

      // 只更新状态显示，不重新加载整个配置
      panel.webview.postMessage({
        type: 'statusUpdate',
        status: status
      });
    }
  }

  private async _resetConfig(panel: vscode.WebviewPanel) {
    try {
      // 显示确认对话框
      const confirmReset = await vscode.window.showWarningMessage(
        '确定要重置所有配置吗？此操作不可撤销。',
        { modal: true },
        '确定重置',
        '取消'
      );

      if (confirmReset !== '确定重置') {
        panel.webview.postMessage({
          type: 'resetSuccess',
          message: '用户取消重置操作'
        });
        return;
      }

      // 重置配置
      const defaultConfig: CloudSyncConfig = {
        endpoint: '',
        accessKey: '',
        secretKey: '',
        bucket: '',
        region: '',
        timeout: 30,
        addressing: 'virtual-hosted-style',
        autoSync: false,
        syncInterval: 60,
        concurrency: 3
      };

      await SettingsManager.saveCloudSyncConfig(defaultConfig);
      
      // 发送成功消息
      panel.webview.postMessage({
        type: 'resetSuccess',
        message: '配置已重置'
      });

      // 重新发送配置数据
      await this._sendConfigToWebview(panel);
    } catch (error) {
      console.error('重置配置失败:', error);
      panel.webview.postMessage({
        type: 'saveError',
        message: `重置配置失败: ${error}`
      });
    }
  }



  private async _sendConfigToWebview(panel: vscode.WebviewPanel) {
    if (!panel) {
      return;
    }

    const config = SettingsManager.getCloudSyncConfig();
    const status = SettingsManager.getCloudSyncStatus();

    panel.webview.postMessage({
      type: 'configData',
      config,
      status
    });
  }

  private async _performManualSync(panel: vscode.WebviewPanel) {
    try {
      // 检查是否正在编辑代码片段
      if (ContextManager.isEditingSnippet()) {
        panel.webview.postMessage({
          type: 'manualSyncResult',
          success: false,
          message: '用户正在编辑代码片段，请完成编辑后再进行同步'
        });
        vscode.window.showWarningMessage('用户正在编辑代码片段，请完成编辑后再进行同步', '我知道了');
        return;
      }
      
      panel.webview.postMessage({
        type: 'syncStarted',
        message: '正在执行手动同步...'
      });

      const context = SettingsManager.getExtensionContext();
      if (!context) {
        throw new Error('扩展上下文未初始化');
      }

      const storageManager = new StorageManager(context);
      const cloudSyncManager = new CloudSyncManager(context, storageManager);

      const [snippets, directories] = await Promise.all([
        storageManager.getAllSnippets(),
        storageManager.getAllDirectories()
      ]);

      const result = await cloudSyncManager.performSync(snippets, directories);
      
      panel.webview.postMessage({
        type: 'manualSyncResult',
        success: result.success,
        message: result.message
      });

      if (result.success) {
        vscode.window.showInformationMessage(`手动同步成功: ${result.message}`);
      } else {
        vscode.window.showWarningMessage(`手动同步失败: ${result.message}`);
      }

      // 更新状态显示
      const status = SettingsManager.getCloudSyncStatus();
      panel.webview.postMessage({
        type: 'statusUpdate',
        status: status
      });

    } catch (error) {
      console.error('手动同步异常:', error);
      const errorMessage = error instanceof Error ? error.message : '手动同步失败';
      
      panel.webview.postMessage({
        type: 'manualSyncResult',
        success: false,
        message: errorMessage
      });

      vscode.window.showErrorMessage(`手动同步异常: ${errorMessage}`);
    }
  }

  private async _exportSettings(panel: vscode.WebviewPanel) {
    try {
      // 安全提醒
      const securityWarning = await vscode.window.showWarningMessage(
        '⚠️ 安全提醒：导出的配置文件将包含完整的访问密钥信息。请确保：\n\n' +
        '• 妥善保管导出的文件\n' +
        '• 不要将文件分享给不信任的人\n' +
        '• 不要上传到公共代码仓库\n' +
        '• 建议加密存储或使用安全的传输方式\n\n' +
        '确定要继续导出吗？',
        { modal: true },
        '继续导出',
        '取消'
      );

      if (securityWarning !== '继续导出') {
        panel.webview.postMessage({
          type: 'exportResult',
          success: false,
          message: '用户取消导出操作'
        });
      return;
    }

    const config = SettingsManager.getCloudSyncConfig();
    const status = SettingsManager.getCloudSyncStatus();
      
      // 创建完整的导出数据
      const exportData = {
        version: '1.0',
        exportTime: new Date().toISOString(),
        warning: '⚠️ 此文件包含敏感信息，请妥善保管！',
        config: {
          endpoint: config.endpoint,
          accessKey: config.accessKey,
          secretKey: config.secretKey,
          bucket: config.bucket,
          region: config.region,
          timeout: config.timeout,
          addressing: config.addressing,
          autoSync: config.autoSync,
          syncInterval: config.syncInterval,
          concurrency: config.concurrency
        },
        status: {
          isConnected: status.isConnected,
          lastSyncTime: status.lastSyncTime
        }
      };

      const exportJson = JSON.stringify(exportData, null, 2);
      
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`starcode-sync-settings-${new Date().toISOString().split('T')[0]}.json`),
        filters: {
          'JSON files': ['json'],
          'All files': ['*']
        }
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(exportJson, 'utf8'));

    panel.webview.postMessage({
          type: 'exportResult',
          success: true,
          message: '设置导出成功（包含完整配置）'
        });
        
        // 再次提醒安全注意事项
        vscode.window.showInformationMessage(
          `✅ 设置已导出到: ${uri.fsPath}\n\n🔒 请注意：文件包含敏感信息，请妥善保管！`,
          '我知道了'
        );
      }

    } catch (error) {
      console.error('导出设置失败:', error);
      const errorMessage = error instanceof Error ? error.message : '导出设置失败';
      
      panel.webview.postMessage({
        type: 'exportResult',
        success: false,
        message: errorMessage
      });

      vscode.window.showErrorMessage(`导出设置失败: ${errorMessage}`);
    }
  }

  private async _importSettings(panel: vscode.WebviewPanel) {
    try {
      // 首先显示确认对话框
      const confirmImport = await vscode.window.showWarningMessage(
        '导入设置将覆盖当前配置，确定要继续吗？',
        { modal: true },
        '继续导入',
        '取消'
      );

      if (confirmImport !== '继续导入') {
        panel.webview.postMessage({
          type: 'importResult',
          success: false,
          message: '用户取消导入操作'
        });
        return;
      }

      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
          'JSON files': ['json'],
          'All files': ['*']
        }
      });

      if (!uris || uris.length === 0) {
        return;
      }

      const fileContent = await vscode.workspace.fs.readFile(uris[0]);
      const importText = new TextDecoder().decode(fileContent);
      
      let importData;
      try {
        importData = JSON.parse(importText);
      } catch (parseError) {
        throw new Error('文件格式无效，请选择有效的JSON文件');
      }

      // 验证导入数据格式
      if (!importData.config || !importData.version) {
        throw new Error('文件格式不正确，缺少必要的配置信息');
      }

      // 获取当前配置
      const currentConfig = SettingsManager.getCloudSyncConfig();
      
      // 检查导入数据是否包含敏感信息
      const hasCredentials = importData.config.accessKey || importData.config.secretKey;
      
      // 合并配置
      const newConfig = {
        endpoint: importData.config.endpoint || currentConfig.endpoint || '',
        accessKey: importData.config.accessKey || currentConfig.accessKey || '',
        secretKey: importData.config.secretKey || currentConfig.secretKey || '',
        bucket: importData.config.bucket || currentConfig.bucket || '',
        region: importData.config.region || currentConfig.region || '',
        timeout: importData.config.timeout || currentConfig.timeout || 30,
        addressing: importData.config.addressing || currentConfig.addressing || 'virtual-hosted-style',
        autoSync: importData.config.autoSync !== undefined ? importData.config.autoSync : currentConfig.autoSync || false,
        syncInterval: importData.config.syncInterval || currentConfig.syncInterval || 60,
        concurrency: importData.config.concurrency || currentConfig.concurrency || 3
      };

      // 验证配置
      const validation = SettingsManager.validateConfig(newConfig);
      if (!validation.isValid) {
        // 如果验证失败，仍然导入但给出警告
        const warningMessage = `配置导入成功，但存在以下问题: ${validation.errors.join(', ')}`;
        vscode.window.showWarningMessage(warningMessage);
      }

      // 保存配置
      await SettingsManager.saveCloudSyncConfig(newConfig);
      
      // 更新页面显示
      await this._sendConfigToWebview(panel);
      
      // 生成导入结果消息
      let importMessage = '设置导入成功';
      let notificationMessage = `设置已从 ${uris[0].fsPath} 导入成功`;
      
      if (hasCredentials) {
        importMessage += '（包含访问密钥）';
        notificationMessage += '\n\n✅ 已导入完整配置，包括访问密钥信息';
      } else {
        importMessage += '（未包含访问密钥，已保留当前密钥）';
        notificationMessage += '\n\n⚠️ 导入的配置不包含访问密钥，已保留当前设置的密钥信息';
      }
      
      panel.webview.postMessage({
        type: 'importResult',
        success: true,
        message: importMessage
      });
      
      vscode.window.showInformationMessage(notificationMessage);

    } catch (error) {
      console.error('导入设置失败:', error);
      const errorMessage = error instanceof Error ? error.message : '导入设置失败';
      
      panel.webview.postMessage({
        type: 'importResult',
        success: false,
        message: errorMessage
      });

      vscode.window.showErrorMessage(`导入设置失败: ${errorMessage}`);
    }
  }

  private async _forceResetCloudSync(panel: vscode.WebviewPanel) {
    try {
      // 检查是否正在编辑代码片段
      if (ContextManager.isEditingSnippet()) {
        panel.webview.postMessage({
          type: 'forceResetResult',
          success: false,
          message: '用户正在编辑代码片段，请完成编辑后再进行重置'
        });
        return;
      }

      // 显示严重警告
      const warningMessage = `⚠️ 危险操作警告 ⚠️

此操作将：
• 清空云端所有同步文件
• 清空本地历史记录
• 重新初始化云端同步

这是一个不可逆的操作！
请确保您了解此操作的后果。

是否继续？`;

      const choice = await vscode.window.showWarningMessage(
        warningMessage,
        { modal: true },
        '我了解风险，继续执行',
        '取消'
      );

      if (choice !== '我了解风险，继续执行') {
        panel.webview.postMessage({
          type: 'forceResetResult',
          success: false,
          message: '用户取消了重置操作'
        });
        return;
      }

      // 二次确认
      const finalConfirm = await vscode.window.showWarningMessage(
        '🚨 最后确认：此操作将完全重置云端同步，无法撤销！',
        { modal: true },
        '确认执行',
        '取消'
      );

      if (finalConfirm !== '确认执行') {
        panel.webview.postMessage({
          type: 'forceResetResult',
          success: false,
          message: '用户取消了重置操作'
        });
        return;
      }

      // 发送开始重置消息
      panel.webview.postMessage({
        type: 'forceResetStarted',
        message: '正在执行强制重置...'
      });

      // 获取扩展上下文和存储管理器
      const context = SettingsManager.getExtensionContext();
      if (!context) {
        throw new Error('扩展上下文未初始化');
      }

      // 创建存储管理器实例
      const storageManager = new StorageManager(context);
      const cloudSyncManager = new CloudSyncManager(context, storageManager);
      
      if (!cloudSyncManager.isConfigured()) {
        throw new Error('云端同步未配置，请先完成配置');
      }

      // 获取当前代码片段和目录
      const [snippets, directories] = await Promise.all([
        storageManager.getAllSnippets(),
        storageManager.getAllDirectories()
      ]);

      // 执行强制重置
      const result = await cloudSyncManager.forceResetCloudSync(snippets, directories);
      
      // 发送结果消息
      panel.webview.postMessage({
        type: 'forceResetResult',
        success: result.success,
        message: result.message
      });

      if (result.success) {
        vscode.window.showInformationMessage(`✅ ${result.message}`);
        // 重新发送配置和状态到webview
        await this._sendConfigToWebview(panel);
      } else {
        vscode.window.showErrorMessage(`❌ ${result.message}`);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '强制重置失败';
      
      panel.webview.postMessage({
        type: 'forceResetResult',
        success: false,
        message: errorMessage
      });

      vscode.window.showErrorMessage(`❌ 强制重置失败: ${errorMessage}`);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>云端同步设置</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 30px;
            margin: 0;
            min-height: 100vh;
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
        }

        .header {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid var(--vscode-panel-border);
        }

        .header h1 {
            margin: 0;
            color: var(--vscode-textLink-foreground);
            font-size: 24px;
        }

        .header p {
            margin: 10px 0 0 0;
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }

        .section {
            margin-bottom: 30px;
            padding: 20px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            background-color: var(--vscode-panel-background);
        }

        .section-title {
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 15px;
            color: var(--vscode-textLink-foreground);
        }

        .form-group {
            margin-bottom: 15px;
        }

        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
        }

        .form-group input,
        .form-group select {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: inherit;
            font-size: inherit;
            box-sizing: border-box;
        }

        .form-group input:focus,
        .form-group select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .form-group input[type="password"] {
            font-family: monospace;
        }

        .form-group input[type="number"] {
            width: 120px;
        }

        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .checkbox-group input[type="checkbox"] {
            width: auto;
        }

        .button-group {
            display: flex;
            gap: 10px;
            margin-top: 20px;
        }

        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-family: inherit;
            font-size: inherit;
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

        .btn-danger {
            background-color: var(--vscode-errorForeground);
            color: var(--vscode-editor-background);
        }

        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .status {
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 15px;
        }

        .status.success {
            background-color: var(--vscode-testing-iconPassed);
            color: var(--vscode-editor-background);
        }

        .status.error {
            background-color: var(--vscode-errorForeground);
            color: var(--vscode-editor-background);
        }

        .status.info {
            background-color: var(--vscode-notificationsInfoIcon-foreground);
            color: var(--vscode-editor-background);
        }

        .status.warning {
            background-color: var(--vscode-notificationsWarningIcon-foreground);
            color: var(--vscode-editor-background);
        }

        .connection-status {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 15px;
        }

        .status-indicator {
            width: 12px;
            height: 12px;
            border-radius: 50%;
        }

        .status-indicator.connected {
            background-color: var(--vscode-testing-iconPassed);
        }

        .status-indicator.disconnected {
            background-color: var(--vscode-errorForeground);
        }

        .help-text {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 5px;
        }

        .hidden {
            display: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>☁️ 云端同步设置(🧪实验性功能)</h1>
            <p>配置 S3 兼容存储服务，实现代码片段的云端同步</p>
        </div>
        
        <div id="statusMessage" class="status hidden"></div>

        <!-- 连接状态 -->
        <div class="section">
            <div class="section-title">连接状态</div>
            <div class="connection-status">
                <div id="statusIndicator" class="status-indicator disconnected"></div>
                <span id="statusText">未连接</span>
            </div>
            <div id="lastSyncTime" class="help-text"></div>
            <div id="lastError" class="help-text" style="color: var(--vscode-errorForeground);"></div>
        </div>

        <!-- S3 配置 -->
        <div class="section">
            <div class="section-title">S3 兼容存储配置</div>
            
            <div class="form-group">
                <label for="endpoint">Endpoint *</label>
                <input type="text" id="endpoint" placeholder="例如: https://s3.amazonaws.com">
                <div class="help-text">S3 兼容服务的端点地址</div>
            </div>

            <div class="form-group">
                <label for="accessKey">Access Key *</label>
                <input type="text" id="accessKey" placeholder="访问密钥">
            </div>

            <div class="form-group">
                <label for="secretKey">Secret Key *</label>
                <input type="password" id="secretKey" placeholder="密钥">
            </div>

            <div class="form-group">
                <label for="bucket">Bucket *</label>
                <input type="text" id="bucket" placeholder="存储桶名称">
            </div>

            <div class="form-group">
                <label for="region">Region ID *</label>
                <input type="text" id="region" placeholder="例如: us-east-1">
            </div>

            <div class="form-group">
                <label for="addressing">Addressing Style</label>
                <select id="addressing">
                    <option value="virtual-hosted-style">Virtual-hosted-style</option>
                    <option value="path-style">Path-style</option>
                </select>
                <div class="help-text">URL 寻址方式</div>
            </div>

            <div class="form-group">
                <label for="timeout">连接超时时间 (秒)</label>
                <input type="number" id="timeout" min="1" max="300" value="30">
            </div>
        </div>

        <!-- 同步设置 -->
        <div class="section">
            <div class="section-title">同步设置</div>
            
            <div class="form-group">
                <div class="checkbox-group">
                    <input type="checkbox" id="autoSync">
                    <label for="autoSync">启用自动同步</label>
                </div>
            </div>

            <div class="form-group">
                <label for="syncInterval">自动同步间隔 (秒)</label>
                <input type="number" id="syncInterval" min="10" max="3600" value="60">
                <div class="help-text">自动同步的时间间隔（10-3600秒）</div>
            </div>

            <div class="form-group">
                <label for="concurrency">请求并发数</label>
                <input type="number" id="concurrency" min="1" max="10" value="3">
                <div class="help-text">同时进行的上传/下载请求数量</div>
            </div>
        </div>

        <!-- 操作按钮 -->
        <div class="button-group">
            <button id="saveBtn" class="btn btn-primary">保存配置</button>
            <button id="testBtn" class="btn btn-secondary">测试连接</button>
            <button id="manualSyncBtn" class="btn btn-secondary">手动同步</button>
            <button id="resetBtn" class="btn btn-danger">重置配置</button>
        </div>

        <!-- 危险操作区域 -->
        <div class="section">
            <div class="section-title" style="color: var(--vscode-errorForeground);">🚨 危险操作</div>
            <p class="help-text">
                <strong style="color: var(--vscode-errorForeground);">强制重置云端同步：</strong>
                清空云端所有同步文件和本地历史记录，然后重新初始化云端同步。
                <br><br>
                <span style="color: var(--vscode-errorForeground);">⚠️ 这是一个不可逆的操作！只有在遇到严重同步问题时才使用此功能。</span>
                <br><br>
                <strong>使用场景：</strong>
                <br>• 多设备同步出现严重冲突
                <br>• 历史记录损坏导致无法同步
                <br>• 需要完全重新开始同步
            </p>
            <div class="button-group">
                <button id="forceResetBtn" class="btn btn-danger">🚨 强制重置云端同步</button>
            </div>
        </div>

        <!-- 导入导出按钮 -->
        <div class="section">
            <div class="section-title">配置管理</div>
            <p class="help-text">
                <strong>导出设置：</strong>备份完整的同步配置（包含访问密钥），便于在其他设备上快速配置。<br>
                <strong>导入设置：</strong>从备份文件恢复配置，支持完整导入或仅导入非敏感设置。<br>
                <span style="color: var(--vscode-errorForeground);">⚠️ 导出的文件包含敏感信息，请妥善保管！</span>
            </p>
            <div class="button-group">
                <button id="exportBtn" class="btn btn-secondary">📤 导出设置</button>
                <button id="importBtn" class="btn btn-secondary">📥 导入设置</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // DOM 元素
        const statusMessage = document.getElementById('statusMessage');
        const statusIndicator = document.getElementById('statusIndicator');
        const statusText = document.getElementById('statusText');
        const lastSyncTime = document.getElementById('lastSyncTime');
        const lastError = document.getElementById('lastError');
        
        const endpointInput = document.getElementById('endpoint');
        const accessKeyInput = document.getElementById('accessKey');
        const secretKeyInput = document.getElementById('secretKey');
        const bucketInput = document.getElementById('bucket');
        const regionInput = document.getElementById('region');
        const addressingSelect = document.getElementById('addressing');
        const timeoutInput = document.getElementById('timeout');
        const autoSyncCheckbox = document.getElementById('autoSync');
        const syncIntervalInput = document.getElementById('syncInterval');
        const concurrencyInput = document.getElementById('concurrency');
        
        const saveBtn = document.getElementById('saveBtn');
        const testBtn = document.getElementById('testBtn');
        const manualSyncBtn = document.getElementById('manualSyncBtn');
        const resetBtn = document.getElementById('resetBtn');
        const exportBtn = document.getElementById('exportBtn');
        const importBtn = document.getElementById('importBtn');
        const forceResetBtn = document.getElementById('forceResetBtn');

        // 显示状态消息
        function showStatus(message, type = 'info') {
            statusMessage.textContent = message;
            statusMessage.className = \`status \${type}\`;
            statusMessage.classList.remove('hidden');
            
            setTimeout(() => {
                statusMessage.classList.add('hidden');
            }, 5000);
        }

        // 更新连接状态显示
        function updateConnectionStatus(status) {
            if (status.isConnected) {
                statusIndicator.className = 'status-indicator connected';
                statusText.textContent = '已连接';
            } else {
                statusIndicator.className = 'status-indicator disconnected';
                statusText.textContent = '未连接';
            }

            if (status.lastSyncTime) {
                const date = new Date(status.lastSyncTime);
                lastSyncTime.textContent = \`上次同步: \${date.toLocaleString()}\`;
            } else {
                lastSyncTime.textContent = '尚未同步';
            }

            if (status.lastError) {
                lastError.textContent = \`错误: \${status.lastError}\`;
                lastError.style.display = 'block';
            } else {
                lastError.style.display = 'none';
            }
        }

        // 获取表单数据
        function getFormData() {
            return {
                endpoint: endpointInput.value.trim(),
                accessKey: accessKeyInput.value.trim(),
                secretKey: secretKeyInput.value.trim(),
                bucket: bucketInput.value.trim(),
                region: regionInput.value.trim(),
                timeout: parseInt(timeoutInput.value) || 30,
                addressing: addressingSelect.value,
                autoSync: autoSyncCheckbox.checked,
                syncInterval: parseInt(syncIntervalInput.value) || 60,
                concurrency: parseInt(concurrencyInput.value) || 3
            };
        }

        // 设置表单数据
        function setFormData(config) {
            endpointInput.value = config.endpoint || '';
            accessKeyInput.value = config.accessKey || '';
            secretKeyInput.value = config.secretKey || '';
            bucketInput.value = config.bucket || '';
            regionInput.value = config.region || '';
            timeoutInput.value = config.timeout || 30;
            addressingSelect.value = config.addressing || 'virtual-hosted-style';
            autoSyncCheckbox.checked = config.autoSync || false;
            syncIntervalInput.value = config.syncInterval || 60;
            concurrencyInput.value = config.concurrency || 3;
        }

        // 事件监听器
        saveBtn.addEventListener('click', () => {
            const config = getFormData();
            vscode.postMessage({
                type: 'saveConfig',
                config: config
            });
        });

        testBtn.addEventListener('click', () => {
            const config = getFormData();
            testBtn.disabled = true;
            testBtn.textContent = '测试中...';
            
            vscode.postMessage({
                type: 'testConnection',
                config: config
            });
        });



        manualSyncBtn.addEventListener('click', () => {
            manualSyncBtn.disabled = true;
            manualSyncBtn.textContent = '同步中...';
            
            vscode.postMessage({
                type: 'manualSync'
            });
        });

        resetBtn.addEventListener('click', () => {
                vscode.postMessage({
                    type: 'resetConfig'
                });
        });

        exportBtn.addEventListener('click', () => {
            exportBtn.disabled = true;
            exportBtn.textContent = '📤 导出中...';
            
            vscode.postMessage({
                type: 'exportSettings'
            });
        });

        importBtn.addEventListener('click', () => {
            importBtn.disabled = true;
            importBtn.textContent = '📥 导入中...';
            
            vscode.postMessage({
                type: 'importSettings'
            });
        });

        forceResetBtn.addEventListener('click', () => {
            forceResetBtn.disabled = true;
            forceResetBtn.textContent = '🚨 重置中...';
            
            vscode.postMessage({
                type: 'forceResetCloudSync'
            });
        });

        // 处理来自扩展的消息
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'configData':
                    setFormData(message.config);
                    updateConnectionStatus(message.status);
                    break;
                    
                case 'saveSuccess':
                    showStatus(message.message, 'success');
                    break;
                    
                case 'saveError':
                    showStatus(message.message, 'error');
                    break;
                    
                case 'validationError':
                    showStatus(\`配置验证失败: \${message.errors.join(', ')}\`, 'error');
                    break;
                    
                case 'testingConnection':
                    showStatus(message.message, 'info');
                    break;
                    
                case 'testResult':
                    testBtn.disabled = false;
                    testBtn.textContent = '测试连接';
                    showStatus(message.message, message.success ? 'success' : 'error');
                    break;
                    
                case 'manualSyncResult':
                    manualSyncBtn.disabled = false;
                    manualSyncBtn.textContent = '手动同步';
                    showStatus(message.message, message.success ? 'success' : 'error');
                    break;
                    
                case 'syncStarted':
                    showStatus(message.message, 'info');
                    break;
                    
                case 'exportResult':
                    exportBtn.disabled = false;
                    exportBtn.textContent = '📤 导出设置';
                    showStatus(message.message, message.success ? 'success' : 'error');
                    break;
                    
                case 'importResult':
                    importBtn.disabled = false;
                    importBtn.textContent = '📥 导入设置';
                    showStatus(message.message, message.success ? 'success' : 'error');
                    break;
                    
                case 'statusUpdate':
                    // 只更新状态显示，不重新加载表单数据
                    updateConnectionStatus(message.status);
                    break;
                    
                case 'resetSuccess':
                    showStatus(message.message, 'success');
                    break;

                case 'forceResetStarted':
                    showStatus(message.message, 'warning');
                    break;

                case 'forceResetResult':
                    forceResetBtn.disabled = false;
                    forceResetBtn.textContent = '🚨 强制重置云端同步';
                    showStatus(message.message, message.success ? 'success' : 'error');
                    break;
            }
        });

        // 页面加载时获取配置
        vscode.postMessage({
            type: 'getConfig'
        });
    </script>
</body>
</html>`;
  }
} 