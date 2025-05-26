import * as vscode from 'vscode';
import { CloudSyncManager } from '../utils/cloudSyncManager';
import { ChangelogManager, HistoryEntry, OperationType } from '../utils/changelogManager';
import { SettingsManager } from '../utils/settingsManager';
import { StorageManager } from '../storage/storageManager';

// 扩展历史记录条目，添加数据源信息
interface ExtendedHistoryEntry extends HistoryEntry {
  source?: 'local' | 'remote' | 'synced';
}

export class HistoryWebviewProvider {
  public static readonly viewType = 'starcode-snippets.history';
  private static currentPanel: vscode.WebviewPanel | undefined;

  private constructor() {}

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // 如果已经有历史记录面板打开，就激活它
    if (HistoryWebviewProvider.currentPanel) {
      HistoryWebviewProvider.currentPanel.reveal(column);
      return;
    }

    // 创建新的WebView面板
    const panel = vscode.window.createWebviewPanel(
      HistoryWebviewProvider.viewType,
      '同步历史记录',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: true
      }
    );

    HistoryWebviewProvider.currentPanel = panel;
    const provider = new HistoryWebviewProvider();
    provider._setupWebview(panel, extensionUri);

    // 当面板被关闭时，清理引用
    panel.onDidDispose(() => {
      HistoryWebviewProvider.currentPanel = undefined;
    }, null);
  }

  private _setupWebview(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    panel.webview.html = this._getHtmlForWebview(panel.webview, extensionUri);

    // 处理来自webview的消息
    panel.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'loadHistory':
          await this._loadHistory(panel);
          break;
        case 'refreshHistory':
          await this._refreshHistory(panel);
          break;
        case 'downloadHistory':
          await this._downloadHistory(panel);
          break;
        case 'viewRawHistory':
          await this._viewRawHistory(panel);
          break;
        case 'abandonLocalAndImport':
          await this._abandonLocalAndImport(panel);
          break;
      }
    });

    // 初始加载历史记录
    this._loadHistory(panel);
  }

  private async _loadHistory(panel: vscode.WebviewPanel) {
    try {
      panel.webview.postMessage({
        type: 'loading',
        message: '正在加载历史记录...'
      });

      const context = SettingsManager.getExtensionContext();
      if (!context) {
        throw new Error('扩展上下文未初始化');
      }

      const cloudSyncManager = new CloudSyncManager(context);
      
      if (!cloudSyncManager.isConfigured()) {
        panel.webview.postMessage({
          type: 'error',
          message: '云端同步未配置，无法加载历史记录'
        });
        return;
      }

      // 获取本地历史记录
      const localHistory = context.globalState.get('cloudSync.lastHistory', '');
      
      // 尝试获取云端历史记录
      let remoteHistory = '';
      try {
        const remoteCheck = await cloudSyncManager.checkRemoteUpdates();
        if (remoteCheck.remoteHistory) {
          remoteHistory = remoteCheck.remoteHistory;
        }
      } catch (error) {
        console.warn('无法获取云端历史记录:', error);
      }

      // 解析历史记录
      const localEntries = this._parseHistory(localHistory);
      const remoteEntries = this._parseHistory(remoteHistory);
      
      // 合并并去重历史记录
      const allEntries = this._mergeHistories(localEntries, remoteEntries);
      
      // 获取同步状态
      const syncStatus = SettingsManager.getCloudSyncStatus();
      const syncConfig = SettingsManager.getCloudSyncConfig();

      panel.webview.postMessage({
        type: 'historyData',
        data: {
          entries: allEntries,
          syncStatus,
          syncConfig: {
            endpoint: syncConfig.endpoint,
            bucket: syncConfig.bucket
          },
          stats: this._generateStats(allEntries)
        }
      });

    } catch (error) {
      console.error('加载历史记录失败:', error);
      panel.webview.postMessage({
        type: 'error',
        message: `加载历史记录失败: ${error instanceof Error ? error.message : '未知错误'}`
      });
    }
  }

  private async _refreshHistory(panel: vscode.WebviewPanel) {
    await this._loadHistory(panel);
  }

  private async _downloadHistory(panel: vscode.WebviewPanel) {
    try {
      const context = SettingsManager.getExtensionContext();
      if (!context) {
        throw new Error('扩展上下文未初始化');
      }

      const localHistory = context.globalState.get('cloudSync.lastHistory', '');
      
      if (!localHistory) {
        vscode.window.showWarningMessage('没有历史记录可以下载');
        return;
      }

      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('sync-history.txt'),
        filters: {
          'Text files': ['txt'],
          'All files': ['*']
        }
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(localHistory, 'utf8'));
        vscode.window.showInformationMessage(`历史记录已保存到: ${uri.fsPath}`);
      }

    } catch (error) {
      console.error('下载历史记录失败:', error);
      vscode.window.showErrorMessage(`下载历史记录失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }
  
  /**
   * 查看原始历史记录内容
   */
  private async _viewRawHistory(panel: vscode.WebviewPanel) {
    try {
      const context = SettingsManager.getExtensionContext();
      if (!context) {
        throw new Error('扩展上下文未初始化');
      }

      // 获取本地历史记录
      const localHistory = context.globalState.get('cloudSync.lastHistory', '');
      
      // 尝试获取云端历史记录
      let remoteHistory = '';
      try {
        const cloudSyncManager = new CloudSyncManager(context);
        const remoteCheck = await cloudSyncManager.checkRemoteUpdates();
        if (remoteCheck.remoteHistory) {
          remoteHistory = remoteCheck.remoteHistory;
        }
      } catch (error) {
        console.warn('无法获取云端历史记录:', error);
      }
      
      // 发送原始历史记录内容
      panel.webview.postMessage({
        type: 'rawHistoryData',
        data: {
          local: localHistory,
          remote: remoteHistory
        }
      });
      
    } catch (error) {
      console.error('查看原始历史记录失败:', error);
      panel.webview.postMessage({
        type: 'error',
        message: `查看原始历史记录失败: ${error instanceof Error ? error.message : '未知错误'}`
      });
    }
  }

  private async _abandonLocalAndImport(panel: vscode.WebviewPanel) {
    try {
      // 显示警告
      const warningMessage = `⚠️ 重要操作确认 ⚠️

此操作将：
• 删除本地所有代码片段和目录
• 清空本地历史记录
• 从云端重新导入所有数据

本地的所有未同步更改将丢失！
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
          type: 'abandonLocalResult',
          success: false,
          message: '用户取消了操作'
        });
        return;
      }

      // 发送开始操作消息
      panel.webview.postMessage({
        type: 'abandonLocalStarted',
        message: '正在从云端导入数据...'
      });

      // 获取扩展上下文
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

      // 执行放弃本地并从云端导入
      const result = await cloudSyncManager.abandonLocalAndImportFromCloud();
      
      // 发送结果消息
      panel.webview.postMessage({
        type: 'abandonLocalResult',
        success: result.success,
        message: result.message
      });

      if (result.success) {
        vscode.window.showInformationMessage(`✅ ${result.message}`);
        
        // 刷新树视图以显示导入的代码片段
        await vscode.commands.executeCommand('starcode-snippets.refreshExplorer');
        
        // 重新加载历史记录
        await this._loadHistory(panel);
      } else {
        vscode.window.showWarningMessage(`⚠️ ${result.message}`);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '从云端导入失败';
      
      panel.webview.postMessage({
        type: 'abandonLocalResult',
        success: false,
        message: errorMessage
      });

      vscode.window.showErrorMessage(`❌ 从云端导入失败: ${errorMessage}`);
    }
  }

  private _parseHistory(historyText: string): HistoryEntry[] {
    if (!historyText.trim()) {
      return [];
    }

    try {
      return ChangelogManager.parseHistory(historyText);
    } catch (error) {
      console.error('解析历史记录失败:', error);
      return [];
    }
  }

  private _mergeHistories(local: HistoryEntry[], remote: HistoryEntry[]): ExtendedHistoryEntry[] {
    const merged = new Map<string, ExtendedHistoryEntry>();
    
    // 添加本地记录
    local.forEach(entry => {
      const key = `${entry.timestamp}-${entry.fullPath}-${entry.operation}`;
      merged.set(key, { ...entry, source: 'local' });
    });
    
    // 添加远程记录
    remote.forEach(entry => {
      const key = `${entry.timestamp}-${entry.fullPath}-${entry.operation}`;
      if (merged.has(key)) {
        // 如果已存在，标记为已同步
        const existing = merged.get(key)!;
        existing.source = 'synced';
      } else {
        merged.set(key, { ...entry, source: 'remote' });
      }
    });
    
    // 按时间戳排序（最新的在前）
    return Array.from(merged.values()).sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  private _generateStats(entries: ExtendedHistoryEntry[]) {
    const stats = {
      total: entries.length,
      adds: 0,
      modifies: 0,
      deletes: 0,
      forceResets: 0,
      files: 0,
      directories: 0,
      localChanges: 0,
      remoteChanges: 0,
      syncedChanges: 0,
      lastActivity: entries.length > 0 ? entries[0].timestamp : null,
      firstActivity: entries.length > 0 ? entries[entries.length - 1].timestamp : null
    };

    entries.forEach(entry => {
      switch (entry.operation) {
        case OperationType.ADD:
          stats.adds++;
          break;
        case OperationType.MODIFY:
          stats.modifies++;
          break;
        case OperationType.DELETE:
          stats.deletes++;
          break;
        case OperationType.FORCE_CLEAR:
          stats.forceResets++;
          break;
      }

      // 统计数据源
      switch (entry.source) {
        case 'local':
          stats.localChanges++;
          break;
        case 'remote':
          stats.remoteChanges++;
          break;
        case 'synced':
          stats.syncedChanges++;
          break;
      }

      // 只对非强制重置操作统计文件/目录
      if (entry.operation !== OperationType.FORCE_CLEAR) {
        if (entry.fullPath.endsWith('/')) {
          stats.directories++;
        } else {
          stats.files++;
        }
      }
    });

    return stats;
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
            padding: 20px;
            margin: 0;
            line-height: 1.6;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid var(--vscode-panel-border);
        }

        .header h1 {
            margin: 0;
            color: var(--vscode-textLink-foreground);
            font-size: 24px;
        }

        .header-actions {
            display: flex;
            gap: 10px;
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

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .stat-card {
            background-color: var(--vscode-panel-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 20px;
            text-align: center;
        }

        .stat-number {
            font-size: 32px;
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
            margin-bottom: 8px;
        }

        .stat-label {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }

        .sync-status {
            background-color: var(--vscode-panel-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 20px;
            margin-bottom: 30px;
        }

        .status-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }

        .status-row:last-child {
            margin-bottom: 0;
        }

        .status-indicator {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .status-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
        }

        .status-dot.connected {
            background-color: var(--vscode-testing-iconPassed);
        }

        .status-dot.disconnected {
            background-color: var(--vscode-errorForeground);
        }

        .history-timeline {
            background-color: var(--vscode-panel-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 20px;
        }

        .timeline-item {
            display: flex;
            align-items: flex-start;
            padding: 15px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
            position: relative;
        }

        .timeline-item:last-child {
            border-bottom: none;
        }

        .timeline-icon {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 15px;
            font-size: 14px;
            flex-shrink: 0;
        }

        .timeline-icon.add {
            background-color: var(--vscode-testing-iconPassed);
            color: white;
        }

        .timeline-icon.modify {
            background-color: var(--vscode-notificationsWarningIcon-foreground);
            color: white;
        }

        .timeline-icon.delete {
            background-color: var(--vscode-errorForeground);
            color: white;
        }

        .timeline-icon.force-reset {
            background-color: var(--vscode-notificationsErrorIcon-foreground);
            color: white;
            font-weight: bold;
        }

        .timeline-icon.unknown {
            background-color: var(--vscode-descriptionForeground);
            color: white;
        }

        .timeline-content {
            flex: 1;
        }

        .timeline-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 5px;
        }

        .timeline-title {
            font-weight: bold;
            color: var(--vscode-foreground);
        }

        .timeline-time {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }

        .timeline-path {
            color: var(--vscode-descriptionForeground);
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            margin-bottom: 5px;
        }

        .timeline-hash {
            color: var(--vscode-descriptionForeground);
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
        }

        .timeline-source {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: bold;
            text-transform: uppercase;
        }

        .timeline-source.local {
            background-color: var(--vscode-notificationsInfoIcon-foreground);
            color: white;
        }

        .timeline-source.remote {
            background-color: var(--vscode-notificationsWarningIcon-foreground);
            color: white;
        }

        .timeline-source.synced {
            background-color: var(--vscode-testing-iconPassed);
            color: white;
        }

        .timeline-device {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: bold;
            background-color: var(--vscode-descriptionForeground);
            color: var(--vscode-editor-background);
            font-family: var(--vscode-editor-font-family);
        }

        .loading {
            text-align: center;
            padding: 50px;
            color: var(--vscode-descriptionForeground);
        }

        .error {
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            color: var(--vscode-inputValidation-errorForeground);
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 20px;
        }

        .empty-state {
            text-align: center;
            padding: 50px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state h3 {
            margin-bottom: 10px;
            color: var(--vscode-foreground);
        }

        .filter-bar {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            align-items: center;
        }

        .filter-select {
            padding: 6px 10px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: inherit;
            font-size: inherit;
        }

        .hidden {
            display: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 同步历史记录</h1>
            <div class="header-actions">
                <button id="refreshBtn" class="btn btn-secondary">🔄 刷新</button>
                <button id="viewRawBtn" class="btn btn-secondary">📝 查看原始记录</button>
                <button id="downloadBtn" class="btn btn-secondary">💾 下载</button>
                <button id="abandonLocalBtn" class="btn btn-danger">📥 从云端导入</button>
            </div>
        </div>

        <div id="loadingState" class="loading">
            <p>正在加载历史记录...</p>
        </div>

        <div id="errorState" class="error hidden"></div>

        <div id="contentArea" class="hidden">
            <!-- 统计信息 -->
            <div class="stats-grid">
                <div class="stat-card">
                    <div id="totalCount" class="stat-number">0</div>
                    <div class="stat-label">总操作数</div>
                </div>
                <div class="stat-card">
                    <div id="addCount" class="stat-number">0</div>
                    <div class="stat-label">新增</div>
                </div>
                <div class="stat-card">
                    <div id="modifyCount" class="stat-number">0</div>
                    <div class="stat-label">修改</div>
                </div>
                <div class="stat-card">
                    <div id="deleteCount" class="stat-number">0</div>
                    <div class="stat-label">删除</div>
                </div>
                <div class="stat-card">
                    <div id="forceResetCount" class="stat-number">0</div>
                    <div class="stat-label">强制重置</div>
                </div>
                <div class="stat-card">
                    <div id="localChanges" class="stat-number">0</div>
                    <div class="stat-label">本地更改</div>
                </div>
                <div class="stat-card">
                    <div id="remoteChanges" class="stat-number">0</div>
                    <div class="stat-label">云端更改</div>
                </div>
                <div class="stat-card">
                    <div id="syncedChanges" class="stat-number">0</div>
                    <div class="stat-label">已同步</div>
                </div>
            </div>

            <!-- 同步状态 -->
            <div class="sync-status">
                <h3>同步状态</h3>
                <div class="status-row">
                    <span>连接状态:</span>
                    <div class="status-indicator">
                        <div id="connectionDot" class="status-dot disconnected"></div>
                        <span id="connectionText">未连接</span>
                    </div>
                </div>
                <div class="status-row">
                    <span>存储配置:</span>
                    <span id="storageConfig">未配置</span>
                </div>
                <div class="status-row">
                    <span>最后活动:</span>
                    <span id="lastActivity">无</span>
                </div>
            </div>

            <!-- 过滤器 -->
            <div class="filter-bar">
                <label>过滤操作类型:</label>
                <select id="operationFilter" class="filter-select">
                    <option value="all">全部</option>
                    <option value="+">新增</option>
                    <option value="~">修改</option>
                    <option value="-">删除</option>
                    <option value="!">强制重置</option>
                </select>
                
                <label>数据源:</label>
                <select id="sourceFilter" class="filter-select">
                    <option value="all">全部</option>
                    <option value="local">本地</option>
                    <option value="remote">远程</option>
                    <option value="synced">已同步</option>
                </select>
            </div>

            <!-- 历史记录时间线 -->
            <div class="history-timeline">
                <h3>操作历史</h3>
                <div id="timelineContainer">
                    <!-- 时间线项目将在这里动态生成 -->
                </div>
                <div id="emptyState" class="empty-state hidden">
                    <h3>暂无历史记录</h3>
                    <p>开始使用云端同步功能后，操作历史将显示在这里</p>
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        let allEntries = [];
        let filteredEntries = [];
        
        // DOM 元素
        const loadingState = document.getElementById('loadingState');
        const errorState = document.getElementById('errorState');
        const contentArea = document.getElementById('contentArea');
        const refreshBtn = document.getElementById('refreshBtn');
        const downloadBtn = document.getElementById('downloadBtn');
        const abandonLocalBtn = document.getElementById('abandonLocalBtn');
        const operationFilter = document.getElementById('operationFilter');
        const sourceFilter = document.getElementById('sourceFilter');
        const timelineContainer = document.getElementById('timelineContainer');
        const emptyState = document.getElementById('emptyState');

        // 事件监听器
        refreshBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'refreshHistory' });
        });

        downloadBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'downloadHistory' });
        });

        abandonLocalBtn.addEventListener('click', () => {
            abandonLocalBtn.disabled = true;
            abandonLocalBtn.textContent = '📥 导入中...';
            
            vscode.postMessage({ type: 'abandonLocalAndImport' });
        });

        operationFilter.addEventListener('change', applyFilters);
        sourceFilter.addEventListener('change', applyFilters);

        // 应用过滤器
        function applyFilters() {
            const operationType = operationFilter.value;
            const sourceType = sourceFilter.value;
            
            filteredEntries = allEntries.filter(entry => {
                const operationMatch = operationType === 'all' || entry.operation === operationType;
                const sourceMatch = sourceType === 'all' || entry.source === sourceType;
                return operationMatch && sourceMatch;
            });
            
            // 确保过滤后的数据仍然按时间戳降序排列（最新的在前）
            filteredEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            
            renderTimeline();
        }

        // 渲染时间线
        function renderTimeline() {
            if (filteredEntries.length === 0) {
                timelineContainer.innerHTML = '';
                emptyState.classList.remove('hidden');
                return;
            }
            
            emptyState.classList.add('hidden');
            
            const html = filteredEntries.map(entry => {
                const date = new Date(entry.timestamp);
                const timeStr = date.toLocaleString('zh-CN');
                const relativeTime = getRelativeTime(date);
                
                // 调试信息
                console.log('Processing entry:', entry);
                
                const operationIcon = getOperationIcon(entry.operation);
                const operationClass = getOperationClass(entry.operation);
                const sourceClass = entry.source || 'synced';
                
                // 特殊处理强制重置操作
                if (entry.operation === '!' || entry.operation === 'FORCE_CLEAR') {
                    return \`
                        <div class="timeline-item">
                            <div class="timeline-icon \${operationClass}">
                                \${operationIcon}
                            </div>
                            <div class="timeline-content">
                                <div class="timeline-header">
                                    <div class="timeline-title">
                                        🚨 \${getOperationText(entry.operation)}
                                    </div>
                                    <div class="timeline-time" title="\${timeStr}">
                                        \${relativeTime}
                                    </div>
                                </div>
                                <div class="timeline-path">系统重置操作 - 清空所有数据</div>
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <div class="timeline-hash">设备: \${entry.deviceTag || '未知'}</div>
                                    <span class="timeline-source \${sourceClass}">\${getSourceText(sourceClass)}</span>
                                </div>
                            </div>
                        </div>
                    \`;
                }
                
                const isDirectory = entry.fullPath.endsWith('/');
                const itemType = isDirectory ? '📁' : '📄';
                
                return \`
                    <div class="timeline-item">
                        <div class="timeline-icon \${operationClass}">
                            \${operationIcon}
                        </div>
                        <div class="timeline-content">
                            <div class="timeline-header">
                                <div class="timeline-title">
                                    \${itemType} \${getOperationText(entry.operation)} \${isDirectory ? '目录' : '文件'}
                                </div>
                                <div class="timeline-time" title="\${timeStr}">
                                    \${relativeTime}
                                </div>
                            </div>
                            <div class="timeline-path">\${entry.fullPath}</div>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div class="timeline-hash">\${entry.hash === '#' ? '目录操作' : '哈希: ' + entry.hash.substring(0, 8) + '...'}</div>
                                <div style="display: flex; gap: 8px; align-items: center;">
                                    \${entry.deviceTag ? \`<span class="timeline-device" title="设备标识">\${entry.deviceTag}</span>\` : ''}
                                    <span class="timeline-source \${sourceClass}">\${getSourceText(sourceClass)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                \`;
            }).join('');
            
            timelineContainer.innerHTML = html;
        }

        // 获取操作图标
        function getOperationIcon(operation) {
            switch (operation) {
                case '+': return '+';
                case '~': return '~';
                case '-': return '−';
                case '!': return '⚠';
                case 'ADD': return '+';
                case 'MODIFY': return '~';
                case 'DELETE': return '−';
                case 'FORCE_CLEAR': return '⚠';
                default: return '?';
            }
        }

        // 获取操作文本
        function getOperationText(operation) {
            switch (operation) {
                case '+': return '新增';
                case '~': return '修改';
                case '-': return '删除';
                case '!': return '强制重置';
                case 'ADD': return '新增';
                case 'MODIFY': return '修改';
                case 'DELETE': return '删除';
                case 'FORCE_CLEAR': return '强制重置';
                default: return '未知';
            }
        }

        // 获取操作CSS类名
        function getOperationClass(operation) {
            switch (operation) {
                case '+':
                case 'ADD': return 'add';
                case '~':
                case 'MODIFY': return 'modify';
                case '-':
                case 'DELETE': return 'delete';
                case '!':
                case 'FORCE_CLEAR': return 'force-reset';
                default: return 'unknown';
            }
        }

        // 获取数据源文本
        function getSourceText(source) {
            switch (source) {
                case 'local': return '本地';
                case 'remote': return '远程';
                case 'synced': return '已同步';
                default: return '未知';
            }
        }

        // 获取相对时间
        function getRelativeTime(date) {
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffMinutes = Math.floor(diffMs / (1000 * 60));
            const diffHours = Math.floor(diffMinutes / 60);
            const diffDays = Math.floor(diffHours / 24);
            
            if (diffMinutes < 1) return '刚刚';
            if (diffMinutes < 60) return \`\${diffMinutes}分钟前\`;
            if (diffHours < 24) return \`\${diffHours}小时前\`;
            if (diffDays < 7) return \`\${diffDays}天前\`;
            return date.toLocaleDateString('zh-CN');
        }

        // 更新统计信息
        function updateStats(stats) {
            document.getElementById('totalCount').textContent = stats.total;
            document.getElementById('addCount').textContent = stats.adds;
            document.getElementById('modifyCount').textContent = stats.modifies;
            document.getElementById('deleteCount').textContent = stats.deletes;
            document.getElementById('forceResetCount').textContent = stats.forceResets;
            document.getElementById('localChanges').textContent = stats.localChanges;
            document.getElementById('remoteChanges').textContent = stats.remoteChanges;
            document.getElementById('syncedChanges').textContent = stats.syncedChanges;
        }

        // 更新同步状态
        function updateSyncStatus(syncStatus, syncConfig) {
            const connectionDot = document.getElementById('connectionDot');
            const connectionText = document.getElementById('connectionText');
            const storageConfig = document.getElementById('storageConfig');
            const lastActivity = document.getElementById('lastActivity');
            
            if (syncStatus.isConnected) {
                connectionDot.className = 'status-dot connected';
                connectionText.textContent = '已连接';
            } else {
                connectionDot.className = 'status-dot disconnected';
                connectionText.textContent = '未连接';
            }
            
            if (syncConfig.endpoint) {
                storageConfig.textContent = \`\${syncConfig.endpoint}/\${syncConfig.bucket}\`;
            } else {
                storageConfig.textContent = '未配置';
            }
            
            if (syncStatus.lastSyncTime) {
                const lastSync = new Date(syncStatus.lastSyncTime);
                lastActivity.textContent = lastSync.toLocaleString('zh-CN');
            } else {
                lastActivity.textContent = '无';
            }
        }

        // 处理来自扩展的消息
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'loading':
                    loadingState.classList.remove('hidden');
                    errorState.classList.add('hidden');
                    contentArea.classList.add('hidden');
                    break;
                    
                case 'error':
                    loadingState.classList.add('hidden');
                    errorState.classList.remove('hidden');
                    errorState.textContent = message.message;
                    contentArea.classList.add('hidden');
                    break;
                    
                case 'historyData':
                    loadingState.classList.add('hidden');
                    errorState.classList.add('hidden');
                    contentArea.classList.remove('hidden');
                    
                    allEntries = message.data.entries;
                    filteredEntries = [...allEntries];
                    
                    updateStats(message.data.stats);
                    updateSyncStatus(message.data.syncStatus, message.data.syncConfig);
                    renderTimeline();
                    break;
                
                case 'rawHistoryData':
                    handleRawHistoryData(message.data);
                    break;

                case 'abandonLocalStarted':
                    loadingState.classList.remove('hidden');
                    loadingState.innerHTML = '<p>' + message.message + '</p>';
                    break;

                case 'abandonLocalResult':
                    abandonLocalBtn.disabled = false;
                    abandonLocalBtn.textContent = '📥 从云端导入';
                    
                    if (message.success) {
                        // 成功后重新加载历史记录
                        vscode.postMessage({ type: 'loadHistory' });
                    } else {
                        loadingState.classList.add('hidden');
                        errorState.classList.remove('hidden');
                        errorState.textContent = message.message;
                    }
                    break;
            }
        });

        // 添加原始历史记录对话框
        function createRawHistoryDialog() {
            // 如果已经存在，先移除
            const existingDialog = document.querySelector('.raw-history-dialog');
            if (existingDialog) {
                document.body.removeChild(existingDialog);
            }
            
            const dialog = document.createElement('div');
            dialog.className = 'raw-history-dialog hidden';
            dialog.innerHTML = \`
                <div class="raw-history-content">
                    <div class="raw-history-header">
                        <h3>原始历史记录</h3>
                        <button id="closeRawHistoryBtn" class="btn btn-secondary">✕ 关闭</button>
                    </div>
                    <div class="raw-history-tabs">
                        <button id="localHistoryTab" class="history-tab active">本地历史</button>
                        <button id="remoteHistoryTab" class="history-tab">云端历史</button>
                    </div>
                    <div class="raw-history-bodies">
                        <div id="localHistoryBody" class="history-body">
                            <pre id="localHistoryContent"></pre>
                        </div>
                        <div id="remoteHistoryBody" class="history-body hidden">
                            <pre id="remoteHistoryContent"></pre>
                        </div>
                    </div>
                </div>
            \`;
            document.body.appendChild(dialog);
            
            // 绑定事件 - 使用事件委托避免事件绑定问题
            dialog.addEventListener('click', (event) => {
                if (event.target.id === 'closeRawHistoryBtn' || event.target.closest('#closeRawHistoryBtn')) {
                    dialog.classList.add('hidden');
                }
            });
            
            const localTab = document.getElementById('localHistoryTab');
            const remoteTab = document.getElementById('remoteHistoryTab');
            const localBody = document.getElementById('localHistoryBody');
            const remoteBody = document.getElementById('remoteHistoryBody');
            
            localTab.addEventListener('click', () => {
                localTab.classList.add('active');
                remoteTab.classList.remove('active');
                localBody.classList.remove('hidden');
                remoteBody.classList.add('hidden');
            });
            
            remoteTab.addEventListener('click', () => {
                remoteTab.classList.add('active');
                localTab.classList.remove('active');
                remoteBody.classList.remove('hidden');
                localBody.classList.add('hidden');
            });
            
            return dialog;
        }
        
        // 创建对话框
        const rawHistoryDialog = createRawHistoryDialog();
        
        // 绑定查看原始历史记录按钮
        const viewRawBtn = document.getElementById('viewRawBtn');
        viewRawBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'viewRawHistory' });
        });
        
        // 接收原始历史记录数据
        function handleRawHistoryData(data) {
            const localContent = document.getElementById('localHistoryContent');
            const remoteContent = document.getElementById('remoteHistoryContent');
            
            localContent.textContent = data.local || '无本地历史记录';
            remoteContent.textContent = data.remote || '无远端历史记录';
            
            rawHistoryDialog.classList.remove('hidden');
        }

        // 页面加载时请求数据
        vscode.postMessage({ type: 'loadHistory' });
    </script>
    
    <style>
        .raw-history-dialog {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, 0.7);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        
        .hidden {
            display: none !important;
        }
        
        .raw-history-content {
            width: 80%;
            height: 80%;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            display: flex;
            flex-direction: column;
        }
        
        .raw-history-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .raw-history-tabs {
            display: flex;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .history-tab {
            padding: 10px 20px;
            background: none;
            border: none;
            cursor: pointer;
            color: var(--vscode-descriptionForeground);
        }
        
        .history-tab.active {
            border-bottom: 2px solid var(--vscode-textLink-foreground);
            color: var(--vscode-textLink-foreground);
        }
        
        .raw-history-bodies {
            flex: 1;
            overflow: hidden;
            position: relative;
        }
        
        .history-body {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            overflow: auto;
            padding: 20px;
        }
        
        .history-body pre {
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            white-space: pre-wrap;
            margin: 0;
        }
    </style>
</body>
</html>`;
  }
}