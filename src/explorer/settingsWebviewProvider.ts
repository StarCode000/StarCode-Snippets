import * as vscode from 'vscode';
import { CloudSyncConfig, CloudSyncStatus } from '../models/types';
import { SettingsManager } from '../utils/settingsManager';
import { S3TestClient } from '../utils/s3TestClient';

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

      // 使用S3TestClient进行连接测试
      console.log('创建S3TestClient实例...');
      const s3TestClient = new S3TestClient(config);
      console.log('调用testConnection方法...');
      const result = await s3TestClient.testConnection();
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
            <h1>☁️ 云端同步设置</h1>
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
            if (confirm('确定要重置所有配置吗？此操作不可撤销。')) {
                vscode.postMessage({
                    type: 'resetConfig'
                });
            }
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
                    
                case 'statusUpdate':
                    // 只更新状态显示，不重新加载表单数据
                    updateConnectionStatus(message.status);
                    break;
                    
                case 'resetSuccess':
                    showStatus(message.message, 'success');
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