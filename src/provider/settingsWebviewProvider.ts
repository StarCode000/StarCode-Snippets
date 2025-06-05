import * as vscode from 'vscode'
import { CloudSyncConfig, CloudSyncStatus, GitPlatformConfig, MultiPlatformCloudSyncConfig } from '../types/types'
import { SettingsManager } from '../utils/settingsManager'
import { CloudSyncManager } from '../utils/cloudSyncManager'
import { StorageManager } from '../storage/storageManager'
import { ContextManager } from '../utils/contextManager'
import { PathUtils } from '../utils/pathUtils'

export class SettingsWebviewProvider {
  public static readonly viewType = 'starcode-snippets.settings'
  private static currentPanel: vscode.WebviewPanel | undefined

  private constructor() {}

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined

    // 如果已经有设置面板打开，就激活它
    if (SettingsWebviewProvider.currentPanel) {
      SettingsWebviewProvider.currentPanel.reveal(column)
      return
    }

    // 创建新的WebView面板
    const panel = vscode.window.createWebviewPanel(
      SettingsWebviewProvider.viewType,
      '云端同步设置',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: true,
      }
    )

    SettingsWebviewProvider.currentPanel = panel
    const provider = new SettingsWebviewProvider()
    provider._setupWebview(panel, extensionUri)

    // 当面板被关闭时，清理引用
    panel.onDidDispose(() => {
      SettingsWebviewProvider.currentPanel = undefined
    }, null)
  }

  private _setupWebview(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    // 设置webview的HTML内容
    panel.webview.html = this._getHtmlForWebview(panel.webview, extensionUri)
    
    // 设置webview消息处理
    panel.webview.onDidReceiveMessage(
      async (message) => {
        // console.log('接收到WebView消息:', message.type)
        
        switch (message.type) {
          case 'getConfig':
            await this._sendConfigToWebview(panel)
            break
          case 'saveConfig':
            await this._saveConfig(message.config, panel)
            break
          case 'testConnection':
            await this._testConnection(message.config, panel)
            break
          case 'resetConfig':
            await this._resetConfig(panel)
            break
          case 'manualSync':
            await this._performManualSync(panel)
            break
          case 'exportSettings':
            await this._exportSettings(panel)
            break
          case 'importSettings':
            await this._importSettings(panel)
            break
          case 'saveAllPlatforms':
            // 保存状态，用于在处理过程中使用
            if (message.activePlatform) {
              // 在webview对象上存储当前活动平台信息
              (panel.webview as any)._state = {
                ...(panel.webview as any)._state,
                activePlatform: message.activePlatform
              };
              // console.log('保存当前活动平台状态:', message.activePlatform);
            }
            await this._saveAllPlatforms(message.configs, panel)
            break
          case 'addPlatformConfig':
            await this._addPlatformConfig(message.provider, panel)
            break
          case 'updatePlatformConfig':
            await this._updatePlatformConfig(message.config, panel)
            break
          case 'deletePlatformConfig':
            await this._deletePlatformConfig(message.configId, panel)
            break
          case 'activatePlatformConfig':
            await this._activatePlatformConfig(message.configId, panel)
            break
                  case 'testPlatformConnection':
          await this._testPlatformConnection(message.config, panel)
          break
        case 'loadConfig':
          await this._sendConfigToWebview(panel)
          break
      }
      }
    )

    // 初始加载配置
    this._sendConfigToWebview(panel)
    
    // 尝试迁移旧配置到多平台系统
    this._migrateToMultiPlatform()
  }

  // 尝试迁移旧配置到多平台系统
  private async _migrateToMultiPlatform() {
    try {
      await SettingsManager.migrateToMultiPlatform()
    } catch (error) {
      console.error('迁移配置失败:', error)
    }
  }

  // 添加新的Git平台配置
  private async _addPlatformConfig(provider: 'github' | 'gitlab' | 'gitee', panel: vscode.WebviewPanel) {
    try {
      // 验证平台类型
      if (!['github', 'gitlab', 'gitee'].includes(provider)) {
        throw new Error('不支持的Git平台类型')
      }
      
      const newConfig = await SettingsManager.addPlatformConfig(provider, true)
      
      panel.webview.postMessage({
        type: 'platformConfigAdded',
        config: newConfig,
        message: `已创建新的 ${provider.toUpperCase()} 配置`
      })
      
      // 重新加载所有配置
      await this._sendConfigToWebview(panel)
      
      vscode.window.showInformationMessage(`已创建新的 ${provider.toUpperCase()} 配置`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '创建配置时发生错误'
      panel.webview.postMessage({
        type: 'platformConfigError',
        message: errorMessage,
      })
      vscode.window.showErrorMessage(`创建配置失败: ${errorMessage}`)
    }
  }
  
  // 更新Git平台配置
  private async _updatePlatformConfig(config: GitPlatformConfig, panel: vscode.WebviewPanel) {
    try {
      const validation = SettingsManager.validatePlatformConfig(config)
      if (!validation.isValid) {
        panel.webview.postMessage({
          type: 'validationError',
          errors: validation.errors,
        })
        return
      }
      
      await SettingsManager.updatePlatformConfig(config)
      
      panel.webview.postMessage({
        type: 'platformConfigUpdated',
        config: config,
        message: `配置 "${config.name}" 已更新`
      })
      
      // 重新加载所有配置
      await this._sendConfigToWebview(panel)
      
      vscode.window.showInformationMessage(`配置 "${config.name}" 已更新`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '更新配置时发生错误'
      panel.webview.postMessage({
        type: 'platformConfigError',
        message: errorMessage,
      })
      vscode.window.showErrorMessage(`更新配置失败: ${errorMessage}`)
    }
  }
  
  // 删除Git平台配置
  private async _deletePlatformConfig(configId: string, panel: vscode.WebviewPanel) {
    try {
      // console.log('后端收到删除请求，配置ID:', configId)
      
      // 获取要删除的配置信息
      const multiConfig = SettingsManager.getMultiPlatformCloudSyncConfig()
      const platformToDelete = multiConfig.platforms.find(p => p.id === configId)
      
      if (!platformToDelete) {
        throw new Error(`未找到ID为 ${configId} 的平台配置`)
      }
      
      // console.log('找到要删除的配置:', platformToDelete.provider, platformToDelete.name)
      
      // 显示确认对话框
      const confirmDelete = await vscode.window.showWarningMessage(
        `确定要删除 ${platformToDelete.name} 配置吗？此操作不可撤销。`,
        { modal: true },
        '确定删除',
        '取消'
      )
      
      if (confirmDelete !== '确定删除') {
        // console.log('用户取消删除操作')
        panel.webview.postMessage({
          type: 'platformConfigError',
          message: '用户取消删除操作'
        })
        return
      }
      
      await SettingsManager.deletePlatformConfig(configId)
      // console.log('平台配置删除成功')
      
      panel.webview.postMessage({
        type: 'platformConfigDeleted',
        configId: configId,
        message: '配置已删除'
      })
      
      // 重新加载所有配置
      await this._sendConfigToWebview(panel)
      
      vscode.window.showInformationMessage(`${platformToDelete.name} 已删除`)
    } catch (error) {
      console.error('删除平台配置失败:', error)
      const errorMessage = error instanceof Error ? error.message : '删除配置时发生错误'
      panel.webview.postMessage({
        type: 'platformConfigError',
        message: errorMessage,
      })
      vscode.window.showErrorMessage(`删除配置失败: ${errorMessage}`)
    }
  }
  
  // 激活Git平台配置
  private async _activatePlatformConfig(configId: string, panel: vscode.WebviewPanel) {
    try {
      await SettingsManager.activatePlatformConfig(configId)
      
      panel.webview.postMessage({
        type: 'platformConfigActivated',
        configId: configId,
        message: '配置已激活'
      })
      
      // 重新加载所有配置
      await this._sendConfigToWebview(panel)
      
      vscode.window.showInformationMessage('配置已激活')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '激活配置时发生错误'
      panel.webview.postMessage({
        type: 'platformConfigError',
        message: errorMessage,
      })
      vscode.window.showErrorMessage(`激活配置失败: ${errorMessage}`)
    }
  }
  
  // 测试Git平台配置连接
  private async _testPlatformConnection(config: GitPlatformConfig, panel: vscode.WebviewPanel) {
    // console.log('开始平台配置连接测试...')
    try {
      panel.webview.postMessage({
        type: 'testingConnection',
        configId: config.id,
        message: '正在测试连接...',
      })
      
      // 转换为传统配置格式进行测试
      const legacyConfig: CloudSyncConfig = {
        provider: config.provider,
        repositoryUrl: config.repositoryUrl,
        token: config.token,
        localPath: config.localPath || PathUtils.getDefaultLocalRepoPath(),
        defaultBranch: config.defaultBranch,
        authenticationMethod: config.authenticationMethod,
        sshKeyPath: config.sshKeyPath,
        autoSync: false, // 这些不影响连接测试
        syncInterval: 15,
        commitMessageTemplate: config.commitMessageTemplate
      }

      // 使用CloudSyncManager进行真实连接测试
      // console.log('创建CloudSyncManager实例...')
      const context = SettingsManager.getExtensionContext()
      if (!context) {
        throw new Error('扩展上下文未初始化')
      }

      const cloudSyncManager = new CloudSyncManager(context)
      cloudSyncManager.updateConfig(legacyConfig) // 使用转换后的配置

      // console.log('调用testConnection方法...')
      const result = await cloudSyncManager.testConnection()
      // console.log('连接测试结果:', result)

      panel.webview.postMessage({
        type: 'platformTestResult',
        configId: config.id,
        success: result.success,
        message: result.message,
      })

      // 同时显示VSCode通知
      if (result.success) {
        vscode.window.showInformationMessage(`配置 "${config.name}" 连接测试成功: ${result.message}`)
      } else {
        vscode.window.showWarningMessage(`配置 "${config.name}" 连接测试失败: ${result.message}`)
      }

      // 只更新连接测试状态，不重新加载整个配置
      if (config.isActive) {
        // 如果是激活的配置，同时更新全局状态
        const status = SettingsManager.getCloudSyncStatus()
        status.isConnected = result.success
        status.lastError = result.success ? null : result.message
        await SettingsManager.saveCloudSyncStatus(status)

        panel.webview.postMessage({
          type: 'statusUpdate',
          status: status,
        })
      }
    } catch (error) {
      console.error('连接测试异常:', error)
      const errorMessage = error instanceof Error ? error.message : '连接测试失败'

      panel.webview.postMessage({
        type: 'platformTestResult',
        configId: config.id,
        success: false,
        message: errorMessage,
      })

      // 显示VSCode错误通知
      vscode.window.showErrorMessage(`配置 "${config.name}" 连接测试异常: ${errorMessage}`)
    }
  }

  private async _saveConfig(config: CloudSyncConfig, panel: vscode.WebviewPanel) {
    try {
      const validation = SettingsManager.validateConfig(config)
      if (!validation.isValid) {
        panel.webview.postMessage({
          type: 'validationError',
          errors: validation.errors,
        })
        return
      }

      // console.log('保存配置:', config.provider, '仓库URL:', config.repositoryUrl || '(空)')
      
      await SettingsManager.saveCloudSyncConfig(config)

      // 发送保存成功消息到前端
      panel.webview.postMessage({
        type: 'saveSuccess',
        message: `${config.provider ? config.provider.toUpperCase() : '配置'} 保存成功`,
      })

      // 显示VSCode通知
      const platformName = config.provider ? 
        `${config.provider.charAt(0).toUpperCase()}${config.provider.slice(1)}` : 
        '配置'
      vscode.window.showInformationMessage(`${platformName} 云端同步配置已保存`)
      
      // 重新加载配置，确保多平台和传统配置保持同步
      await this._sendConfigToWebview(panel)
    } catch (error) {
      console.error('保存配置失败:', error)
      const errorMessage = error instanceof Error ? error.message : '保存配置时发生错误'
      panel.webview.postMessage({
        type: 'saveError',
        message: errorMessage,
      })
      vscode.window.showErrorMessage(`保存配置失败: ${errorMessage}`)
    }
  }

  private async _testConnection(config: CloudSyncConfig, panel: vscode.WebviewPanel) {
    // console.log('开始连接测试...')
    try {
      panel.webview.postMessage({
        type: 'testingConnection',
        message: '正在测试连接...',
      })

      // 使用CloudSyncManager进行真实连接测试
      // console.log('创建CloudSyncManager实例...')
      const context = SettingsManager.getExtensionContext()
      if (!context) {
        throw new Error('扩展上下文未初始化')
      }

      const cloudSyncManager = new CloudSyncManager(context)
      cloudSyncManager.updateConfig(config) // 使用最新配置

      // console.log('调用testConnection方法...')
      const result = await cloudSyncManager.testConnection()
      // console.log('连接测试结果:', result)

      panel.webview.postMessage({
        type: 'testResult',
        success: result.success,
        message: result.message,
      })

      // 同时显示VSCode通知
      if (result.success) {
        vscode.window.showInformationMessage(`连接测试成功: ${result.message}`)
      } else {
        vscode.window.showWarningMessage(`连接测试失败: ${result.message}`)
      }

      // 更新状态
      const status = SettingsManager.getCloudSyncStatus()
      status.isConnected = result.success
      status.lastError = result.success ? null : result.message
      await SettingsManager.saveCloudSyncStatus(status)

      // 只更新状态显示，不重新加载整个配置
      panel.webview.postMessage({
        type: 'statusUpdate',
        status: status,
      })
    } catch (error) {
      console.error('连接测试异常:', error)
      const errorMessage = error instanceof Error ? error.message : '连接测试失败'

      panel.webview.postMessage({
        type: 'testResult',
        success: false,
        message: errorMessage,
      })

      // 显示VSCode错误通知
      vscode.window.showErrorMessage(`连接测试异常: ${errorMessage}`)

      // 更新状态
      const status = SettingsManager.getCloudSyncStatus()
      status.isConnected = false
      status.lastError = errorMessage
      await SettingsManager.saveCloudSyncStatus(status)

      // 只更新状态显示，不重新加载整个配置
      panel.webview.postMessage({
        type: 'statusUpdate',
        status: status,
      })
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
      )

      if (confirmReset !== '确定重置') {
        panel.webview.postMessage({
          type: 'resetSuccess',
          message: '用户取消重置操作',
        })
        return
      }

      // 重置配置
      const defaultConfig: CloudSyncConfig = {
        provider: 'github',
        repositoryUrl: '',
        token: '',
        localPath: '',
        defaultBranch: 'main',
        authenticationMethod: 'token',
        sshKeyPath: '',
        autoSync: false,
        syncInterval: 15,
        commitMessageTemplate: 'Sync snippets: {timestamp}',
      }

      await SettingsManager.saveCloudSyncConfig(defaultConfig)

      // 发送成功消息
      panel.webview.postMessage({
        type: 'resetSuccess',
        message: '配置已重置',
      })

      // 重新发送配置数据
      await this._sendConfigToWebview(panel)
    } catch (error) {
      console.error('重置配置失败:', error)
      panel.webview.postMessage({
        type: 'saveError',
        message: `重置配置失败: ${error}`,
      })
    }
  }

  private async _sendConfigToWebview(panel: vscode.WebviewPanel) {
    try {
      // 获取传统配置（向后兼容）
    const config = SettingsManager.getCloudSyncConfig()
      
      // 获取多平台配置
      const multiConfig = SettingsManager.getMultiPlatformCloudSyncConfig()
      
      // 获取当前激活的平台配置
      const activePlatform = SettingsManager.getActivePlatformConfig()
      
      // 获取同步状态
    const status = SettingsManager.getCloudSyncStatus()

      // 获取本地路径描述
      const localPathDescription = SettingsManager.getLocalPathDescription()
      const isUsingDefaultPath = SettingsManager.isUsingDefaultPath()
      const defaultLocalPath = PathUtils.getDefaultLocalRepoPath()
      
      // 获取所有平台的实际解析路径
      const platformPaths: { [provider: string]: string } = {}
      if (multiConfig.platforms) {
        multiConfig.platforms.forEach(platform => {
          const resolvedPath = PathUtils.resolveDefaultPathToken(platform.localPath || '', platform.provider)
          platformPaths[platform.provider] = resolvedPath
        })
      }
      
      // 如果有激活平台，也添加其路径
      if (activePlatform) {
        const resolvedPath = PathUtils.resolveDefaultPathToken(activePlatform.localPath || '', activePlatform.provider)
        platformPaths[activePlatform.provider] = resolvedPath
      }
      
      // 检查多平台路径冲突
      const pathConflicts = PathUtils.checkPathConflicts(multiConfig.platforms)
      
      // 检查是否有配置在读取时被自动调整了路径
      const hasAutoAdjustedPaths = multiConfig.platforms.some(platform => 
        platform.localPath && (
          platform.localPath === 'GITHUB_DEFAULT_REPO' || 
          platform.localPath === 'GITLAB_DEFAULT_REPO' || 
          platform.localPath === 'GITEE_DEFAULT_REPO'
        )
      )
      
      // 发送所有配置数据到WebView
    panel.webview.postMessage({
        type: 'configLoaded',
        config: config,
        multiConfig: multiConfig,
        activePlatform: activePlatform,
        status: status,
        localPathDescription: localPathDescription,
        isUsingDefaultPath: isUsingDefaultPath,
        defaultLocalPath: defaultLocalPath,
        pathConflicts: pathConflicts,
        hasAutoAdjustedPaths: hasAutoAdjustedPaths,
        platformPaths: platformPaths // 添加解析后的实际路径
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '加载配置时发生错误'
      panel.webview.postMessage({
        type: 'loadError',
        message: errorMessage,
    })
      vscode.window.showErrorMessage(`加载配置失败: ${errorMessage}`)
    }
  }

  private async _performManualSync(panel: vscode.WebviewPanel) {
    try {

      panel.webview.postMessage({
        type: 'syncStarted',
        message: '正在执行手动同步...',
      })

      const context = SettingsManager.getExtensionContext()
      if (!context) {
        throw new Error('扩展上下文未初始化')
      }

      // 使用StorageContext来获取正确版本的数据
      const { StorageStrategyFactory } = await import('../utils/storageStrategy')
      const { StorageContext } = await import('../utils/storageContext')
      
      const storageStrategy = StorageStrategyFactory.createStrategy(context)
      const storageContext = new StorageContext(storageStrategy)
      
      // console.log(`手动同步使用存储版本: ${storageContext.getVersion()}`)
      
      const cloudSyncManager = new CloudSyncManager(context, null) // 传递null，CloudSyncManager不直接使用storageManager

      const [snippets, directories] = await Promise.all([
        storageContext.getAllSnippets(),
        storageContext.getAllDirectories(),
      ])

      // console.log(`手动同步获取到数据: ${snippets.length} 个代码片段, ${directories.length} 个目录`)

      const result = await cloudSyncManager.performSync(snippets, directories)

      panel.webview.postMessage({
        type: 'manualSyncResult',
        success: result.success,
        message: result.message,
      })

      if (result.success) {
        vscode.window.showInformationMessage(`手动同步成功: ${result.message}`)
        
        // 手动同步成功后刷新树视图
        setTimeout(() => {
          vscode.commands.executeCommand('starcode-snippets.refreshExplorer')
        }, 500)
      } else {
        vscode.window.showWarningMessage(`手动同步失败: ${result.message}`)
      }

      // 更新状态显示
      const status = SettingsManager.getCloudSyncStatus()
      panel.webview.postMessage({
        type: 'statusUpdate',
        status: status,
      })
    } catch (error) {
      console.error('手动同步异常:', error)
      const errorMessage = error instanceof Error ? error.message : '手动同步失败'

      panel.webview.postMessage({
        type: 'manualSyncResult',
        success: false,
        message: errorMessage,
      })

      vscode.window.showErrorMessage(`手动同步异常: ${errorMessage}`)
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
      )

      if (securityWarning !== '继续导出') {
        panel.webview.postMessage({
          type: 'exportResult',
          success: false,
          message: '用户取消导出操作',
        })
        return
      }

      // 获取所有配置数据
      const config = SettingsManager.getCloudSyncConfig()
      const status = SettingsManager.getCloudSyncStatus()
      const multiConfig = SettingsManager.getMultiPlatformCloudSyncConfig()
      const storageVersion = vscode.workspace.getConfiguration('starcode-snippets').get('storageVersion', 'v2')

      // 创建完整的导出数据
      const exportData = {
        version: '3.0', // 升级版本号，表示包含多平台配置
        exportTime: new Date().toISOString(),
        warning: '⚠️ 此文件包含敏感信息，请妥善保管！',
        // 传统单平台配置（向后兼容）
        config: {
          provider: config.provider,
          repositoryUrl: config.repositoryUrl,
          token: config.token,
          localPath: config.localPath,
          defaultBranch: config.defaultBranch,
          authenticationMethod: config.authenticationMethod,
          sshKeyPath: config.sshKeyPath,
          autoSync: config.autoSync,
          syncInterval: config.syncInterval,
          commitMessageTemplate: config.commitMessageTemplate,
        },
        // 多平台配置系统
        multiPlatformConfig: {
          platforms: multiConfig.platforms,
          autoSync: multiConfig.autoSync,
          syncInterval: multiConfig.syncInterval,
          activeConfigId: multiConfig.activeConfigId,
        },
        // 同步状态
        status: {
          isConnected: status.isConnected,
          lastSyncTime: status.lastSyncTime,
          lastError: status.lastError,
          isSyncing: status.isSyncing,
        },
        // 系统配置
        system: {
          storageVersion: storageVersion,
        },
      }

      const exportJson = JSON.stringify(exportData, null, 2)

      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`starcode-sync-settings-${new Date().toISOString().split('T')[0]}.json`),
        filters: {
          'JSON files': ['json'],
          'All files': ['*'],
        },
      })

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(exportJson, 'utf8'))

        // 统计导出的配置信息
        const platformCount = multiConfig.platforms ? multiConfig.platforms.length : 0
        const hasMultiPlatform = platformCount > 0
        const hasTraditionalConfig = config.provider && config.repositoryUrl
        const hasCredentials = (config.token || config.sshKeyPath) || 
          (multiConfig.platforms && multiConfig.platforms.some(p => p.token || p.sshKeyPath))

        let exportMessage = '设置导出成功'
        let detailMessage = `✅ 设置已导出到: ${uri.fsPath}\n\n📋 导出内容:`

        if (hasMultiPlatform) {
          exportMessage += `（包含 ${platformCount} 个平台配置`
          detailMessage += `\n• ${platformCount} 个平台配置`
        }
        if (hasTraditionalConfig) {
          if (hasMultiPlatform) {
            detailMessage += `\n• 传统单平台配置（向后兼容）`
          } else {
            exportMessage += '（包含传统配置'
            detailMessage += `\n• 传统单平台配置`
          }
        }
        if (hasCredentials) {
          exportMessage += hasMultiPlatform || hasTraditionalConfig ? '，含访问凭据）' : '（含访问凭据）'
          detailMessage += `\n• 访问凭据信息`
        } else {
          exportMessage += hasMultiPlatform || hasTraditionalConfig ? '）' : ''
        }

        detailMessage += `\n• 同步状态信息`
        detailMessage += `\n• 系统配置（存储版本: ${storageVersion}）`
        detailMessage += `\n\n🔒 请注意：文件包含敏感信息，请妥善保管！`

        panel.webview.postMessage({
          type: 'exportResult',
          success: true,
          message: exportMessage,
        })

        // 再次提醒安全注意事项
        vscode.window.showInformationMessage(detailMessage, '我知道了')
      }
    } catch (error) {
      console.error('导出设置失败:', error)
      const errorMessage = error instanceof Error ? error.message : '导出设置失败'

      panel.webview.postMessage({
        type: 'exportResult',
        success: false,
        message: errorMessage,
      })

      vscode.window.showErrorMessage(`导出设置失败: ${errorMessage}`)
    }
  }

  private async _saveAllPlatforms(configs: { [provider: string]: CloudSyncConfig }, panel: vscode.WebviewPanel) {
    try {
      // console.log('开始批量保存所有平台配置...');
      
      // 获取要激活的平台信息（如果有）
      const activePlatform = (panel.webview as any)._state?.activePlatform;
      // console.log('要激活的平台:', activePlatform || '无');
      
      const savedCount = await SettingsManager.saveBatchPlatformConfigs(configs);
      
      // 如果有指定的活动平台，确保激活它
      if (activePlatform && configs[activePlatform]) {
        // console.log('尝试激活平台:', activePlatform);
        
        // 获取多平台配置
        const multiConfig = SettingsManager.getMultiPlatformCloudSyncConfig();
        const platformToActivate = multiConfig.platforms.find(p => p.provider === activePlatform);
        
        if (platformToActivate) {
          // console.log('找到平台配置，激活ID:', platformToActivate.id);
          await SettingsManager.activatePlatformConfig(platformToActivate.id);
        }
      }
      
      panel.webview.postMessage({
        type: 'saveAllPlatformsResult',
        success: true,
        message: `成功保存 ${savedCount} 个平台配置`,
        savedCount: savedCount
      });
      
      vscode.window.showInformationMessage(`批量保存完成：成功保存 ${savedCount} 个平台配置`);
      
      // 重新加载配置
      await this._sendConfigToWebview(panel);
    } catch (error) {
      console.error('批量保存配置失败:', error);
      let errorMessage = error instanceof Error ? error.message : '批量保存配置失败';
      let userFriendlyMessage = errorMessage;
      
      // 为权限错误提供更友好的错误信息
      if (errorMessage.includes('EPERM') || errorMessage.includes('NoPermissions')) {
        userFriendlyMessage = '配置保存失败：VSCode设置文件权限不足或被占用。\n\n建议解决方案：\n1. 关闭其他可能打开VSCode设置的程序\n2. 以管理员身份运行VSCode\n3. 检查文件是否被杀毒软件锁定\n4. 重启VSCode后重试';
        
        // 显示详细的错误对话框
                 vscode.window.showErrorMessage(
           userFriendlyMessage,
           { modal: true },
           '重试保存',
           '诊断权限问题',
           '以管理员身份重启',
           '查看详细错误'
         ).then(async (selection) => {
           if (selection === '重试保存') {
             // 重新尝试保存
             setTimeout(() => {
               this._saveAllPlatforms(configs, panel);
             }, 1000);
           } else if (selection === '诊断权限问题') {
             // 运行权限诊断命令
             vscode.commands.executeCommand('starcode-snippets.diagnoseConfigPermissions');
           } else if (selection === '以管理员身份重启') {
             vscode.window.showInformationMessage(
               '请关闭VSCode，然后右键点击VSCode图标选择"以管理员身份运行"'
             );
           } else if (selection === '查看详细错误') {
             vscode.window.showErrorMessage(`详细错误信息：\n${errorMessage}`);
           }
         });
      }
      
      panel.webview.postMessage({
        type: 'saveAllPlatformsResult',
        success: false,
        message: userFriendlyMessage,
        savedCount: 0
      });
      
      // 如果不是权限错误，显示普通错误提示
      if (!errorMessage.includes('EPERM') && !errorMessage.includes('NoPermissions')) {
        vscode.window.showErrorMessage(`批量保存失败: ${errorMessage}`);
      }
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
      )

      if (confirmImport !== '继续导入') {
        panel.webview.postMessage({
          type: 'importResult',
          success: false,
          message: '用户取消导入操作',
        })
        return
      }

      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
          'JSON files': ['json'],
          'All files': ['*'],
        },
      })

      if (!uris || uris.length === 0) {
        return
      }

      const fileContent = await vscode.workspace.fs.readFile(uris[0])
      const importText = new TextDecoder().decode(fileContent)

      let importData
      try {
        importData = JSON.parse(importText)
      } catch (parseError) {
        throw new Error('文件格式无效，请选择有效的JSON文件')
      }

      // 验证导入数据格式
      if (!importData.version) {
        throw new Error('文件格式不正确，缺少版本信息')
      }

      let importMessage = '设置导入成功'
      let notificationMessage = `设置已从 ${uris[0].fsPath} 导入成功`
      let importedPlatformsCount = 0
      let hasCredentials = false
      
      // 声明路径处理结果变量，以便在不同作用域中使用
      let pathProcessingResults: Array<{ platform: string; wasModified: boolean; reason?: string }> = []

      // 根据版本号处理不同格式的配置文件
      const version = parseFloat(importData.version)

      if (version >= 3.0) {
        // 新版本格式：包含多平台配置
        if (!importData.multiPlatformConfig && !importData.config) {
          throw new Error('文件格式不正确，缺少配置信息')
        }

        // 导入多平台配置
        if (importData.multiPlatformConfig) {
          const multiConfig = importData.multiPlatformConfig
          
          // 统计平台数量和检查凭据
          if (multiConfig.platforms && Array.isArray(multiConfig.platforms)) {
            importedPlatformsCount = multiConfig.platforms.length
            hasCredentials = multiConfig.platforms.some((platform: any) => 
              platform.token || platform.sshKeyPath
            )

            // 使用批量保存方法导入所有平台
            const platformConfigs: { [provider: string]: any } = {}
            
            for (const platform of multiConfig.platforms) {
              if (platform.provider && ['github', 'gitlab', 'gitee'].includes(platform.provider)) {
                // 智能处理导入的路径，检查跨平台兼容性
                const pathResult = PathUtils.processImportedPath(platform.localPath, platform.provider)
                
                if (pathResult.wasModified) {
                  pathProcessingResults.push({
                    platform: platform.provider,
                    wasModified: true,
                    reason: pathResult.reason
                  })
                }

                platformConfigs[platform.provider] = {
                  provider: platform.provider,
                  repositoryUrl: platform.repositoryUrl || '',
                  token: platform.token || '',
                  localPath: pathResult.processedPath,
                  defaultBranch: platform.defaultBranch || 'main',
                  authenticationMethod: platform.authenticationMethod || 'token',
                  sshKeyPath: platform.sshKeyPath || '',
                  commitMessageTemplate: platform.commitMessageTemplate || 'Sync snippets: {timestamp}',
                  autoSync: multiConfig.autoSync !== undefined ? multiConfig.autoSync : false,
                  syncInterval: multiConfig.syncInterval || 15,
                }
              }
            }

            // 如果有路径被修改，通知用户
            if (pathProcessingResults.length > 0) {
              const modifiedPlatforms = pathProcessingResults.map(result => {
                const platformName = result.platform.charAt(0).toUpperCase() + result.platform.slice(1)
                return `${platformName}: ${result.reason}`
              }).join('\n')
              
              vscode.window.showWarningMessage(
                `跨平台兼容性检查：部分平台的本地路径已调整为默认路径\n\n${modifiedPlatforms}`,
                '我知道了'
              )
            }

            // 批量保存平台配置
            if (Object.keys(platformConfigs).length > 0) {
              await SettingsManager.saveBatchPlatformConfigs(platformConfigs)
            }

            // 如果有指定的激活配置，尝试激活它
            if (multiConfig.activeConfigId && multiConfig.platforms) {
              const activePlatform = multiConfig.platforms.find((p: any) => p.id === multiConfig.activeConfigId)
              if (activePlatform && activePlatform.provider) {
                // 查找对应的新配置ID并激活
                const newMultiConfig = SettingsManager.getMultiPlatformCloudSyncConfig()
                const newActivePlatform = newMultiConfig.platforms.find(p => p.provider === activePlatform.provider)
                if (newActivePlatform) {
                  await SettingsManager.activatePlatformConfig(newActivePlatform.id)
                }
              }
            }
          }
        }

        // 导入系统配置
        if (importData.system && importData.system.storageVersion) {
          const config = vscode.workspace.getConfiguration('starcode-snippets')
          await config.update('storageVersion', importData.system.storageVersion, vscode.ConfigurationTarget.Global)
        }

        // 更新消息
        if (importedPlatformsCount > 0) {
          importMessage = `成功导入 ${importedPlatformsCount} 个平台配置`
          notificationMessage = `设置已从 ${uris[0].fsPath} 导入成功\n\n导入了 ${importedPlatformsCount} 个平台配置`
          
          if (hasCredentials) {
            importMessage += '（包含访问凭据）'
            notificationMessage += '，包含访问凭据'
          }

          if (pathProcessingResults.length > 0) {
            notificationMessage += `\n\n🔄 已自动调整 ${pathProcessingResults.length} 个平台的本地路径以兼容当前操作系统`
          }
        }

      } else if (version >= 2.0) {
        // 旧版本格式：单平台配置
        if (!importData.config) {
          throw new Error('文件格式不正确，缺少配置信息')
        }

        const configData = importData.config
        const isLegacyS3Config = configData.endpoint || configData.accessKey
        const isGitConfig = configData.provider || configData.repositoryUrl

        if (isLegacyS3Config) {
          throw new Error('检测到旧的S3配置格式。由于同步方式已更改为Git，无法直接导入S3配置。请手动配置新的Git同步设置。')
        } else if (isGitConfig) {
          hasCredentials = !!(configData.token || configData.sshKeyPath)
          
          // 智能处理导入的路径，检查跨平台兼容性
          const pathResult = PathUtils.processImportedPath(
            configData.localPath,
            configData.provider as 'github' | 'gitlab' | 'gitee'
          )
          
          const currentConfig = SettingsManager.getCloudSyncConfig()
          const newConfig = {
            provider: configData.provider || currentConfig.provider || '',
            repositoryUrl: configData.repositoryUrl || currentConfig.repositoryUrl || '',
            token: configData.token || currentConfig.token || '',
            localPath: pathResult.processedPath || currentConfig.localPath || '',
            defaultBranch: configData.defaultBranch || currentConfig.defaultBranch || 'main',
            authenticationMethod: configData.authenticationMethod || currentConfig.authenticationMethod || 'token',
            sshKeyPath: configData.sshKeyPath || currentConfig.sshKeyPath || '',
            autoSync: configData.autoSync !== undefined ? configData.autoSync : currentConfig.autoSync || false,
            syncInterval: configData.syncInterval || currentConfig.syncInterval || 15,
            commitMessageTemplate: configData.commitMessageTemplate || currentConfig.commitMessageTemplate || 'Sync snippets: {timestamp}',
          }

          // 如果路径被修改，通知用户
          if (pathResult.wasModified) {
            const platformName = configData.provider ? 
              configData.provider.charAt(0).toUpperCase() + configData.provider.slice(1) : 
              '当前平台'
            vscode.window.showWarningMessage(
              `跨平台兼容性检查：${platformName} 的本地路径已调整为默认路径\n\n原因：${pathResult.reason}`,
              '我知道了'
            )
          }

          // 验证配置
          const validation = SettingsManager.validateConfig(newConfig)
          if (!validation.isValid) {
            const warningMessage = `配置导入成功，但存在以下问题: ${validation.errors.join(', ')}`
            vscode.window.showWarningMessage(warningMessage)
          }

          // 保存传统配置
          await SettingsManager.saveCloudSyncConfig(newConfig)
          importedPlatformsCount = 1

          if (hasCredentials) {
            importMessage += '（包含Git访问凭据）'
            notificationMessage += '\n\n✅ 已导入完整的Git配置，包括访问凭据'
          } else {
            importMessage += '（未包含访问凭据，已保留当前设置）'
            notificationMessage += '\n\n⚠️ 导入的配置不包含访问凭据，已保留当前设置的凭据信息'
          }

          if (pathResult.wasModified) {
            notificationMessage += '\n\n🔄 已自动调整本地路径以兼容当前操作系统'
          }
        } else {
          throw new Error('配置文件格式无法识别。请确保导入正确的配置文件。')
        }
      } else {
        throw new Error(`不支持的配置文件版本: ${importData.version}。请使用最新版本的扩展导出配置。`)
      }

      // 更新页面显示
      await this._sendConfigToWebview(panel)

      panel.webview.postMessage({
        type: 'importResult',
        success: true,
        message: importMessage,
      })

      vscode.window.showInformationMessage(notificationMessage)
    } catch (error) {
      console.error('导入设置失败:', error)
      const errorMessage = error instanceof Error ? error.message : '导入设置失败'

      panel.webview.postMessage({
        type: 'importResult',
        success: false,
        message: errorMessage,
      })

      vscode.window.showErrorMessage(`导入设置失败: ${errorMessage}`)
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
            line-height: 1.6;
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
        }

        .header {
            text-align: center;
            margin-bottom: 40px;
            padding-bottom: 20px;
            border-bottom: 1px solid var(--vscode-widget-border);
        }

        .header h1 {
            margin: 0 0 10px 0;
            font-size: 24px;
            font-weight: 600;
        }

        .header p {
            margin: 0;
            color: var(--vscode-descriptionForeground);
        }

        .section {
            margin-bottom: 30px;
            padding: 20px;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 8px;
            background-color: var(--vscode-sideBar-background);
        }

        .section-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 15px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-widget-border);
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
            padding: 12px 16px;
            border-radius: 6px;
            margin: 10px 0;
            font-weight: 500;
            position: fixed;
            top: 20px;
            right: 20px;
            max-width: 400px;
            z-index: 1000;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            border: 1px solid rgba(255, 255, 255, 0.1);
            animation: slideInRight 0.3s ease-out;
        }

        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        @keyframes slideOutRight {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(100%);
                opacity: 0;
            }
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

        /* 多平台配置样式 */
        .platform-info {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 12px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
        }
        
        .platform-url {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
        }
        
        .platform-list {
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            max-height: 300px;
            overflow-y: auto;
        }
        
        .platform-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px;
            border-bottom: 1px solid var(--vscode-input-border);
        }
        
        .platform-item:last-child {
            border-bottom: none;
        }
        
        .platform-item.active {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }
        
        .platform-details {
            flex: 1;
        }
        
        .platform-name {
            font-weight: bold;
            margin-bottom: 4px;
        }
        
        .platform-repo {
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
        }
        
        .platform-actions {
            display: flex;
            gap: 8px;
        }
        
        .platform-actions button {
            padding: 4px 8px;
            font-size: 0.8em;
        }
        
        .empty-platforms {
            padding: 20px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
        }
        
        .alert {
            padding: 12px;
            border-radius: 4px;
            border: 1px solid;
            margin-bottom: 16px;
        }
        
        .alert-warning {
            background-color: var(--vscode-inputValidation-warningBackground);
            border-color: var(--vscode-inputValidation-warningBorder);
            color: var(--vscode-inputValidation-warningForeground);
        }
        
        .alert strong {
            display: block;
            margin-bottom: 8px;
        }
        
        .conflict-item {
            margin: 8px 0;
            padding: 8px;
            background: rgba(255, 193, 7, 0.1);
            border-radius: 4px;
            border-left: 3px solid var(--vscode-inputValidation-warningBorder);
        }
        
        .conflict-path {
            font-family: var(--vscode-editor-font-family);
            font-size: 0.9em;
            background: rgba(0, 0, 0, 0.1);
            padding: 2px 4px;
            border-radius: 2px;
        }
        
        /* 移除了模态框相关的样式 */
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔄 云端同步设置</h1>
            <p>基于 Git 的代码片段云端同步配置</p>
        </div>
        


        <!-- 连接状态 -->
        <div class="section">
            <div class="section-title">连接状态</div>
            <div class="connection-status">
                <div id="statusIndicator" class="status-indicator disconnected"></div>
                <span id="statusText">功能开发中</span>
            </div>
            <div id="lastSyncTime" class="help-text">Git 同步功能即将推出</div>
            <div id="lastError" class="help-text" style="color: var(--vscode-errorForeground); display: none;"></div>
        </div>

        <!-- Git 配置 -->
        <div class="section">
            <div class="section-title">Git 同步配置</div>
            
            <div class="form-group">
                <label for="provider">Git 平台 *</label>
                <select id="provider">
                    <option value="">请选择平台</option>
                    <option value="github">GitHub</option>
                    <option value="gitlab">GitLab</option>
                    <option value="gitee">Gitee</option>
                </select>
                <div class="help-text">选择您使用的 Git 平台</div>
            </div>

            <div class="form-group">
                <label for="repositoryUrl">仓库 URL *</label>
                <input type="text" id="repositoryUrl" placeholder="https://github.com/user/repo.git">
                <div class="help-text">您的代码片段仓库地址</div>
            </div>

            <div class="form-group">
                <label for="localPath">本地仓库路径 (可选)</label>
                <input type="text" id="localPath" placeholder="留空表示使用默认路径">
                <div class="help-text" id="localPathHelp">
                    <div>💡 智能路径管理：</div>
                    <div>• 勾选"使用平台默认路径标识符"可确保配置在不同系统间同步时自动适配</div>
                    <div>• 手动输入路径时，如检测到跨平台不兼容会自动调整为标识符</div>
                    <div>• 支持的标识符：GITHUB_DEFAULT_REPO、GITLAB_DEFAULT_REPO、GITEE_DEFAULT_REPO</div>
                    <div id="defaultPathInfo" class="default-path-info"></div>
                </div>
                <div class="checkbox-group">
                    <input type="checkbox" id="useDefaultPath">
                    <label for="useDefaultPath">使用默认路径</label>
                </div>
            </div>

            <div class="form-group">
                <label for="defaultBranch">默认分支</label>
                <input type="text" id="defaultBranch" placeholder="main" value="main">
                <div class="help-text">用于同步的分支名称</div>
            </div>

            <div class="form-group">
                <label for="authenticationMethod">认证方式</label>
                <select id="authenticationMethod">
                    <option value="token">访问令牌</option>
                    <option value="ssh">SSH密钥</option>
                </select>
                <div class="help-text">选择Git认证方式</div>
            </div>

            <div class="form-group" id="tokenGroup">
                <label for="token">访问令牌 *</label>
                <input type="password" id="token" placeholder="访问令牌">
                <div class="help-text">用于访问私有仓库的令牌</div>
            </div>

            <div class="form-group" id="sshGroup" style="display: none;">
                <label for="sshKeyPath">SSH密钥路径</label>
                <input type="text" id="sshKeyPath" placeholder="例如: ~/.ssh/id_rsa">
                <div class="help-text">SSH私钥文件的路径</div>
            </div>

            <div class="form-group">
                <label for="commitMessageTemplate">提交信息模板</label>
                <input type="text" id="commitMessageTemplate" placeholder="Sync snippets: {timestamp}" value="Sync snippets: {timestamp}">
                <div class="help-text">提交时使用的信息模板，{timestamp} 会被替换为时间戳</div>
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
                <label for="syncInterval">自动同步间隔 (分钟)</label>
                <input type="number" id="syncInterval" min="5" max="60" value="15">
                <div class="help-text">自动同步的时间间隔（5-60分钟）</div>
            </div>
        </div>

        <!-- 多平台配置管理 -->
        <div class="section">
            <div class="section-title">多平台配置管理</div>
            <p class="help-text">
                管理多个Git平台的配置，可以在不同平台之间快速切换。
            </p>
            
            <!-- 当前激活的平台 -->
            <div class="form-group">
                <label>当前激活平台</label>
                <div id="activePlatformInfo" class="platform-info">
                    <span id="activePlatformName">未配置</span>
                    <span id="activePlatformUrl" class="platform-url">-</span>
                </div>
            </div>
            
            <!-- 平台配置列表 -->
            <div class="form-group">
                <label>已配置平台</label>
                <div id="platformList" class="platform-list">
                    <!-- 平台配置项将通过JavaScript动态添加 -->
                </div>
            </div>
            
            <!-- 路径冲突警告 -->
            <div id="pathConflictsWarning" class="form-group" style="display: none;">
                <div class="alert alert-warning">
                    <strong>⚠️ 路径冲突警告</strong>
                    <div id="pathConflictsDetails"></div>
                </div>
            </div>
            
            <!-- 添加新平台 -->
            <div class="form-group">
                <label>添加新平台</label>
                <div class="button-group">
                    <button id="addGitHubBtn" class="btn btn-secondary">+ GitHub</button>
                    <button id="addGitLabBtn" class="btn btn-secondary">+ GitLab</button>
                    <button id="addGiteeBtn" class="btn btn-secondary">+ Gitee</button>
                </div>
            </div>
        </div>

        <!-- 操作按钮 -->
        <div class="button-group">
            <button id="saveBtn" class="btn btn-primary">保存配置</button>
            <button id="testBtn" class="btn btn-secondary">测试连接</button>
            <button id="manualSyncBtn" class="btn btn-secondary">手动同步</button>
            <button id="resetBtn" class="btn btn-danger">重置配置</button>
        </div>

        <!-- 配置管理 -->
        <div class="section">
            <div class="section-title">配置管理</div>
            <p class="help-text">
                <strong>导出设置：</strong>备份当前的同步配置。<br>
                <strong>导入设置：</strong>从备份文件恢复配置。
            </p>
            <div class="button-group">
                <button id="exportBtn" class="btn btn-secondary">📤 导出设置</button>
                <button id="importBtn" class="btn btn-secondary">📥 导入设置</button>
            </div>
        </div>

        <!-- 平台配置编辑表单已被整合到主界面，不再使用模态框 -->
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // DOM 元素
        const statusIndicator = document.getElementById('statusIndicator');
        const statusText = document.getElementById('statusText');
        const lastSyncTime = document.getElementById('lastSyncTime');
        const lastError = document.getElementById('lastError');
        
        // Git配置相关元素
        const providerSelect = document.getElementById('provider');
        const repositoryUrlInput = document.getElementById('repositoryUrl');
        const localPathInput = document.getElementById('localPath');
        const defaultPathInfo = document.getElementById('defaultPathInfo');
        const useDefaultPathCheckbox = document.getElementById('useDefaultPath');
        const defaultBranchInput = document.getElementById('defaultBranch');
        const authenticationMethodSelect = document.getElementById('authenticationMethod');
        const tokenInput = document.getElementById('token');
        const sshKeyPathInput = document.getElementById('sshKeyPath');
        const commitMessageTemplateInput = document.getElementById('commitMessageTemplate');
        const autoSyncCheckbox = document.getElementById('autoSync');
        const syncIntervalInput = document.getElementById('syncInterval');
        
        const tokenGroup = document.getElementById('tokenGroup');
        const sshGroup = document.getElementById('sshGroup');
        
        const saveBtn = document.getElementById('saveBtn');
        const testBtn = document.getElementById('testBtn');
        const manualSyncBtn = document.getElementById('manualSyncBtn');
        const resetBtn = document.getElementById('resetBtn');
        const exportBtn = document.getElementById('exportBtn');
        const importBtn = document.getElementById('importBtn');
        
        // 多平台配置相关元素
        const activePlatformName = document.getElementById('activePlatformName');
        const activePlatformUrl = document.getElementById('activePlatformUrl');
        const platformList = document.getElementById('platformList');
        const pathConflictsWarning = document.getElementById('pathConflictsWarning');
        const pathConflictsDetails = document.getElementById('pathConflictsDetails');
        const addGitHubBtn = document.getElementById('addGitHubBtn');
        const addGitLabBtn = document.getElementById('addGitLabBtn');
        const addGiteeBtn = document.getElementById('addGiteeBtn');

        // 简化配置变量
        var defaultLocalPath = '';
        var multiPlatformConfig = null;
        var activePlatformConfig = null;
        var platformPaths = {}; // 存储后端解析的实际路径

        // 转义HTML特殊字符
        function escapeHTML(str) {
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        // 初始化默认路径信息
        function updateDefaultPathInfo(defaultPath, description) {
            if (defaultPathInfo) {
                defaultPathInfo.textContent = description || \`默认路径: \${defaultPath}\`;
            }
        }

        // 使用默认路径复选框切换
        useDefaultPathCheckbox.addEventListener('change', () => {
            updateLocalPathDisplay();
        });

        // 更新本地路径显示状态
        function updateLocalPathDisplay() {
            const provider = providerSelect.value;
            
            if (useDefaultPathCheckbox.checked) {
                // 勾选使用默认路径：显示实际路径（只读），但数据存储为标识符
                // 优先使用后端解析的实际路径，如果没有则使用前端模拟的路径
                const actualPath = platformPaths[provider] || getPlatformDefaultPath(provider);
                
                localPathInput.value = actualPath;
                localPathInput.placeholder = '使用平台默认路径（只读）';
                localPathInput.disabled = true;
                localPathInput.style.fontStyle = 'italic';
                localPathInput.style.color = 'var(--vscode-descriptionForeground)';
                
                // 只有在没有已存在的 data-token 时才设置新的
                // 这样可以避免覆盖从 setFormData 设置的正确标识符
                if (!localPathInput.getAttribute('data-token')) {
                    const defaultPathToken = getDefaultPathTokenForProvider(provider);
                    localPathInput.setAttribute('data-token', defaultPathToken);
                }
            } else {
                // 未勾选：可编辑状态
                localPathInput.disabled = false;
                localPathInput.placeholder = '留空或输入自定义路径';
                localPathInput.style.fontStyle = 'normal';
                localPathInput.style.color = 'var(--vscode-input-foreground)';
                localPathInput.removeAttribute('data-token');
                
                // 如果当前值是后端解析的实际路径，清空输入框
                const actualPath = platformPaths[provider] || getPlatformDefaultPath(provider);
                if (localPathInput.value === actualPath) {
                    localPathInput.value = '';
                }
            }
        }

        // 获取平台对应的默认路径标识符
        function getDefaultPathTokenForProvider(provider) {
            switch (provider) {
                case 'github':
                    return 'GITHUB_DEFAULT_REPO';
                case 'gitlab':
                    return 'GITLAB_DEFAULT_REPO';
                case 'gitee':
                    return 'GITEE_DEFAULT_REPO';
                default:
                    return '';
            }
        }

        // 平台选择变化
        providerSelect.addEventListener('change', () => {
            // 如果当前勾选了使用默认路径，更新显示和data-token
            if (useDefaultPathCheckbox.checked) {
                // 清除旧的 data-token，让 updateLocalPathDisplay 设置新的
                localPathInput.removeAttribute('data-token');
                updateLocalPathDisplay();
            }
        });

        // 认证方式切换
        authenticationMethodSelect.addEventListener('change', () => {
            const authMethod = authenticationMethodSelect.value;
            if (authMethod === 'token') {
                tokenGroup.style.display = 'block';
                sshGroup.style.display = 'none';
            } else if (authMethod === 'ssh') {
                tokenGroup.style.display = 'none';
                sshGroup.style.display = 'block';
            }
        });

        // 恢复所有按钮到正常状态
        function restoreButtonStates() {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = '保存配置';
            }
            if (testBtn) {
                testBtn.disabled = false;
                testBtn.textContent = '测试连接';
            }
            if (manualSyncBtn) {
                manualSyncBtn.disabled = false;
                manualSyncBtn.textContent = '手动同步';
            }
        }

        // 显示悬浮状态消息
        function showStatus(message, type = 'info') {
            // 移除现有的状态消息
            const existingStatus = document.querySelector('.status');
            if (existingStatus) {
                existingStatus.remove();
            }
            
            // 创建新的状态消息
            const statusDiv = document.createElement('div');
            statusDiv.className = \`status \${type}\`;
            statusDiv.textContent = message;
            
            // 添加到页面
            document.body.appendChild(statusDiv);
            
            // 自动移除
            setTimeout(() => {
                if (statusDiv && statusDiv.parentNode) {
                    statusDiv.style.animation = 'slideOutRight 0.3s ease-in';
                    setTimeout(() => {
                        if (statusDiv && statusDiv.parentNode) {
                            statusDiv.remove();
                        }
                    }, 300);
                }
            }, 4000);
        }

        // 显示消息提示（通用版）
        function showMessage(message, type = 'info', duration = 5000) {
            statusMessage.textContent = message;
            statusMessage.className = \`status \${type}\`;
            statusMessage.classList.remove('hidden');
            
            setTimeout(() => {
                statusMessage.classList.add('hidden');
            }, duration);
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
            // 如果勾选了使用默认路径，保存默认路径标识符；否则保存用户输入的路径
            let localPathValue;
            if (useDefaultPathCheckbox.checked) {
                // 从data-token属性获取标识符，如果没有则使用旧逻辑
                localPathValue = localPathInput.getAttribute('data-token') || getDefaultPathTokenForProvider(providerSelect.value);
            } else {
                localPathValue = localPathInput.value.trim();
            }
            
            return {
                provider: providerSelect.value,
                repositoryUrl: repositoryUrlInput.value.trim(),
                localPath: localPathValue,
                defaultBranch: defaultBranchInput.value.trim() || 'main',
                authenticationMethod: authenticationMethodSelect.value,
                token: tokenInput.value.trim(),
                sshKeyPath: sshKeyPathInput.value.trim(),
                commitMessageTemplate: commitMessageTemplateInput.value.trim() || 'Sync snippets: {timestamp}',
                autoSync: autoSyncCheckbox.checked,
                syncInterval: parseInt(syncIntervalInput.value) || 15
            };
        }

        // 设置表单数据
        function setFormData(config) {
            providerSelect.value = config.provider || '';
            repositoryUrlInput.value = config.repositoryUrl || '';
            
            // 处理本地路径逻辑
            const localPath = config.localPath || '';
            const isDefaultPathToken = localPath === 'GITHUB_DEFAULT_REPO' || 
                                     localPath === 'GITLAB_DEFAULT_REPO' || 
                                     localPath === 'GITEE_DEFAULT_REPO' || 
                                     localPath === 'DEFAULT_REPO';
            const isUsingDefault = !localPath || localPath.trim() === '' || isDefaultPathToken || config.isUsingDefaultPath;
            
            if (isUsingDefault) {
                useDefaultPathCheckbox.checked = true;
                if (isDefaultPathToken) {
                    // 存储标识符到data属性
                    localPathInput.setAttribute('data-token', localPath);
                }
                // 更新显示状态（会显示实际路径并设为只读）
                updateLocalPathDisplay();
            } else {
                localPathInput.value = localPath;
                useDefaultPathCheckbox.checked = false;
                localPathInput.disabled = false;
                localPathInput.placeholder = '留空或输入自定义路径';
                localPathInput.style.fontStyle = 'normal';
                localPathInput.style.color = 'var(--vscode-input-foreground)';
                localPathInput.removeAttribute('data-token');
            }
            
            // 更新默认路径信息显示
            if (config.defaultPathDescription) {
                updateDefaultPathInfo(config.effectiveLocalPath, config.defaultPathDescription);
            }
            
            defaultBranchInput.value = config.defaultBranch || 'main';
            authenticationMethodSelect.value = config.authenticationMethod || 'token';
            tokenInput.value = config.token || '';
            sshKeyPathInput.value = config.sshKeyPath || '';
            commitMessageTemplateInput.value = config.commitMessageTemplate || 'Sync snippets: {timestamp}';
            autoSyncCheckbox.checked = config.autoSync || false;
            syncIntervalInput.value = config.syncInterval || 15;
            
            // 触发认证方式切换
            authenticationMethodSelect.dispatchEvent(new Event('change'));
        }

        // 保存配置（包含当前平台和所有缓存的平台）
        saveBtn.addEventListener('click', () => {
            try {
                // 先保存当前表单数据到缓存
                if (currentPlatform && ['github', 'gitlab', 'gitee'].includes(currentPlatform)) {
                    const currentFormData = getFormData();
                    currentFormData.provider = currentPlatform;
                    
                    // 修复路径标识符问题：如果使用默认路径，确保使用当前平台对应的标识符
                    if (useDefaultPathCheckbox.checked) {
                        currentFormData.localPath = getDefaultPathTokenForProvider(currentPlatform);
                    }
                    
                    platformConfigs[currentPlatform] = currentFormData;
                    // console.log('保存前先更新缓存:', getPlatformName(currentPlatform));
                }
                
                // 获取当前表单数据
                const currentConfig = getFormData();
                
                // 记住当前活动平台
                const activePlatform = currentPlatform;
                
                // 收集所有有效的配置（包括当前表单和缓存的配置）
                const allConfigs = {};
                let configCount = 0;
                
                // 添加当前表单配置
                if (currentConfig.provider && currentConfig.repositoryUrl?.trim()) {
                    // 再次确保当前配置的路径标识符正确
                    if (useDefaultPathCheckbox.checked) {
                        currentConfig.localPath = getDefaultPathTokenForProvider(currentConfig.provider);
                    }
                    allConfigs[currentConfig.provider] = currentConfig;
                    configCount++;
                    // console.log('准备保存当前配置:', getPlatformName(currentConfig.provider));
                }
                
                // 添加缓存中的其他平台配置
                for (const [provider, config] of Object.entries(platformConfigs)) {
                    if (config && ['github', 'gitlab', 'gitee'].includes(provider) && 
                        config.repositoryUrl && config.repositoryUrl.trim() !== '' &&
                        provider !== currentConfig.provider) {
                        allConfigs[provider] = config;
                        configCount++;
                        // console.log('准备保存缓存配置:', getPlatformName(provider));
                    }
                }
                
                if (configCount === 0) {
                    showStatus('请至少填写一个平台的完整配置信息', 'warning');
                    return;
                }
                
                // 禁用保存按钮，防止重复点击
                saveBtn.disabled = true;
                saveBtn.textContent = '保存中...';
                
                // console.log('开始保存 ' + configCount + ' 个平台配置');
                // console.log('当前活动平台:', activePlatform);
                
                // 发送批量保存请求，同时传递当前活动平台
                vscode.postMessage({
                    type: 'saveAllPlatforms',
                    configs: allConfigs,
                    activePlatform: activePlatform
                });
                
            } catch (error) {
                console.error('保存配置时发生错误:', error);
                restoreButtonStates();
                showStatus('保存配置时发生错误: ' + error.message, 'error');
            }
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
            if (confirm('确定要重置所有Git配置吗？此操作不可撤销。')) {
                vscode.postMessage({
                    type: 'resetConfig'
                });
            }
        });

        exportBtn.addEventListener('click', () => {
            vscode.postMessage({
                type: 'exportSettings'
            });
        });

        importBtn.addEventListener('click', () => {
            vscode.postMessage({
                type: 'importSettings'
            });
        });

        // 保存不同平台的配置
        let platformConfigs = {
            github: null,
            gitlab: null,
            gitee: null
        };
        
        // 当前选择的平台
        let currentPlatform = "github";
        
        // 加载特定平台配置
        function loadPlatformConfig() {
            // 在切换平台之前，先保存当前表单的配置
            if (currentPlatform && ['github', 'gitlab', 'gitee'].includes(currentPlatform)) {
                const currentFormData = getFormData();
                // 确保保存的配置包含正确的provider
                currentFormData.provider = currentPlatform;
                
                // 修复路径标识符问题：如果使用默认路径，确保使用当前平台对应的标识符
                if (useDefaultPathCheckbox.checked) {
                    currentFormData.localPath = getDefaultPathTokenForProvider(currentPlatform);
                }
                
                platformConfigs[currentPlatform] = currentFormData;
                // console.log('已保存', getPlatformName(currentPlatform), '配置到缓存');
            }
            
            // 获取当前选择的平台
            const platform = providerSelect.value;
            const previousPlatform = currentPlatform;
            currentPlatform = platform;
            
            // 如果有缓存的配置则使用，否则使用空配置
            if (platformConfigs[platform]) {
                setFormData(platformConfigs[platform]);
                showStatus('已加载 ' + getPlatformName(platform) + ' 配置', 'info');
            } else {
                // 创建空配置，使用平台特定的默认路径
                // 保持全局自动同步设置不变
                const currentAutoSync = autoSyncCheckbox.checked;
                const currentSyncInterval = parseInt(syncIntervalInput.value) || 15;
                
                const emptyConfig = {
                    provider: platform,
                    repositoryUrl: '',
                    token: '',
                    localPath: '', // 这里留空，让默认路径显示起作用
                    defaultBranch: 'main',
                    authenticationMethod: 'token',
                    sshKeyPath: '',
                    autoSync: currentAutoSync, // 保持当前的自动同步设置
                    syncInterval: currentSyncInterval, // 保持当前的同步间隔设置
                    commitMessageTemplate: 'Sync snippets: {timestamp}'
                };
                setFormData(emptyConfig);
                showStatus('切换到新的 ' + getPlatformName(platform) + ' 配置', 'info');
            }
            
            // 更新平台特定的默认路径显示
            updatePlatformDefaultPathInfo(platform);
        }
        
        // 获取平台友好名称
        function getPlatformName(platform) {
            switch(platform) {
                case 'github': return 'GitHub';
                case 'gitlab': return 'GitLab';
                case 'gitee': return 'Gitee';
                default: return '未知平台';
            }
        }

        // 获取平台特定的默认路径（后备方案，优先使用后端提供的真实路径）
        function getPlatformDefaultPath(platform) {
            // 如果后端已提供解析后的路径，优先使用
            if (platformPaths[platform]) {
                return platformPaths[platform];
            }
            
            // 后备方案：前端模拟（显示未解析的路径格式）
            const isWindows = navigator.platform.indexOf('Win') > -1;
            const isMac = navigator.platform.indexOf('Mac') > -1;
            
            const platformName = getPlatformName(platform);
            
            if (isWindows) {
                return \`%USERPROFILE%\\\\Documents\\\\StarCode-Snippets\\\\\${platformName}\`;
            } else if (isMac) {
                return \`~/Documents/StarCode-Snippets/\${platformName}\`;
            } else {
                // Linux
                return \`~/.local/share/starcode-snippets/\${platform.toLowerCase()}\`;
            }
        }

        // 更新平台特定的默认路径显示
        function updatePlatformDefaultPathInfo(platform) {
            if (defaultPathInfo && platform) {
                const defaultPath = getPlatformDefaultPath(platform);
                const platformName = getPlatformName(platform);
                defaultPathInfo.textContent = \`\${platformName} 默认路径: \${defaultPath}\`;
            }
        }

        // 显示路径冲突警告
        function updatePathConflictsDisplay(pathConflicts) {
            if (!pathConflictsWarning || !pathConflictsDetails) {
                return;
            }

            if (!pathConflicts || !pathConflicts.hasConflicts) {
                pathConflictsWarning.style.display = 'none';
                return;
            }

            // 构建冲突详情HTML
            const conflictsHtml = pathConflicts.conflicts.map(conflict => {
                const platformNames = conflict.platforms.map(p => \`\${getPlatformName(p.provider)} (\${p.name})\`).join('、');
                return \`
                    <div class="conflict-item">
                        <strong>冲突路径：</strong><span class="conflict-path">\${conflict.path}</span><br>
                        <strong>使用该路径的平台：</strong>\${platformNames}
                    </div>
                \`;
            }).join('');

            // 构建建议HTML
            const suggestionsHtml = pathConflicts.suggestions.length > 0 ? \`
                <div style="margin-top: 12px;">
                    <strong>建议修改方案：</strong>
                    \${pathConflicts.suggestions.map(suggestion => {
                        const platform = multiPlatformConfig?.platforms?.find(p => p.id === suggestion.platformId);
                        const platformName = platform ? \`\${getPlatformName(platform.provider)} (\${platform.name})\` : '未知平台';
                        return \`<div style="margin: 4px 0;">• \${platformName}: <span class="conflict-path">\${suggestion.suggestedPath}</span></div>\`;
                    }).join('')}
                </div>
            \` : '';

            pathConflictsDetails.innerHTML = \`
                <div>多个平台配置使用了相同的本地仓库路径，这可能导致数据冲突。</div>
                \${conflictsHtml}
                \${suggestionsHtml}
            \`;

            pathConflictsWarning.style.display = 'block';
        }
        
        // 平台选择器变更事件
        providerSelect.addEventListener('change', loadPlatformConfig);

        // 监听来自扩展的消息
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'config':
                    // 缓存配置
                    const config = message.config;
                    platformConfigs[config.provider || ""] = config;
                    
                    // 如果当前平台和配置平台一致，则显示
                    if (currentPlatform === config.provider) {
                        setFormData(config);
                    }
                    
                    updateConnectionStatus(message.status);
                    break;
                case 'configLoaded':
                    // 更新多平台配置数据
                    multiPlatformConfig = message.multiConfig;
                    activePlatformConfig = message.activePlatform;
                    platformPaths = message.platformPaths || {}; // 保存后端解析的实际路径
                    
                    // 缓存多平台配置
                    if (message.multiConfig && message.multiConfig.platforms) {
                        // 先清空所有缓存，确保删除的配置不会残留
                        platformConfigs = {
                            github: null,
                            gitlab: null,
                            gitee: null
                        };
                        
                        // 然后只缓存实际存在的平台配置
                        message.multiConfig.platforms.forEach(platform => {
                            // 合并平台配置和全局自动同步设置
                            const platformWithGlobalSettings = {
                                ...platform,
                                autoSync: message.multiConfig.autoSync || false,
                                syncInterval: message.multiConfig.syncInterval || 15
                            };
                            platformConfigs[platform.provider || ""] = platformWithGlobalSettings;
                            // console.log('已缓存平台配置:', getPlatformName(platform.provider || ""));
                        });
                    }
                    
                    // 缓存传统配置
                    if (message.config && ['github', 'gitlab', 'gitee'].includes(message.config.provider)) {
                        platformConfigs[message.config.provider] = message.config;
                        // console.log('已缓存传统配置:', getPlatformName(message.config.provider));
                    }
                    
                    // 如果有活动平台配置，优先选择它
                    if (message.activePlatform && ['github', 'gitlab', 'gitee'].includes(message.activePlatform.provider)) {
                        providerSelect.value = message.activePlatform.provider;
                        currentPlatform = message.activePlatform.provider;
                        // 合并平台配置和全局自动同步设置
                        const configWithGlobalSettings = {
                            ...message.activePlatform,
                            autoSync: message.multiConfig?.autoSync || false,
                            syncInterval: message.multiConfig?.syncInterval || 15
                        };
                        setFormData(configWithGlobalSettings);
                        // console.log('初始化活动平台配置:', getPlatformName(currentPlatform));
                    } else if (message.config && ['github', 'gitlab', 'gitee'].includes(message.config.provider)) {
                        // 否则使用传统配置
                        providerSelect.value = message.config.provider;
                        currentPlatform = message.config.provider;
                        setFormData(message.config);
                        // console.log('初始化传统配置:', getPlatformName(currentPlatform));
                    } else {
                        // 默认选择GitHub，使用全局自动同步设置
                        providerSelect.value = 'github';
                        currentPlatform = 'github';
                        const defaultConfig = {
                            provider: 'github',
                            repositoryUrl: '',
                            token: '',
                            localPath: '',
                            defaultBranch: 'main',
                            authenticationMethod: 'token',
                            sshKeyPath: '',
                            autoSync: message.multiConfig?.autoSync || false,
                            syncInterval: message.multiConfig?.syncInterval || 15,
                            commitMessageTemplate: 'Sync snippets: {timestamp}'
                        };
                        setFormData(defaultConfig);
                        // console.log('使用默认GitHub配置');
                    }
                    
                    // 更新多平台配置显示
                    updateActivePlatformDisplay();
                    renderPlatformList();
                    
                    // 更新当前平台的默认路径显示
                    updatePlatformDefaultPathInfo(currentPlatform);
                    
                    // 显示路径冲突警告
                    updatePathConflictsDisplay(message.pathConflicts);
                    
                    updateConnectionStatus(message.status);
                    break;
                case 'statusUpdate':
                    updateConnectionStatus(message.status);
                    break;
                case 'saveSuccess':
                    restoreButtonStates();
                    
                    // 保存当前配置到缓存
                    const savedConfig = getFormData();
                    savedConfig.provider = currentPlatform;
                    platformConfigs[currentPlatform] = savedConfig;
                    // console.log('配置保存成功，已更新缓存:', getPlatformName(currentPlatform));
                    
                    showStatus(message.message, 'success');
                    break;
                case 'saveError':
                    restoreButtonStates();
                    showStatus(message.message, 'error');
                    break;
                case 'validationError':
                    showStatus('配置验证失败: ' + message.errors.join(', '), 'error');
                    break;
                case 'testingConnection':
                    showStatus(message.message, 'info');
                    break;
                case 'testResult':
                    restoreButtonStates();
                    showStatus(message.message, message.success ? 'success' : 'error');
                    break;
                case 'manualSyncResult':
                    restoreButtonStates();
                    showStatus(message.message, message.success ? 'success' : 'error');
                    break;
                case 'syncStarted':
                    showStatus(message.message, 'info');
                    break;
                case 'resetSuccess':
                    // 清除当前平台的缓存
                    platformConfigs[currentPlatform] = null;
                    showStatus(message.message, 'success');
                    break;
                case 'exportResult':
                    showStatus(message.message, message.success ? 'success' : 'error');
                    break;
                case 'exportSuccess':
                    showStatus(message.message, 'success');
                    break;
                case 'exportError':
                    showStatus(message.message, 'error');
                    break;
                case 'importResult':
                    showStatus(message.message, message.success ? 'success' : 'error');
                    if (message.success) {
                        // 重新加载配置以更新显示
                        vscode.postMessage({ type: 'loadConfig' });
                    }
                    break;
                case 'importSuccess':
                    showStatus(message.message, 'success');
                    break;
                case 'importError':
                    showStatus(message.message, 'error');
                    break;
                case 'saveAllPlatformsResult':
                    restoreButtonStates();
                    
                    if (message.success) {
                        showStatus(message.message, 'success');
                        
                        // 更新所有平台的缓存
                        if (message.savedCount > 0) {
                            // console.log('批量保存成功，已保存 ' + message.savedCount + ' 个平台配置');
                            
                            // 重新请求配置以确保显示正确的状态
                            setTimeout(() => {
                                vscode.postMessage({ type: 'loadConfig' });
                            }, 300);
                        }
                    } else {
                        // 检查是否是权限错误
                        if (message.message.includes('权限不足') || message.message.includes('被占用')) {
                            showStatus('⚠️ 配置保存失败：文件权限问题', 'error');
                            
                            // 显示更详细的提示
                            setTimeout(() => {
                                showStatus('💡 请尝试以管理员身份运行VSCode，或检查设置文件是否被占用', 'warning');
                            }, 3000);
                        } else {
                            showStatus(message.message, 'error');
                        }
                    }
                    break;
                case 'platformConfigAdded':
                    showStatus(\`已添加 \${getPlatformName(message.config.provider)} 配置\`, 'success');
                    // 重新加载配置以更新显示
                    vscode.postMessage({ type: 'loadConfig' });
                    break;
                case 'platformConfigUpdated':
                    showStatus(\`已更新 \${getPlatformName(message.config.provider)} 配置\`, 'success');
                    // 重新加载配置以更新显示
                    vscode.postMessage({ type: 'loadConfig' });
                    break;
                case 'platformConfigDeleted':
                    // 清除缓存中对应的配置
                    if (message.configId && multiPlatformConfig && multiPlatformConfig.platforms) {
                        const deletedPlatform = multiPlatformConfig.platforms.find(p => p.id === message.configId);
                        if (deletedPlatform && deletedPlatform.provider) {
                            platformConfigs[deletedPlatform.provider] = null;
                            // console.log('已清除缓存中的', getPlatformName(deletedPlatform.provider), '配置');
                        }
                    }
                    showStatus('平台配置已删除', 'success');
                    // 重新加载配置以更新显示
                    vscode.postMessage({ type: 'loadConfig' });
                    break;
                case 'platformConfigActivated':
                    showStatus(\`已激活 \${message.config ? getPlatformName(message.config.provider) : ''} 配置\`, 'success');
                    // 重新加载配置以更新显示
                    vscode.postMessage({ type: 'loadConfig' });
                    break;
                case 'platformConfigError':
                    showStatus(\`平台配置操作失败: \${message.message}\`, 'error');
                    break;
                default:
                    // console.log('Unknown message type:', message.type);
            }
        });

        // 多平台配置管理
        
        // 更新激活平台显示
        function updateActivePlatformDisplay() {
            if (activePlatformConfig) {
                activePlatformName.textContent = \`\${getPlatformName(activePlatformConfig.provider)} (\${activePlatformConfig.name})\`;
                activePlatformUrl.textContent = activePlatformConfig.repositoryUrl || '-';
            } else {
                activePlatformName.textContent = '未配置';
                activePlatformUrl.textContent = '-';
            }
        }
        
        // 渲染平台配置列表
        function renderPlatformList() {
            if (!multiPlatformConfig || !multiPlatformConfig.platforms || multiPlatformConfig.platforms.length === 0) {
                platformList.innerHTML = '<div class="empty-platforms">暂无配置的平台</div>';
                return;
            }
            
            const platformsHtml = multiPlatformConfig.platforms.map(platform => {
                const isActive = platform.isActive || platform.id === multiPlatformConfig.activeConfigId;
                return \`
                    <div class="platform-item \${isActive ? 'active' : ''}" data-platform-id="\${platform.id}">
                        <div class="platform-details">
                            <div class="platform-name">\${getPlatformName(platform.provider)} - \${platform.name}</div>
                            <div class="platform-repo">\${platform.repositoryUrl || '未配置仓库URL'}</div>
                        </div>
                        <div class="platform-actions">
                            \${!isActive ? \`<button class="btn btn-secondary" onclick="activatePlatform('\${platform.id}')">激活</button>\` : '<span class="active-badge">当前激活</span>'}
                            <button class="btn btn-secondary" onclick="testPlatform('\${platform.id}')">测试</button>
                            <button class="btn btn-danger" onclick="deletePlatform('\${platform.id}')">删除</button>
                        </div>
                    </div>
                \`;
            }).join('');
            
            platformList.innerHTML = platformsHtml;
        }
        
        // 激活平台配置
        function activatePlatform(configId) {
            vscode.postMessage({
                type: 'activatePlatformConfig',
                configId: configId
            });
        }
        

        
        // 测试平台连接
        function testPlatform(configId) {
            const platform = multiPlatformConfig.platforms.find(p => p.id === configId);
            if (platform) {
                vscode.postMessage({
                    type: 'testPlatformConnection',
                    config: platform
                });
            }
        }
        
        // 删除平台配置
        function deletePlatform(configId) {
            // console.log('删除平台配置，ID:', configId);
            const platform = multiPlatformConfig.platforms.find(p => p.id === configId);
            if (platform) {
                // console.log('找到平台配置:', getPlatformName(platform.provider), '-', platform.name);
                // console.log('发送删除请求到后端进行确认');
                vscode.postMessage({
                    type: 'deletePlatformConfig',
                    configId: configId
                });
            } else {
                console.error('未找到要删除的平台配置，ID:', configId);
                showStatus('未找到要删除的配置', 'error');
            }
        }
        
        // 添加新平台配置
        function addPlatformConfig(provider) {
            vscode.postMessage({
                type: 'addPlatformConfig',
                provider: provider
            });
        }
        
        // 绑定添加平台按钮事件
        if (addGitHubBtn) addGitHubBtn.addEventListener('click', () => addPlatformConfig('github'));
        if (addGitLabBtn) addGitLabBtn.addEventListener('click', () => addPlatformConfig('gitlab'));
        if (addGiteeBtn) addGiteeBtn.addEventListener('click', () => addPlatformConfig('gitee'));
        
        // 将函数暴露到全局作用域，以便HTML中的onclick可以调用
        window.activatePlatform = activatePlatform;
        window.testPlatform = testPlatform;
        window.deletePlatform = deletePlatform;
        
        // 移除了与模态框相关的事件监听器

        // 确保按钮状态正确
        restoreButtonStates();
        
        // 请求加载配置
        vscode.postMessage({
            type: 'getConfig'
        });
    </script>
</body>
</html>`
  }
}
