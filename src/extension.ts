import * as vscode from 'vscode'
import { StorageManager } from './storage/storageManager'
import { v4 as uuidv4 } from 'uuid'
import { CodeSnippet, Directory } from './types/types'
import { SnippetEditor } from './editor/snippetEditor'
import { SnippetsTreeDataProvider } from './provider/treeProvider'
import { ImportExportManager } from './utils/importExport'
import { SearchManager } from './utils/searchManager'
import { SettingsWebviewProvider } from './provider/settingsWebviewProvider'
import { HistoryWebviewProvider } from './provider/historyWebviewProvider'
import { DataViewerWebviewProvider } from './provider/dataViewerWebviewProvider'
import { SettingsManager } from './utils/settingsManager'
import { CloudSyncManager } from './utils/cloudSyncManager'
import { AutoSyncManager } from './utils/autoSyncManager'
import { ContextManager } from './utils/contextManager'
import { SyncStatusManager } from './utils/syncStatusManager'
import { StorageStrategyFactory, V1StorageStrategy, V2StorageStrategy } from './utils/storageStrategy'
import { StorageContext } from './utils/storageContext'
import { PathBasedManager } from './utils/pathBasedManager'
import { 
  validateFileSystemSafety, 
  checkSnippetDirectoryConflict, 
  checkDirectorySnippetConflict,
  sanitizeName 
} from './utils/nameValidator'
import { registerMigrateCommands } from './commands/migrateCommand'
import { registerNameValidationTestCommands } from './commands/testNameValidation'
import { registerCleanupCommands } from './commands/cleanupCommand'
import { registerDebugGiteeAuthCommand } from './commands/debugGiteeAuth'
import { registerTestGiteeAuthMethodsCommand } from './commands/testGiteeAuthMethods'
import { registerClearGitCredentialsCommand } from './commands/clearGitCredentials'
import { registerReconfigureGitRemoteCommand } from './commands/reconfigureGitRemote'
import { PathUtils } from './utils/pathUtils'

/**
 * 确保配置已正确注册，修复插件更新后可能出现的配置注册问题
 */
function ensureConfigurationRegistered(): void {
  try {
    // 检查多平台配置是否已注册
    const config = vscode.workspace.getConfiguration()
    const multiPlatformConfigSchema = config.inspect('starcode-snippets.multiPlatformCloudSync')
    
    if (!multiPlatformConfigSchema || !multiPlatformConfigSchema.defaultValue) {
      // 配置未正确注册，等待一段时间后重试
      // console.log('检测到配置注册问题，等待配置系统初始化...')
      setTimeout(() => {
        const retryConfig = vscode.workspace.getConfiguration()
        const retrySchema = retryConfig.inspect('starcode-snippets.multiPlatformCloudSync')
        if (!retrySchema || !retrySchema.defaultValue) {
          console.warn('配置系统初始化可能存在延迟，但将继续执行...')
        } else {
          // console.log('配置系统已完成初始化')
        }
      }, 100)
    } else {
      // console.log('配置注册检查通过')
    }
  } catch (error) {
    console.warn('配置注册检查出现错误，但将继续执行:', error)
  }
}

/**
 * 等待配置注册完成的异步函数
 */
async function waitForConfigurationRegistered(maxWaitTime: number = 3000): Promise<void> {
  const startTime = Date.now()
  
  while (Date.now() - startTime < maxWaitTime) {
    try {
      const config = vscode.workspace.getConfiguration()
      const multiPlatformConfigSchema = config.inspect('starcode-snippets.multiPlatformCloudSync')
      
      if (multiPlatformConfigSchema && multiPlatformConfigSchema.defaultValue) {
        // console.log('配置注册已完成')
        return
      }
      
      // 等待50ms后重试
      await new Promise(resolve => setTimeout(resolve, 50))
    } catch (error) {
      // 忽略检查错误，继续等待
    }
  }
  
  // 超时后继续执行，但记录警告
  console.warn(`配置注册等待超时 (${maxWaitTime}ms)，将继续执行`)
}

/**
 * 启动时配置修复助手
 * 在插件更新后自动处理配置注册延迟问题
 */
async function initializeConfigurationSystem(): Promise<void> {
  try {
    // 第一步：基础检查
    ensureConfigurationRegistered()
    
    // 第二步：等待配置系统完全初始化
    await waitForConfigurationRegistered(3000)
    
    // 第三步：验证配置可写性
    try {
      const testConfig = vscode.workspace.getConfiguration()
      await testConfig.update('starcode-snippets.multiPlatformCloudSync', 
        testConfig.get('starcode-snippets.multiPlatformCloudSync'), 
        vscode.ConfigurationTarget.Global
      )
      // console.log('配置系统验证通过')
    } catch (testError) {
      console.warn('配置系统验证失败，但将继续执行:', testError)
    }
    
  } catch (error) {
    console.warn('配置系统初始化过程中发生错误，但将继续执行:', error)
  }
}

/**
 * 检查并通知用户配置问题
 * 用于启动后检测常见的配置问题并给出解决建议
 */
async function checkAndNotifyConfigurationIssues(context: vscode.ExtensionContext): Promise<void> {
  try {
    // 检查配置系统是否正常工作
    const config = vscode.workspace.getConfiguration()
    const configSchema = config.inspect('starcode-snippets.multiPlatformCloudSync')
    
    if (!configSchema || configSchema.defaultValue === undefined) {
      // 配置系统仍有问题，显示用户友好的提示
      const action = await vscode.window.showWarningMessage(
        '⚠️ StarCode Snippets 插件配置系统正在初始化中\n\n' +
        '这是插件更新后的正常现象。如果遇到"导入设置失败"等问题，请稍等片刻后重试。\n\n' +
        '常见解决方案：\n' +
        '• 重新加载窗口 (Ctrl+Shift+P → "重新加载窗口")\n' +
        '• 重启 VSCode\n' +
        '• 稍等1-2分钟后重试操作',
        '重新加载窗口',
        '我知道了'
      )
      
      if (action === '重新加载窗口') {
        vscode.commands.executeCommand('workbench.action.reloadWindow')
      }
      return
    }
    
    // 检查是否存在空的配置（可能表示导入失败）
    const multiConfig = config.get('starcode-snippets.multiPlatformCloudSync') as any
    if (multiConfig && multiConfig.platforms && multiConfig.platforms.length === 0) {
      // 检查是否有表示需要导入的状态标记
      const lastErrorCheck = context.globalState.get('lastConfigError', '')
      if (lastErrorCheck.includes('没有注册配置') || lastErrorCheck.includes('multiPlatformCloudSync')) {
        const action = await vscode.window.showInformationMessage(
          '💡 检测到配置系统已准备就绪\n\n' +
          '如果您之前尝试导入设置时遇到错误，现在可以重新尝试了。',
          '打开设置页面',
          '稍后处理'
        )
        
        if (action === '打开设置页面') {
          vscode.commands.executeCommand('starcode-snippets.openSettings')
        }
        
        // 清除错误标记
        await context.globalState.update('lastConfigError', undefined)
      }
    }
    
  } catch (error) {
    // 静默处理检查错误，不影响用户体验
    console.warn('配置问题检查失败:', error)
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.time('starcode-snippets:activate')
  // console.log('StarCode Snippets 扩展开始激活...')

  try {
    // 首先初始化配置系统，处理插件更新后的配置注册问题
    // console.log('初始化配置系统...')
    await initializeConfigurationSystem()

    // 初始化设置管理器
    // console.log('初始化设置管理器...')
    SettingsManager.setExtensionContext(context)

    // 检查是否是首次启动或配置导入可能失败的情况
    setTimeout(() => {
      checkAndNotifyConfigurationIssues(context)
    }, 5000) // 5秒后检查，确保插件完全激活

    // 使用策略模式初始化存储
    const storageStrategy = StorageStrategyFactory.createStrategy(context)
    const storageContext = new StorageContext(storageStrategy)

    // 输出当前策略的版本
    // console.log(`当前使用的存储策略版本: ${storageContext.getVersion()}`)

    // 自动检测并迁移 v1 到 v2 数据
    // 使用异步函数但不等待，使其在后台运行
    ;(async () => {
      try {
        // 检查是否已经完成迁移
        const hasCompletedMigration = context.globalState.get('migratedToV2', false)
        
        if (hasCompletedMigration) {
          // console.log('迁移已完成，跳过自动迁移检查')
          return
        }

        // console.log('检查是否需要执行数据迁移...')

        // 直接检查globalState中的原始V1数据（而不是通过Strategy）
        const v1SnippetsInGlobalState = context.globalState.get('snippets.v1', [])
        const v1DirectoriesInGlobalState = context.globalState.get('directories.v1', [])
        
        // 同时检查旧版本直接存储在globalState中的数据
        const oldSnippets = context.globalState.get('snippets', [])
        const oldDirectories = context.globalState.get('directories', [])

        const hasV1Data = v1SnippetsInGlobalState.length > 0 || v1DirectoriesInGlobalState.length > 0
        const hasOldData = oldSnippets.length > 0 || oldDirectories.length > 0

        if (hasV1Data) {
          // console.log(`检测到V1格式数据: ${v1SnippetsInGlobalState.length}个代码片段和${v1DirectoriesInGlobalState.length}个目录，准备迁移到v2...`)

          // 检查是否有v2数据
          const v2Snippets = context.globalState.get('snippets.v2', [])
          const v2Directories = context.globalState.get('directories.v2', [])

          // if (v2Snippets.length > 0 || v2Directories.length > 0) {
          //   // console.log(
          //     `同时存在v2数据: ${v2Snippets.length}个代码片段和${v2Directories.length}个目录，将合并两种格式数据...`
          //   )
          // }

          // 执行合并迁移，删除V1数据
          await storageContext.convertToV2(true, true, true)

          // 更新迁移状态
          await context.globalState.update('migratedToV2', true)

          // 清除缓存并刷新视图
          await storageContext.clearCache()
          setTimeout(() => {
            vscode.commands.executeCommand('starcode-snippets.refreshExplorer')
            setTimeout(() => {
              vscode.commands.executeCommand('starcode-snippets.forceRefreshView')
            }, 1000)
          }, 1000)

          // console.log('v1和v2数据合并完成')
        } else if (hasOldData) {
          // console.log(`检测到旧版本数据: ${oldSnippets.length}个代码片段, ${oldDirectories.length}个目录`)

          try {
            // 先切换到V1策略来处理旧数据
            const tempV1Strategy = new V1StorageStrategy(context)
            
            // 将旧数据转换为V1格式并保存
            for (const dir of oldDirectories) {
              await tempV1Strategy.createDirectory(dir)
            }

            for (const snippet of oldSnippets) {
              await tempV1Strategy.saveSnippet(snippet)
            }

            // console.log('旧版本数据转换为V1格式成功，执行迁移到V2...')

            // 迁移到V2，删除V1数据
            await storageContext.convertToV2(true, true, true)

            // 删除原始的旧版本数据（从globalState中完全清除）
            await context.globalState.update('snippets', undefined)
            await context.globalState.update('directories', undefined)

            // 更新迁移状态
            await context.globalState.update('migratedToV2', true)

            // 清除缓存
            await storageContext.clearCache()

            // 刷新视图
            setTimeout(() => {
              vscode.commands.executeCommand('starcode-snippets.refreshExplorer')

              // 强制刷新
              setTimeout(() => {
                vscode.commands.executeCommand('starcode-snippets.forceRefreshView')
              }, 1000)
            }, 1000)

            // console.log('从旧版本成功迁移数据到 v2 版本，原始数据已清除')
          } catch (importError) {
            console.error('从旧版本导入数据失败:', importError)
          }
        } else {
          // console.log('未检测到需要迁移的数据，标记迁移为已完成')
          await context.globalState.update('migratedToV2', true)
        }
      } catch (error) {
        console.error('自动迁移数据失败:', error)
        // 静默失败，不显示错误信息给用户
      }
    })()

    // 创建适配的StorageManager，代理到StorageContext
    const storageManager = new StorageManager(context)
    
    // 重写StorageManager的关键方法，代理到StorageContext
    storageManager.getAllSnippets = () => storageContext.getAllSnippets()
    storageManager.getAllDirectories = () => storageContext.getAllDirectories()
    storageManager.saveSnippet = (snippet: any) => storageContext.saveSnippet(snippet)
    storageManager.updateSnippet = (snippet: any) => storageContext.updateSnippet(snippet)
    storageManager.deleteSnippet = (id: string) => storageContext.deleteSnippet(id)
    storageManager.createDirectory = (directory: any) => storageContext.createDirectory(directory)
    storageManager.updateDirectory = (directory: any) => storageContext.updateDirectory(directory)
    storageManager.deleteDirectory = (id: string) => storageContext.deleteDirectory(id)
    storageManager.clearCache = () => storageContext.clearCache()
    
    // 添加V2格式支持的方法
    ;(storageManager as any).getSnippetByPath = (path: string) => storageContext.getSnippetByPath(path)
    ;(storageManager as any).getDirectoryByPath = (path: string) => storageContext.getDirectoryByPath(path)
    ;(storageManager as any).getSnippetById = (id: string) => storageContext.getSnippetById(id)
    ;(storageManager as any).getDirectoryById = (id: string) => storageContext.getDirectoryById(id)
    
    // 添加获取上下文的方法，以便TreeDataProvider能检测存储格式
    ;(storageManager as any).getStorageContext = () => storageContext

    // 创建标准组件
    const searchManager = new SearchManager()
    const treeDataProvider = new SnippetsTreeDataProvider(storageManager, searchManager)

    // 添加在注册命令前，注册迁移命令
    context.subscriptions.push(...registerMigrateCommands(context, storageContext))

  // 注册名称验证测试命令
  context.subscriptions.push(...registerNameValidationTestCommands(context))

  // 注册清理命令
  context.subscriptions.push(...registerCleanupCommands(context))

  // 注册调试命令
  context.subscriptions.push(registerDebugGiteeAuthCommand(context))
  context.subscriptions.push(registerTestGiteeAuthMethodsCommand(context))
  context.subscriptions.push(registerClearGitCredentialsCommand(context))
  context.subscriptions.push(registerReconfigureGitRemoteCommand(context))
  
  // 注册平台切换和冲突解决命令
  const { registerSwitchPlatformCommand } = require('./commands/switchPlatformCommand')
  const { registerConflictMergeCommand } = require('./commands/conflictMergeCommand')
  const { registerTestMultiPlatformStorageCommand } = require('./commands/testMultiPlatformStorage')
  const { registerDiagnoseConfigPermissionsCommand } = require('./commands/diagnoseConfigPermissionsSimple')
  context.subscriptions.push(registerSwitchPlatformCommand(context))
  context.subscriptions.push(registerConflictMergeCommand(context, storageManager))
  context.subscriptions.push(registerTestMultiPlatformStorageCommand(context))
  context.subscriptions.push(registerDiagnoseConfigPermissionsCommand(context))
    
    // 注册测试命令（仅在开发环境或调试模式下）
    const { registerTestCommands } = require('./commands/testCommand')
    context.subscriptions.push(...registerTestCommands(context, storageContext))

    // 创建自动同步管理器
    // console.log('创建自动同步管理器...')
    const autoSyncManager = new AutoSyncManager(context, storageManager)

    // 初始化同步状态管理器
    // console.log('初始化同步状态管理器...')
    const syncStatusManager = SyncStatusManager.getInstance(context)

    // 设置自动同步管理器的刷新回调
    autoSyncManager.setRefreshCallback(() => {
      // console.log('自动同步完成，刷新树视图...')
      // 只进行简单的视图刷新，避免复杂操作可能引起的循环同步
      treeDataProvider.refresh()
    })

    // 注册树视图
    // console.log('注册树视图 starCodeSnippetsExplorer...')
    const treeView = vscode.window.createTreeView('starCodeSnippetsExplorer', {
      treeDataProvider: treeDataProvider,
      showCollapseAll: true,
      canSelectMany: false,
    })

    // console.log('树视图注册成功，ID:', treeView.title)

    // 将树视图和数据提供程序添加到上下文订阅中
    context.subscriptions.push(treeView)
    context.subscriptions.push({
      dispose: () => {
        treeDataProvider.dispose()
      },
    })

    // 确保树视图在激活后能正确显示内容
    setTimeout(() => {
      treeDataProvider.refresh()
    }, 100)

    // 注册一个命令用于强制刷新树视图（在数据迁移或导入后使用）
    const forceRefreshCommand = vscode.commands.registerCommand('starcode-snippets.forceRefreshView', async () => {
      // console.log('执行强制刷新命令')
      await storageContext.clearCache()
      if (typeof treeDataProvider.forceRefresh === 'function') {
        await treeDataProvider.forceRefresh()
      } else {
        treeDataProvider.refresh()
      }
      vscode.window.showInformationMessage('视图已强制刷新')
    })
    context.subscriptions.push(forceRefreshCommand)

    // 立即初始化编辑器和注册命令（不使用延迟）
    // console.log('开始初始化编辑器和命令...')

    try {
      // 初始化代码片段编辑器
      // console.log('初始化代码片段编辑器...')
      const snippetEditor = SnippetEditor.initialize(context, storageManager)

      // 监听SnippetEditor的保存事件，以便刷新视图
      snippetEditor.onDidSaveSnippet(() => {
        treeDataProvider.refresh()
      })

      // 注册完成编辑命令
      // console.log('注册完成编辑命令...')
      const finishEditing = vscode.commands.registerCommand('starcode-snippets.finishEditing', async () => {
        // 保存当前文档
        if (vscode.window.activeTextEditor) {
          await vscode.window.activeTextEditor.document.save()
        }
        // 关闭编辑器
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
      })
      context.subscriptions.push(finishEditing)

      // 注册所有命令
      // console.log('注册所有命令...')
      const commands = registerCommands(
        context,
        storageManager,
        treeDataProvider,
        searchManager,
        autoSyncManager,
        storageContext
      )

      // 添加命令到订阅中
      context.subscriptions.push(...commands)

      // 添加自动同步管理器到订阅中，确保扩展停用时清理
      context.subscriptions.push({
        dispose: () => {
          autoSyncManager.dispose()
          syncStatusManager.dispose()
        },
      })

      // console.log('StarCode Snippets 扩展激活完成')
      console.timeEnd('starcode-snippets:activate')

          // 添加配置变化监听器
    const configurationChangeListener = vscode.workspace.onDidChangeConfiguration(event => {
      // 检查是否是云端同步相关的配置变化
      if (event.affectsConfiguration('starcode-snippets.multiPlatformCloudSync')) {
        console.log('检测到云端同步配置变化，重启自动同步...')
        
        // 延迟一点时间确保配置已经更新
        setTimeout(() => {
          const config = SettingsManager.getCloudSyncConfig()
          if (config.autoSync) {
            console.log('自动同步已启用，重启自动同步管理器...')
            autoSyncManager.restart()
          } else {
            console.log('自动同步已禁用，停止自动同步管理器...')
            autoSyncManager.stop()
          }
        }, 500)
      }
    })
    context.subscriptions.push(configurationChangeListener)

    // 延迟启动自动同步（如果配置了的话）
    setTimeout(() => {
      const config = SettingsManager.getCloudSyncConfig()
      if (config.autoSync) {
        console.log('配置中启用了自动同步，正在启动...')
        autoSyncManager.start()
      } else {
        console.log('自动同步未启用或配置不完整')
      }
    }, 2000) // 延迟2秒启动，确保扩展完全初始化
    } catch (error) {
      console.error('初始化过程中发生错误:', error)
      vscode.window.showErrorMessage(`StarCode Snippets 初始化失败: ${error}`)
    }
  } catch (error) {
    console.error('StarCode Snippets 扩展激活失败:', error)
    vscode.window.showErrorMessage(`StarCode Snippets 激活失败: ${error}`)
  }
}

// 将命令注册逻辑分离出来，便于延迟加载
function registerCommands(
  context: vscode.ExtensionContext,
  storageManager: StorageManager,
  treeDataProvider: SnippetsTreeDataProvider,
  searchManager: SearchManager,
  autoSyncManager: AutoSyncManager,
  storageContext: StorageContext
): vscode.Disposable[] {
  // 创建导入导出管理器
  const importExportManager = new ImportExportManager(storageManager, storageContext)

  // 内部刷新视图函数
  function refreshTreeView(): void {
    treeDataProvider.refresh()
    // console.log('视图已刷新')
  }

  // 插入代码片段的通用函数
  async function insertSnippet(snippet: CodeSnippet): Promise<boolean> {
    const editor = vscode.window.activeTextEditor
    if (editor) {
      const position = editor.selection.active
      await editor.edit((editBuilder) => {
        editBuilder.insert(position, snippet.code)
      })
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
      return true
    }
    return false
  }

  // 检查同一目录下是否有重名代码片段
  async function checkDuplicateSnippetName(name: string, parentId: string | null): Promise<boolean> {
    const snippets = await storageManager.getAllSnippets()
    return snippets.some((s) => s.name === name && s.parentId === parentId)
  }

  // 检查同一级别是否有重名目录
  async function checkDuplicateDirectoryName(name: string, parentId: string | null): Promise<boolean> {
    const directories = await storageManager.getAllDirectories()
    return directories.some((d) => d.name === name && d.parentId === parentId)
  }

  // 语言ID映射
  function mapLanguageToVSCode(language: string): string {
    switch (language) {
      case 'vue':
        return 'html'
      case 'shell':
        return 'shellscript'
      case 'yaml':
        return 'yaml'
      case 'cpp':
        return 'cpp'
      case 'csharp':
        return 'csharp'
      default:
        return language
    }
  }

  // 注册刷新浏览器命令
  const refreshExplorer = vscode.commands.registerCommand('starcode-snippets.refreshExplorer', () => {
    refreshTreeView()
  })

  // 注册保存代码片段命令
  const saveToLibrary = vscode.commands.registerCommand('starcode-snippets.saveToLibrary', async () => {
    const editor = vscode.window.activeTextEditor
    if (editor) {
      const selection = editor.selection
      const code = editor.document.getText(selection)
      const fileName = editor.document.fileName.split('/').pop() || ''

      const name = await vscode.window.showInputBox({
        prompt: '为代码片段命名',
        placeHolder: '输入代码片段名称',
      })

      if (name) {
        // 1. 验证文件系统安全性
        const nameValidation = validateFileSystemSafety(name)
        if (!nameValidation.isValid) {
          vscode.window.showErrorMessage(`代码片段名称无效: ${nameValidation.error}`)
          return
        }

        const directories = await storageManager.getAllDirectories()
        const currentVersion = storageContext.getCurrentStorageVersion()
        
        // 根据存储版本准备目录选项
        let directoryItems: Array<{ label: string; id: string | null; fullPath?: string }>
        
        if (currentVersion === 'v2') {
          // V2格式：使用fullPath
          directoryItems = [
            { label: '根目录', id: null, fullPath: '/' },
            ...directories.map((dir: any) => ({ 
              label: dir.name, 
              id: PathBasedManager.generateIdFromPath(dir.fullPath),
              fullPath: dir.fullPath 
            })),
          ]
        } else {
          // V1格式：使用id
          directoryItems = [
            { label: '根目录', id: null },
            ...directories.map((dir: any) => ({ label: dir.name, id: dir.id })),
          ]
        }

        const selectedDirectory = await vscode.window.showQuickPick(directoryItems, {
          placeHolder: '选择保存位置',
        })

        if (selectedDirectory) {
          // 2. 检查是否与目录名称冲突
          const parentPath = currentVersion === 'v2' ? (selectedDirectory.fullPath || '/') : (selectedDirectory.id || null)
          const hasDirectoryConflict = checkSnippetDirectoryConflict(name, directories, parentPath, currentVersion)
          if (hasDirectoryConflict) {
            vscode.window.showErrorMessage(`不能创建代码片段 "${name}"，因为已存在同名目录`)
            return
          }

          // 3. 检查代码片段重名
          let isDuplicate = false
          
          if (currentVersion === 'v2') {
            // V2格式：基于路径检查重复
            const targetPath = selectedDirectory.fullPath === '/' 
              ? `/${name}` 
              : `${selectedDirectory.fullPath}${name}`
            
            const existingSnippet = await storageContext.getSnippetByPath(targetPath)
            isDuplicate = existingSnippet !== null
          } else {
            // V1格式：使用原有逻辑
            isDuplicate = await checkDuplicateSnippetName(name, selectedDirectory.id)
          }
          
          if (isDuplicate) {
            vscode.window.showErrorMessage(`所选目录中已存在名为 "${name}" 的代码片段`)
            return
          }

          // 自动检测语言
          let language = 'plaintext'
          const fileExt = fileName.split('.').pop()?.toLowerCase()
          if (fileExt) {
            const langMap: { [key: string]: string } = {
              ts: 'typescript',
              js: 'javascript',
              html: 'html',
              css: 'css',
              json: 'json',
              vue: 'vue',
              py: 'python',
              java: 'java',
              cs: 'csharp',
              cpp: 'cpp',
              c: 'cpp',
              h: 'cpp',
              go: 'go',
              php: 'php',
              rb: 'ruby',
              rs: 'rust',
              sql: 'sql',
              md: 'markdown',
              yml: 'yaml',
              yaml: 'yaml',
              sh: 'shell',
              bash: 'shell',
            }
            language = langMap[fileExt] || 'plaintext'
          }

          // 内容检测
          if (language === 'plaintext') {
            if (code.includes('<template>') && code.includes('<script')) {
              language = 'vue'
            } else if (code.includes('<!DOCTYPE html>') || (code.includes('<html') && code.includes('<body'))) {
              language = 'html'
            } else if (code.includes('function') || code.includes('const ') || code.includes('let ')) {
              if (code.includes(': string') || code.includes('interface ')) {
                language = 'typescript'
              } else {
                language = 'javascript'
              }
            }
          }

          // 根据存储版本创建代码片段
          let snippet: any
          
          if (currentVersion === 'v2') {
            // V2格式：使用fullPath
            const fullPath = selectedDirectory.fullPath === '/' 
              ? `/${name}` 
              : `${selectedDirectory.fullPath}${name}`
            
            snippet = {
              name,
              code,
              fileName,
              filePath: editor.document.fileName,
              category: selectedDirectory.label,
              fullPath: fullPath,
              order: 0,
              createTime: Date.now(),
              language: language,
            }
          } else {
            // V1格式：使用id和parentId
            snippet = {
              id: uuidv4(),
              name,
              code,
              fileName,
              filePath: editor.document.fileName,
              category: selectedDirectory.label,
              parentId: selectedDirectory.id,
              order: 0,
              createTime: Date.now(),
              language: language,
            }
          }

          await storageManager.saveSnippet(snippet)
          refreshTreeView()
        }
      }
    }
  })

  // 注册预览代码片段命令
  const previewSnippet = vscode.commands.registerCommand(
    'starcode-snippets.previewSnippet',
    async (snippet: CodeSnippet) => {
      if (!snippet) {
        return
      }

      try {
        const language = snippet.language || 'plaintext'

        // 检查是否已有预览窗口
        if (TextDocumentContentProvider.instance) {
          const existingPreviewUri = TextDocumentContentProvider.instance.getOpenPreviewUri(snippet.id)
          if (existingPreviewUri) {
            for (const editor of vscode.window.visibleTextEditors) {
              if (editor.document.uri.toString() === existingPreviewUri.toString()) {
                await vscode.window.showTextDocument(editor.document, {
                  viewColumn: editor.viewColumn,
                  preserveFocus: false,
                  preview: true,
                })
                return
              }
            }
            TextDocumentContentProvider.instance.setOpenPreview(snippet.id, undefined)
          }
        }

        const scheme = 'starcode-preview'
        const uri = vscode.Uri.parse(`${scheme}:${snippet.name}_${snippet.id}.${language}`)

        if (!TextDocumentContentProvider.instance) {
          TextDocumentContentProvider.register(context)
        }

        TextDocumentContentProvider.instance.update(uri, snippet.code || '', language)
        TextDocumentContentProvider.instance.setOpenPreview(snippet.id, uri)

        const document = await vscode.workspace.openTextDocument(uri)

        const vscodeLangId = mapLanguageToVSCode(language)
        if (vscodeLangId !== 'plaintext') {
          try {
            await vscode.languages.setTextDocumentLanguage(document, vscodeLangId)
          } catch (error) {
            console.warn(`无法设置语言为 ${vscodeLangId}:`, error)
            if (language === 'vue') {
              await vscode.languages.setTextDocumentLanguage(document, 'html')
            }
          }
        }

        await vscode.window.showTextDocument(document, {
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: false,
          preview: true,
        })

        // vscode.window.showInformationMessage(`预览: ${snippet.name}`);
      } catch (error) {
        console.error('预览失败:', error)
        vscode.window.showErrorMessage(`预览代码片段失败: ${error}`)
      }
    }
  )

  // 重命名命令
  const renameItem = vscode.commands.registerCommand('starcode-snippets.rename', async (item: any) => {
    if (!item) {
      return
    }

    const newName = await vscode.window.showInputBox({
      prompt: '重命名...',
      value: item.label,
    })

    if (newName) {
      // 1. 验证文件系统安全性
      const nameValidation = validateFileSystemSafety(newName)
      if (!nameValidation.isValid) {
        vscode.window.showErrorMessage(`名称无效: ${nameValidation.error}`)
        return
      }

      const currentVersion = storageContext.getCurrentStorageVersion()
      
      if (item.snippet) {
        // 2. 检查是否与目录名称冲突
        const directories = await storageManager.getAllDirectories()
        const parentPath = currentVersion === 'v2' 
          ? (item.snippet.fullPath ? item.snippet.fullPath.substring(0, item.snippet.fullPath.lastIndexOf('/') + 1) : '/')
          : (item.snippet.parentId || null)
        const hasDirectoryConflict = checkSnippetDirectoryConflict(newName, directories, parentPath, currentVersion)
        if (hasDirectoryConflict) {
          vscode.window.showErrorMessage(`不能重命名为 "${newName}"，因为已存在同名目录`)
          return
        }

        // 3. 检查代码片段重名
        let isDuplicate = false
        
        if (currentVersion === 'v2') {
          // V2格式：基于路径检查重复
          const pathParts = item.snippet.fullPath.split('/')
          pathParts[pathParts.length - 1] = newName // 替换最后一部分为新名称
          const newFullPath = pathParts.join('/')
          
          // 检查新路径是否已存在且不是当前代码片段
          const existingSnippet = await storageContext.getSnippetByPath(newFullPath)
          isDuplicate = existingSnippet !== null && existingSnippet.fullPath !== item.snippet.fullPath
        } else {
          // V1格式：使用原有逻辑
          isDuplicate = await checkDuplicateSnippetName(newName, item.snippet.parentId)
        }
        
        if (isDuplicate) {
          vscode.window.showErrorMessage(`所选目录中已存在名为 "${newName}" 的代码片段`)
          return
        }
        
        if (currentVersion === 'v2') {
          // V2格式：需要更新fullPath
          const pathParts = item.snippet.fullPath.split('/')
          pathParts[pathParts.length - 1] = newName // 替换最后一部分为新名称
          const newFullPath = pathParts.join('/')
          
          const updatedSnippet = { 
            ...item.snippet, 
            name: newName,
            fullPath: newFullPath
          }
          
          // 删除原代码片段，保存新的
          // console.log(`重命名代码片段: 删除原路径 ${item.snippet.fullPath}`)
          await storageContext.deleteSnippet(PathBasedManager.generateIdFromPath(item.snippet.fullPath))
          
          // console.log(`重命名代码片段: 保存新路径 ${newFullPath}`)
          await storageContext.saveSnippet(updatedSnippet)
        } else {
          // V1格式：直接更新
          const updatedSnippet = { ...item.snippet, name: newName }
          await storageManager.updateSnippet(updatedSnippet)
        }
      } else if (item.directory) {
        // 2. 检查是否与代码片段名称冲突
        const snippets = await storageManager.getAllSnippets()
        const parentPath = currentVersion === 'v2' 
          ? (item.directory.fullPath ? item.directory.fullPath.substring(0, item.directory.fullPath.lastIndexOf('/', item.directory.fullPath.length - 2) + 1) : '/')
          : (item.directory.parentId || null)
        const hasSnippetConflict = checkDirectorySnippetConflict(newName, snippets, parentPath, currentVersion)
        if (hasSnippetConflict) {
          vscode.window.showErrorMessage(`不能重命名为 "${newName}"，因为已存在同名代码片段`)
          return
        }

        // 3. 检查目录重名
        let isDuplicate = false
        
        if (currentVersion === 'v2') {
          // V2格式：基于路径检查重复
          const oldPath = item.directory.fullPath
          const pathParts = oldPath.split('/')
          pathParts[pathParts.length - 2] = newName // 倒数第二个是目录名（最后一个是空字符串）
          const newFullPath = pathParts.join('/')
          
          // 检查新路径是否已存在且不是当前目录
          const existingDirectory = await storageContext.getDirectoryByPath(newFullPath)
          isDuplicate = existingDirectory !== null && existingDirectory.fullPath !== item.directory.fullPath
        } else {
          // V1格式：使用原有逻辑
          isDuplicate = await checkDuplicateDirectoryName(newName, item.directory.parentId)
        }
        
        if (isDuplicate) {
          vscode.window.showErrorMessage(`当前层级已存在名为 "${newName}" 的目录`)
          return
        }
        
        if (currentVersion === 'v2') {
          // V2格式：需要更新fullPath以及所有子项目的路径
          const oldPath = item.directory.fullPath
          const pathParts = oldPath.split('/')
          pathParts[pathParts.length - 2] = newName // 倒数第二个是目录名（最后一个是空字符串）
          const newFullPath = pathParts.join('/')
          
          const updatedDirectory = { 
            ...item.directory, 
            name: newName,
            fullPath: newFullPath
          }
          
          // 删除原目录，保存新的
          // console.log(`重命名目录: 删除原路径 ${oldPath}`)
          await storageContext.deleteDirectory(PathBasedManager.generateIdFromPath(oldPath))
          
          // console.log(`重命名目录: 保存新路径 ${newFullPath}`)
          await storageContext.createDirectory(updatedDirectory)
          
          // 更新所有子代码片段和子目录的路径
          const allSnippets = await storageContext.getAllSnippets()
          const allDirectories = await storageContext.getAllDirectories()
          
          // 更新子代码片段
          for (const snippet of allSnippets) {
            if (snippet.fullPath && snippet.fullPath.startsWith(oldPath)) {
              const newSnippetPath = snippet.fullPath.replace(oldPath, newFullPath)
              const updatedSnippet = { ...snippet, fullPath: newSnippetPath }
              
              await storageContext.deleteSnippet(PathBasedManager.generateIdFromPath(snippet.fullPath))
              await storageContext.saveSnippet(updatedSnippet)
            }
          }
          
          // 更新子目录
          for (const dir of allDirectories) {
            if (dir.fullPath && dir.fullPath !== newFullPath && dir.fullPath.startsWith(oldPath)) {
              const newDirPath = dir.fullPath.replace(oldPath, newFullPath)
              const updatedDir = { ...dir, fullPath: newDirPath }
              
              await storageContext.deleteDirectory(PathBasedManager.generateIdFromPath(dir.fullPath))
              await storageContext.createDirectory(updatedDir)
            }
          }
        } else {
          // V1格式：直接更新
          const updatedDirectory = { ...item.directory, name: newName }
          await storageManager.updateDirectory(updatedDirectory)
        }
      }
      refreshTreeView()
    }
  })

  // 创建目录命令
  const createDirectory = vscode.commands.registerCommand('starcode-snippets.createDirectory', async () => {
    const name = await vscode.window.showInputBox({
      prompt: '输入目录名',
      placeHolder: '新建目录',
    })

    if (name) {
      // 1. 验证文件系统安全性
      const nameValidation = validateFileSystemSafety(name)
      if (!nameValidation.isValid) {
        vscode.window.showErrorMessage(`目录名称无效: ${nameValidation.error}`)
        return
      }

      const currentVersion = storageContext.getCurrentStorageVersion()
      
      // 2. 检查是否与代码片段名称冲突
      const snippets = await storageManager.getAllSnippets()
      const hasSnippetConflict = checkDirectorySnippetConflict(name, snippets, null, currentVersion)
      if (hasSnippetConflict) {
        vscode.window.showErrorMessage(`不能创建目录 "${name}"，因为已存在同名代码片段`)
        return
      }
      
      // 3. 检查目录重名
      let isDuplicate = false
      
      if (currentVersion === 'v2') {
        // V2格式：基于路径检查重复
        const targetPath = `/${name}/`
        const existingDirectory = await storageContext.getDirectoryByPath(targetPath)
        isDuplicate = existingDirectory !== null
      } else {
        // V1格式：使用原有逻辑
        isDuplicate = await checkDuplicateDirectoryName(name, null)
      }
      
      if (isDuplicate) {
        vscode.window.showErrorMessage(`根目录下已存在名为 "${name}" 的目录`)
        return
      }

      let directory: any
      
      if (currentVersion === 'v2') {
        // V2格式：使用fullPath
        directory = {
          name,
          fullPath: `/${name}/`,
          order: 0,
        }
      } else {
        // V1格式：使用id和parentId
        directory = {
          id: uuidv4(),
          name,
          parentId: null,
          order: 0,
        }
      }
      
      await storageManager.createDirectory(directory)
      refreshTreeView()
    }
  })

  // 在指定目录中创建代码片段命令
  const createSnippetInDirectory = vscode.commands.registerCommand(
    'starcode-snippets.createSnippetInDirectory',
    async (item: any) => {
      if (!item?.directory) {
        return
      }

      const name = await vscode.window.showInputBox({
        prompt: '输入代码片段名称',
        placeHolder: '新建代码片段',
      })

      if (name) {
        // 1. 验证文件系统安全性
        const nameValidation = validateFileSystemSafety(name)
        if (!nameValidation.isValid) {
          vscode.window.showErrorMessage(`代码片段名称无效: ${nameValidation.error}`)
          return
        }

        const storageVersion = storageContext.getCurrentStorageVersion()
        
        // 2. 检查是否与目录名称冲突
        const directories = await storageManager.getAllDirectories()
        const parentPath = storageVersion === 'v2' ? (item.directory.fullPath || '/') : (item.directory.id || null)
        const hasDirectoryConflict = checkSnippetDirectoryConflict(name, directories, parentPath, storageVersion)
        if (hasDirectoryConflict) {
          vscode.window.showErrorMessage(`不能创建代码片段 "${name}"，因为已存在同名目录`)
          return
        }
        
        // 3. 检查代码片段重名
        let isDuplicate = false
        
        if (storageVersion === 'v2') {
          // V2格式：基于路径检查重复
          const targetPath = item.directory.fullPath === '/' 
            ? `/${name}` 
            : `${item.directory.fullPath}${name}`
          
          const existingSnippet = await storageContext.getSnippetByPath(targetPath)
          isDuplicate = existingSnippet !== null
        } else {
          // V1格式：使用原有逻辑
          isDuplicate = await checkDuplicateSnippetName(name, item.directory.id)
        }
        
        if (isDuplicate) {
          vscode.window.showErrorMessage(`目录 "${item.directory.name}" 中已存在名为 "${name}" 的代码片段`)
          return
        }

        const languageOptions = [
          { label: '纯文本', value: 'plaintext' },
          { label: 'TypeScript', value: 'typescript' },
          { label: 'JavaScript', value: 'javascript' },
          { label: 'HTML', value: 'html' },
          { label: 'CSS', value: 'css' },
          { label: 'JSON', value: 'json' },
          { label: 'Vue', value: 'vue' },
          { label: 'Python', value: 'python' },
          { label: 'Java', value: 'java' },
          { label: 'C#', value: 'csharp' },
          { label: 'C++', value: 'cpp' },
          { label: 'Go', value: 'go' },
          { label: 'PHP', value: 'php' },
          { label: 'Ruby', value: 'ruby' },
          { label: 'Rust', value: 'rust' },
          { label: 'SQL', value: 'sql' },
          { label: 'Markdown', value: 'markdown' },
          { label: 'YAML', value: 'yaml' },
          { label: 'Shell', value: 'shell' },
        ]

        const selectedLanguage = await vscode.window.showQuickPick(languageOptions, {
          placeHolder: '选择代码语言',
        })

        if (!selectedLanguage) {
          return
        }

        const extMap: { [key: string]: string } = {
          typescript: '.ts',
          javascript: '.js',
          html: '.html',
          css: '.css',
          json: '.json',
          vue: '.vue',
          python: '.py',
          java: '.java',
          csharp: '.cs',
          cpp: '.cpp',
          go: '.go',
          php: '.php',
          ruby: '.rb',
          rust: '.rs',
          sql: '.sql',
          markdown: '.md',
          yaml: '.yml',
          shell: '.sh',
        }
        const fileName = 'snippet' + (extMap[selectedLanguage.value] || '.txt')

        const version = storageContext.getCurrentStorageVersion()
        let snippet: any
        
        if (version === 'v2') {
          // V2格式：使用fullPath
          const fullPath = item.directory.fullPath === '/' 
            ? `/${name}` 
            : `${item.directory.fullPath}${name}`
          
          snippet = {
            name,
            code: '',
            fileName: fileName,
            filePath: '',
            category: item.directory.name,
            fullPath: fullPath,
            order: 0,
            createTime: Date.now(),
            language: selectedLanguage.value,
          }
        } else {
          // V1格式：使用id和parentId
          snippet = {
            id: uuidv4(),
            name,
            code: '',
            fileName: fileName,
            filePath: '',
            category: item.directory.name,
            parentId: item.directory.id,
            order: 0,
            createTime: Date.now(),
            language: selectedLanguage.value,
          }
        }

        await storageManager.saveSnippet(snippet)
        refreshTreeView()

        try {
          await SnippetEditor.getInstance().edit(snippet)
        } catch (error) {
          console.error('编辑代码片段失败:', error)
          vscode.window.showErrorMessage(`编辑代码片段失败: ${error}`)
        }
      }
    }
  )

  // 创建代码片段命令（根级别）
  const createSnippet = vscode.commands.registerCommand(
    'starcode-snippets.createSnippet',
    async () => {
      const name = await vscode.window.showInputBox({
        prompt: '输入代码片段名称',
        placeHolder: '新建代码片段',
      })

      if (name) {
        // 1. 验证文件系统安全性
        const nameValidation = validateFileSystemSafety(name)
        if (!nameValidation.isValid) {
          vscode.window.showErrorMessage(`代码片段名称无效: ${nameValidation.error}`)
          return
        }

        const storageVersion = storageContext.getCurrentStorageVersion()
        
        // 2. 检查是否与目录名称冲突
        const directories = await storageManager.getAllDirectories()
        const parentPath = storageVersion === 'v2' ? '/' : null
        const hasDirectoryConflict = checkSnippetDirectoryConflict(name, directories, parentPath, storageVersion)
        if (hasDirectoryConflict) {
          vscode.window.showErrorMessage(`不能创建代码片段 "${name}"，因为已存在同名目录`)
          return
        }
        
        // 3. 检查代码片段重名（在根级别）
        let isDuplicate = false
        
        if (storageVersion === 'v2') {
          // V2格式：基于路径检查重复
          const targetPath = `/${name}`
          const existingSnippet = await storageContext.getSnippetByPath(targetPath)
          isDuplicate = existingSnippet !== null
        } else {
          // V1格式：使用原有逻辑
          isDuplicate = await checkDuplicateSnippetName(name, null)
        }
        
        if (isDuplicate) {
          vscode.window.showErrorMessage(`根目录中已存在名为 "${name}" 的代码片段`)
          return
        }

        const languageOptions = [
          { label: '纯文本', value: 'plaintext' },
          { label: 'TypeScript', value: 'typescript' },
          { label: 'JavaScript', value: 'javascript' },
          { label: 'HTML', value: 'html' },
          { label: 'CSS', value: 'css' },
          { label: 'JSON', value: 'json' },
          { label: 'Vue', value: 'vue' },
          { label: 'Python', value: 'python' },
          { label: 'Java', value: 'java' },
          { label: 'C#', value: 'csharp' },
          { label: 'C++', value: 'cpp' },
          { label: 'Go', value: 'go' },
          { label: 'PHP', value: 'php' },
          { label: 'Ruby', value: 'ruby' },
          { label: 'Rust', value: 'rust' },
          { label: 'SQL', value: 'sql' },
          { label: 'Markdown', value: 'markdown' },
          { label: 'YAML', value: 'yaml' },
          { label: 'Shell', value: 'shell' },
        ]

        const selectedLanguage = await vscode.window.showQuickPick(languageOptions, {
          placeHolder: '选择代码语言',
        })

        if (!selectedLanguage) {
          return
        }

        const extMap: { [key: string]: string } = {
          typescript: '.ts',
          javascript: '.js',
          html: '.html',
          css: '.css',
          json: '.json',
          vue: '.vue',
          python: '.py',
          java: '.java',
          csharp: '.cs',
          cpp: '.cpp',
          go: '.go',
          php: '.php',
          ruby: '.rb',
          rust: '.rs',
          sql: '.sql',
          markdown: '.md',
          yaml: '.yml',
          shell: '.sh',
        }
        const fileName = 'snippet' + (extMap[selectedLanguage.value] || '.txt')

        const version = storageContext.getCurrentStorageVersion()
        let snippet: any
        
        if (version === 'v2') {
          // V2格式：在根目录创建
          snippet = {
            name,
            code: '',
            fileName: fileName,
            filePath: '',
            category: '根目录',
            fullPath: `/${name}`,
            order: 0,
            createTime: Date.now(),
            language: selectedLanguage.value,
          }
        } else {
          // V1格式：在根目录创建（parentId为null）
          snippet = {
            id: uuidv4(),
            name,
            code: '',
            fileName: fileName,
            filePath: '',
            category: '根目录',
            parentId: null,
            order: 0,
            createTime: Date.now(),
            language: selectedLanguage.value,
          }
        }

        await storageManager.saveSnippet(snippet)
        refreshTreeView()

        try {
          await SnippetEditor.getInstance().edit(snippet)
        } catch (error) {
          console.error('编辑代码片段失败:', error)
          vscode.window.showErrorMessage(`编辑代码片段失败: ${error}`)
        }
      }
    }
  )

  // 删除命令
  const deleteItem = vscode.commands.registerCommand('starcode-snippets.delete', async (item: any) => {
    if (!item) {
      return
    }

    const confirmMessage = item.snippet
      ? `确定要删除代码片段 "${item.snippet.name}" 吗？`
      : `确定要删除目录 "${item.directory.name}" 及其所有内容吗？`

    const confirm = await vscode.window.showWarningMessage(confirmMessage, { modal: true }, '确定')

    if (confirm === '确定') {
      try {
        const currentVersion = storageContext.getCurrentStorageVersion()
        
        if (item.snippet) {
          if (currentVersion === 'v2') {
            // V2格式：使用fullPath生成的ID删除
            const deleteId = PathBasedManager.generateIdFromPath(item.snippet.fullPath)
            // console.log('删除代码片段:', item.snippet.name, 'fullPath:', item.snippet.fullPath, 'deleteId:', deleteId)
            await storageManager.deleteSnippet(deleteId)
          } else {
            // V1格式：使用id删除
            // console.log('删除代码片段:', item.snippet.name, 'ID:', item.snippet.id)
            await storageManager.deleteSnippet(item.snippet.id)
          }
          // console.log('代码片段删除成功')
        } else if (item.directory) {
          if (currentVersion === 'v2') {
            // V2格式：使用fullPath生成的ID删除
            const deleteId = PathBasedManager.generateIdFromPath(item.directory.fullPath)
            // console.log('删除目录:', item.directory.name, 'fullPath:', item.directory.fullPath, 'deleteId:', deleteId)
            await storageManager.deleteDirectory(deleteId)
          } else {
            // V1格式：使用id删除
            // console.log('删除目录:', item.directory.name, 'ID:', item.directory.id)
            await storageManager.deleteDirectory(item.directory.id)
          }
          // console.log('目录删除成功')
        }
        refreshTreeView()
      } catch (error) {
        console.error('删除失败:', error)
        vscode.window.showErrorMessage(`删除失败: ${error}`)
      }
    }
  })

  // 追加粘贴命令
  const appendCode = vscode.commands.registerCommand('starcode-snippets.appendCode', async (item: any) => {
    if (!item?.snippet) {
      return
    }

    const editor = vscode.window.activeTextEditor
    if (editor) {
      const position = editor.selection.active
      await editor.edit((editBuilder) => {
        editBuilder.insert(position, item.snippet.code)
      })
    }
  })

  // 编辑代码命令
  const editSnippet = vscode.commands.registerCommand('starcode-snippets.editSnippet', async (item: any) => {
    if (!item?.snippet) {
      return
    }

    try {
      await SnippetEditor.getInstance().edit(item.snippet)
    } catch (error) {
      console.error('编辑代码片段失败:', error)
      vscode.window.showErrorMessage(`编辑代码片段失败: ${error}`)
    }
  })

  // 移动到目录命令
  const moveToDirectory = vscode.commands.registerCommand('starcode-snippets.moveToDirectory', async (item: any) => {
    if (!item?.snippet) {
      return
    }

    try {
      const directories = await storageManager.getAllDirectories()
      const currentVersion = storageContext.getCurrentStorageVersion()
      
      // 根据存储版本准备目录选项
      let directoryItems: Array<{ label: string; id: string | null; fullPath?: string }>
      
      if (currentVersion === 'v2') {
        // V2格式：使用fullPath
        directoryItems = [
          { label: '根目录', id: null, fullPath: '/' },
          ...directories.map((dir: any) => ({ 
            label: dir.name, 
            id: PathBasedManager.generateIdFromPath(dir.fullPath),
            fullPath: dir.fullPath 
          })),
        ]
      } else {
        // V1格式：使用id
        directoryItems = [
          { label: '根目录', id: null },
          ...directories.map((dir: any) => ({ label: dir.name, id: dir.id })),
        ]
      }

      const selectedDirectory = await vscode.window.showQuickPick(directoryItems, {
        placeHolder: '选择目标目录',
      })

      if (selectedDirectory) {
        // 检查目标目录中是否有重名代码片段
        let isDuplicate = false
        
        if (currentVersion === 'v2') {
          // V2格式：基于路径检查重复
          const targetPath = selectedDirectory.fullPath === '/' 
            ? `/${item.snippet.name}` 
            : `${selectedDirectory.fullPath}${item.snippet.name}`
          
          const existingSnippet = await storageContext.getSnippetByPath(targetPath)
          isDuplicate = existingSnippet !== null && existingSnippet.fullPath !== item.snippet.fullPath
        } else {
          // V1格式：使用原有逻辑
          isDuplicate = await checkDuplicateSnippetName(item.snippet.name, selectedDirectory.id)
        }
        
        if (isDuplicate) {
          vscode.window.showErrorMessage(`目标目录中已存在名为 "${item.snippet.name}" 的代码片段`)
          return
        }

        // 根据存储版本更新代码片段
        let updatedSnippet: any
        
        if (currentVersion === 'v2') {
          // V2格式：更新fullPath
          const newFullPath = selectedDirectory.fullPath === '/' 
            ? `/${item.snippet.name}` 
            : `${selectedDirectory.fullPath}${item.snippet.name}`
          
          updatedSnippet = {
            ...item.snippet,
            fullPath: newFullPath,
            category: selectedDirectory.label,
          }
          
          // V2存储策略需要先删除原代码片段，再保存新的
          // 因为updateSnippet是基于fullPath查找的，而我们要更改fullPath
          // console.log(`删除原代码片段，路径: ${item.snippet.fullPath}`)
          await storageContext.deleteSnippet(PathBasedManager.generateIdFromPath(item.snippet.fullPath))
          
          // console.log(`保存移动后的代码片段，新路径: ${newFullPath}`)
          await storageContext.saveSnippet(updatedSnippet)
        } else {
          // V1格式：更新parentId
          updatedSnippet = {
            ...item.snippet,
            parentId: selectedDirectory.id,
            category: selectedDirectory.label,
          }
          
          await storageManager.updateSnippet(updatedSnippet)
        }

        // console.log(`移动代码片段 "${item.snippet.name}" 到目录 "${selectedDirectory.label}"`)
        // console.log('更新后的代码片段:', updatedSnippet)
        refreshTreeView()
        
        vscode.window.showInformationMessage(`✅ 代码片段 "${item.snippet.name}" 已移动到 "${selectedDirectory.label}"`)
      }
    } catch (error) {
      console.error('移动代码片段失败:', error)
      vscode.window.showErrorMessage(`移动代码片段失败: ${error}`)
    }
  })

  // 注册插入代码片段命令
  const insertSnippetCommand = vscode.commands.registerCommand(
    'starcode-snippets.insertSnippet',
    async (snippet: CodeSnippet) => {
      await insertSnippet(snippet)
    }
  )

  // 注册导出单个代码片段命令
  const exportSnippet = vscode.commands.registerCommand('starcode-snippets.exportSnippet', async (item: any) => {
    if (!item?.snippet) {
      vscode.window.showErrorMessage('请选择要导出的代码片段')
      return
    }
    await importExportManager.exportSnippet(item.snippet)
  })

  // 注册导出所有代码片段命令
  const exportAll = vscode.commands.registerCommand('starcode-snippets.exportAll', async () => {
    await importExportManager.exportAllSnippets()
  })

  // 注册导入代码片段命令
  const importSnippets = vscode.commands.registerCommand('starcode-snippets.importSnippets', async () => {
    await importExportManager.importSnippets()
    refreshTreeView()
  })

  // 注册搜索命令
  const searchSnippets = vscode.commands.registerCommand('starcode-snippets.searchSnippets', async () => {
    await searchManager.startSearch()
  })



  // 注册清除搜索命令
  const clearSearch = vscode.commands.registerCommand('starcode-snippets.clearSearch', () => {
    searchManager.clearSearch()
  })

  // 注册切换搜索模式命令
  const toggleSearchMode = vscode.commands.registerCommand('starcode-snippets.toggleSearchMode', async () => {
    await searchManager.toggleSearchMode()
  })

  // 注册打开设置命令
  const openSettings = vscode.commands.registerCommand('starcode-snippets.openSettings', async () => {
    // console.log('openSettings 命令被调用')
    try {
      // 在打开设置前确保配置已注册
      ensureConfigurationRegistered()
      await waitForConfigurationRegistered(1000)
      
      SettingsWebviewProvider.createOrShow(context.extensionUri)
    } catch (error) {
      console.error('openSettings 命令执行失败:', error)
      vscode.window.showErrorMessage(`打开设置失败: ${error}`)
    }
  })

  // 注册查看历史记录命令
  const viewHistory = vscode.commands.registerCommand('starcode-snippets.viewHistory', async () => {
    // console.log('viewHistory 命令被调用')
    try {
      HistoryWebviewProvider.createOrShow(context.extensionUri)
    } catch (error) {
      console.error('viewHistory 命令执行失败:', error)
      vscode.window.showErrorMessage(`查看历史记录失败: ${error}`)
    }
  })

  // 注册数据查看器命令
  const openDataViewer = vscode.commands.registerCommand('starcode-snippets.openDataViewer', async () => {
    // console.log('openDataViewer 命令被调用')
    try {
      DataViewerWebviewProvider.createOrShow(context.extensionUri, context)
    } catch (error) {
      console.error('openDataViewer 命令执行失败:', error)
      vscode.window.showErrorMessage(`打开数据查看器失败: ${error}`)
    }
  })

  // 注册手动同步命令
  const manualSync = vscode.commands.registerCommand('starcode-snippets.manualSync', async () => {
    try {
      const cloudSyncManager = new CloudSyncManager(context, storageManager)

      if (!cloudSyncManager.isConfigured()) {
        const action = await vscode.window.showWarningMessage('云端同步未配置，是否打开设置？', '打开设置', '取消')
        if (action === '打开设置') {
          vscode.commands.executeCommand('starcode-snippets.openSettings')
        }
        return
      }

      // 使用进度条显示同步过程
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: '云端同步',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 0, message: '正在检查本地变更...' })

          const [snippets, directories] = await Promise.all([
            storageManager.getAllSnippets(),
            storageManager.getAllDirectories(),
          ])

          progress.report({ increment: 30, message: '正在与云端同步...' })

          const result = await cloudSyncManager.performSync(snippets, directories)

          progress.report({ increment: 100, message: '同步完成' })

          if (result.success) {
            // 检查是否有自动合并的数据需要导入到VSCode
            if (result.message.includes('自动合并')) {
              try {
                // 读取Git仓库中的最新数据
                const { snippets: latestSnippets, directories: latestDirectories } = await cloudSyncManager.readDataFromGitRepo()
                
                // 计算新增的数据（远程数据减去原本地数据）
                const originalSnippetIds = new Set(snippets.map(s => s.id || (s as any).fullPath))
                const originalDirIds = new Set(directories.map(d => d.id || (d as any).fullPath))
                
                const newSnippets = latestSnippets.filter(s => !originalSnippetIds.has(s.id || (s as any).fullPath))
                const newDirectories = latestDirectories.filter(d => !originalDirIds.has(d.id || (d as any).fullPath))
                
                if (newSnippets.length > 0 || newDirectories.length > 0) {
                  // 导入新数据到VSCode存储
                  for (const directory of newDirectories) {
                    await storageManager.createDirectory(directory)
                  }
                  
                  for (const snippet of newSnippets) {
                    await storageManager.saveSnippet(snippet)
                  }
                  
                  // 显示包含导入信息的成功消息
                  vscode.window.showInformationMessage(
                    `✅ ${result.message}\n\n🎉 已自动导入 ${newSnippets.length} 个代码片段和 ${newDirectories.length} 个目录到VSCode`
                  )
                } else {
                  vscode.window.showInformationMessage(`✅ ${result.message}`)
                }
              } catch (importError) {
                console.warn('自动导入合并数据失败:', importError)
                vscode.window.showInformationMessage(`✅ ${result.message}\n\n⚠️ 自动导入数据时出现问题，请手动刷新或使用"导入代码片段"功能`)
              }
            } else {
            vscode.window.showInformationMessage(`✅ 同步成功: ${result.message}`)
            }
            refreshTreeView()
          } else {
            vscode.window.showErrorMessage(`❌ 同步失败: ${result.message}`)
          }
        }
      )
    } catch (error) {
      console.error('手动同步失败:', error)
      vscode.window.showErrorMessage(`❌ 手动同步失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })

  // 注册同步状态查看命令
  const showSyncStatus = vscode.commands.registerCommand('starcode-snippets.showSyncStatus', async () => {
    try {
      const syncStatusManager = SyncStatusManager.getInstance(context)
      const report = syncStatusManager.generateSyncReport()

      // 创建临时文档显示报告
      const doc = await vscode.workspace.openTextDocument({
        content: report,
        language: 'markdown',
      })

      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: true,
      })
    } catch (error) {
      console.error('获取同步状态失败:', error)
      vscode.window.showErrorMessage(`获取同步状态失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })

  // 注册自动同步控制命令
  const startAutoSync = vscode.commands.registerCommand('starcode-snippets.startAutoSync', async () => {
    try {
      autoSyncManager.start()
      vscode.window.showInformationMessage('🔄 自动同步已启动')
    } catch (error) {
      console.error('启动自动同步失败:', error)
      vscode.window.showErrorMessage(`启动自动同步失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })

  const stopAutoSync = vscode.commands.registerCommand('starcode-snippets.stopAutoSync', async () => {
    try {
      autoSyncManager.stop()
      vscode.window.showInformationMessage('⏹️ 自动同步已停止')
    } catch (error) {
      console.error('停止自动同步失败:', error)
      vscode.window.showErrorMessage(`停止自动同步失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })

  const restartAutoSync = vscode.commands.registerCommand('starcode-snippets.restartAutoSync', async () => {
    try {
      autoSyncManager.restart()
      vscode.window.showInformationMessage('🔄 自动同步已重启')
    } catch (error) {
      console.error('重启自动同步失败:', error)
      vscode.window.showErrorMessage(`重启自动同步失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })

  // 添加调试命令：强制重置自动同步状态
  const forceResetAutoSync = vscode.commands.registerCommand('starcode-snippets.forceResetAutoSync', async () => {
    try {
      const confirmAction = await vscode.window.showWarningMessage(
        '⚠️ 这将强制停止自动同步并重置所有状态。\n\n用于解决同步异常或频繁触发的问题。\n\n确定要继续吗？',
        { modal: true },
        '确定重置',
        '取消'
      )

      if (confirmAction !== '确定重置') {
        vscode.window.showInformationMessage('操作已取消')
        return
      }

      // 强制停止并重置
      autoSyncManager.stop()
      
      // 清理同步状态
      const status = SettingsManager.getCloudSyncStatus()
      status.isSyncing = false
      status.lastError = null
      await SettingsManager.saveCloudSyncStatus(status)

      vscode.window.showInformationMessage('✅ 自动同步状态已重置。如需重新启动，请使用"启动自动同步"命令。')
    } catch (error) {
      console.error('重置自动同步状态失败:', error)
      vscode.window.showErrorMessage(`重置失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })

  const autoSyncStatus = vscode.commands.registerCommand('starcode-snippets.autoSyncStatus', async () => {
    try {
      const detailedStatus = autoSyncManager.getDetailedStatus()
      
      // 显示在输出面板中，这样可以显示更多信息
      const outputChannel = vscode.window.createOutputChannel('StarCode 自动同步状态')
      outputChannel.clear()
      outputChannel.appendLine(detailedStatus)
      outputChannel.show()
      
      // 同时显示简短的信息消息
      const status = autoSyncManager.getStatus()
      const config = SettingsManager.getCloudSyncConfig()
      const shortMessage = `自动同步: ${status.isRunning ? '运行中' : '已停止'} | 间隔: ${config.syncInterval || 'undefined'}分钟 | 详细信息已显示在输出面板`
      vscode.window.showInformationMessage(shortMessage, '查看输出面板').then(selection => {
        if (selection === '查看输出面板') {
          outputChannel.show()
        }
      })
    } catch (error) {
      console.error('获取自动同步状态失败:', error)
      vscode.window.showErrorMessage(`获取状态失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })

  // 注册重新初始化仓库命令
  const reinitializeRepository = vscode.commands.registerCommand('starcode-snippets.reinitializeRepository', async () => {
    try {
      // 显示警告信息
      const confirmAction = await vscode.window.showWarningMessage(
        '⚠️ 重新初始化仓库将删除本地Git历史记录。\n\n这个操作通常用于解决"refusing to merge unrelated histories"错误。\n\n操作过程：\n1. 备份当前数据\n2. 删除本地Git历史\n3. 重新从远程同步\n4. 如果失败则恢复备份\n\n确定要继续吗？',
        { modal: true },
        '确定重新初始化',
        '取消'
      )

      if (confirmAction !== '确定重新初始化') {
        vscode.window.showInformationMessage('操作已取消')
        return
      }

      // 显示进度
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: '重新初始化Git仓库',
        cancellable: false
      }, async (progress) => {
        progress.report({ increment: 0, message: '准备重新初始化...' })

        const cloudSyncManager = new CloudSyncManager(context, storageManager)
        
        progress.report({ increment: 30, message: '正在重新初始化仓库...' })
        const result = await cloudSyncManager.reinitializeRepository()
        
        progress.report({ increment: 100, message: '完成' })

        if (result.success) {
          vscode.window.showInformationMessage(`✅ ${result.message}`)
          
          // 刷新树视图
          setTimeout(() => {
            vscode.commands.executeCommand('starcode-snippets.refreshExplorer')
          }, 1000)
        } else {
          vscode.window.showErrorMessage(`❌ ${result.message}`)
        }
      })
    } catch (error) {
      console.error('重新初始化仓库失败:', error)
      vscode.window.showErrorMessage(`❌ 重新初始化仓库失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })

  // 注册从云端拉取数据命令
  const pullFromCloud = vscode.commands.registerCommand('starcode-snippets.pullFromCloud', async () => {
    try {
      const cloudSyncManager = new CloudSyncManager(context, storageManager)

      if (!cloudSyncManager.isConfigured()) {
        const action = await vscode.window.showWarningMessage('云端同步未配置，是否打开设置？', '打开设置', '取消')
        if (action === '打开设置') {
          vscode.commands.executeCommand('starcode-snippets.openSettings')
        }
        return
      }

      // 使用进度条显示拉取过程
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: '从云端拉取数据',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 0, message: '正在检查远程仓库...' })

          const result = await cloudSyncManager.pullFromCloud()

          progress.report({ increment: 100, message: '拉取完成' })

          if (result.success) {
            // 询问用户是否要导入拉取的数据
            if (result.data && (result.data.snippets.length > 0 || result.data.directories.length > 0)) {
              const importAction = await vscode.window.showInformationMessage(
                `✅ ${result.message}\n\n是否要将拉取的数据导入到VSCode？`,
                '导入数据',
                '稍后手动导入',
                '取消'
              )
              
              if (importAction === '导入数据') {
                                 try {
                   // 导入数据到VSCode存储
                   for (const directory of result.data.directories) {
                     await storageManager.createDirectory(directory)
                   }
                   
                   for (const snippet of result.data.snippets) {
                     await storageManager.saveSnippet(snippet)
                   }
                  
                  vscode.window.showInformationMessage(
                    `🎉 数据导入成功！\n已导入 ${result.data.snippets.length} 个代码片段和 ${result.data.directories.length} 个目录。`
                  )
                  refreshTreeView()
                } catch (importError) {
                  vscode.window.showErrorMessage(
                    `导入数据时出错: ${importError instanceof Error ? importError.message : '未知错误'}`
                  )
                }
              } else if (importAction === '稍后手动导入') {
                vscode.window.showInformationMessage(
                  '数据已保存到本地Git仓库，您可以稍后使用"导入代码片段"功能手动导入。'
                )
              }
            } else {
              vscode.window.showInformationMessage(`✅ ${result.message}`)
            }
          } else {
            vscode.window.showErrorMessage(`❌ 拉取失败: ${result.message}`)
          }
        }
      )
    } catch (error) {
      console.error('从云端拉取数据失败:', error)
      vscode.window.showErrorMessage(`❌ 从云端拉取数据失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })

  // 注册强制推送到云端命令
  const forcePushToCloud = vscode.commands.registerCommand('starcode-snippets.forcePushToCloud', async () => {
    try {
      const cloudSyncManager = new CloudSyncManager(context, storageManager)

      if (!cloudSyncManager.isConfigured()) {
        const action = await vscode.window.showWarningMessage('云端同步未配置，是否打开设置？', '打开设置', '取消')
        if (action === '打开设置') {
          vscode.commands.executeCommand('starcode-snippets.openSettings')
        }
        return
      }

      // 显示严重警告
      const confirmAction = await vscode.window.showWarningMessage(
        '⚠️ 危险操作警告！\n\n强制推送将会：\n• 完全覆盖远程仓库的所有数据\n• 删除远程仓库的提交历史\n• 此操作不可撤销！\n\n请确保您已经备份了重要数据。\n\n只有在确定远程数据已损坏或需要重置时才使用此功能。',
        { modal: true },
        '我确定要强制推送',
        '取消'
      )

      if (confirmAction !== '我确定要强制推送') {
        vscode.window.showInformationMessage('操作已取消')
        return
      }

      // 二次确认
      const finalConfirm = await vscode.window.showWarningMessage(
        '🚨 最后确认\n\n这是您最后一次机会取消操作！\n\n强制推送将不可逆转地覆盖远程仓库数据。\n\n确定继续？',
        { modal: true },
        '确定执行强制推送',
        '取消'
      )

      if (finalConfirm !== '确定执行强制推送') {
        vscode.window.showInformationMessage('操作已取消')
        return
      }

      // 使用进度条显示强制推送过程
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: '强制推送到云端',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 0, message: '正在准备本地数据...' })

          const [snippets, directories] = await Promise.all([
            storageManager.getAllSnippets(),
            storageManager.getAllDirectories(),
          ])

          progress.report({ increment: 30, message: '正在强制推送到云端...' })

          const result = await cloudSyncManager.forcePushToCloud(snippets, directories, true)

          progress.report({ increment: 100, message: '推送完成' })

          if (result.success) {
            vscode.window.showInformationMessage(`✅ 强制推送成功: ${result.message}`)
            refreshTreeView()
          } else {
            vscode.window.showErrorMessage(`❌ 强制推送失败: ${result.message}`)
          }
        }
      )
    } catch (error) {
      console.error('强制推送失败:', error)
      vscode.window.showErrorMessage(`❌ 强制推送失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })

  // 注册从Git仓库强制导入命令
  const forceImportFromGitRepo = vscode.commands.registerCommand('starcode-snippets.forceImportFromGitRepo', async () => {
    try {
      const cloudSyncManager = new CloudSyncManager(context, storageManager)

      if (!cloudSyncManager.isConfigured()) {
        const action = await vscode.window.showWarningMessage('云端同步未配置，是否打开设置？', '打开设置', '取消')
        if (action === '打开设置') {
          vscode.commands.executeCommand('starcode-snippets.openSettings')
        }
        return
      }

      // 显示警告信息
      const confirmAction = await vscode.window.showInformationMessage(
        '🔄 从Git仓库强制导入数据\n\n此操作将：\n• 读取本地Git仓库中的最新数据\n• 更新VSCode中不一致的代码片段\n• 导入缺失的代码片段和目录\n\n这通常用于修复同步后VSCode与Git仓库数据不一致的问题。\n\n确定要继续吗？',
        { modal: false },
        '确定导入',
        '取消'
      )

      if (confirmAction !== '确定导入') {
        vscode.window.showInformationMessage('操作已取消')
        return
      }

      // 使用进度条显示导入过程
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: '从Git仓库导入数据',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 0, message: '正在读取Git仓库数据...' })

          const result = await cloudSyncManager.forceImportFromGitRepo()

          progress.report({ increment: 100, message: '导入完成' })

          if (result.success) {
            vscode.window.showInformationMessage(`✅ ${result.message}`)
            refreshTreeView()
          } else {
            vscode.window.showErrorMessage(`❌ 导入失败: ${result.message}`)
          }
        }
      )
    } catch (error) {
      console.error('从Git仓库强制导入失败:', error)
      vscode.window.showErrorMessage(`❌ 从Git仓库强制导入失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })

  // 返回所有注册的命令
  return [
    refreshExplorer,
    saveToLibrary,
    previewSnippet,
    renameItem,
    createDirectory,
    deleteItem,
    appendCode,
    editSnippet,
    moveToDirectory,
    insertSnippetCommand,
    createSnippetInDirectory,
    createSnippet,
    exportSnippet,
    exportAll,
    importSnippets,
    searchSnippets,
    clearSearch,
    toggleSearchMode,
    openSettings,
    viewHistory,
    openDataViewer,
    manualSync,
    showSyncStatus,
    startAutoSync,
    stopAutoSync,
    restartAutoSync,
    forceResetAutoSync,
    autoSyncStatus,
    reinitializeRepository,
    pullFromCloud,
    forcePushToCloud,
    forceImportFromGitRepo,
  ]
}

export function deactivate(): void {
  // 清理工作
}

/**
 * 虚拟文档内容提供程序
 */
class TextDocumentContentProvider implements vscode.TextDocumentContentProvider {
  public static instance: TextDocumentContentProvider
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>()
  private contents = new Map<string, string>()
  private languages = new Map<string, string>()
  private maxCachedEntries = 50
  private openPreviewsBySnippetId = new Map<string, vscode.Uri>()

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    TextDocumentContentProvider.instance = new TextDocumentContentProvider()

    const registration = vscode.workspace.registerTextDocumentContentProvider(
      'starcode-preview',
      TextDocumentContentProvider.instance
    )

    const disposable = vscode.window.onDidChangeVisibleTextEditors((editors) => {
      TextDocumentContentProvider.instance.cleanupUnusedContent(editors)
    })

    context.subscriptions.push(registration, disposable)
    return registration
  }

  private cleanupUnusedContent(editors: readonly vscode.TextEditor[]) {
    const openUris = new Set<string>(editors.map((editor) => editor.document.uri.toString()))

    const unusedUris: string[] = []
    for (const uri of this.contents.keys()) {
      if (!openUris.has(uri)) {
        unusedUris.push(uri)
      }
    }

    for (const uri of unusedUris) {
      this.contents.delete(uri)
      this.languages.delete(uri)

      for (const [snippetId, previewUri] of this.openPreviewsBySnippetId.entries()) {
        if (previewUri.toString() === uri) {
          this.openPreviewsBySnippetId.delete(snippetId)
          break
        }
      }
    }

    if (this.contents.size > this.maxCachedEntries) {
      const entriesToDelete = this.contents.size - this.maxCachedEntries
      const uris = [...this.contents.keys()].slice(0, entriesToDelete)
      for (const uri of uris) {
        this.contents.delete(uri)
        this.languages.delete(uri)
      }
    }
  }

  public getOpenPreviewUri(snippetId: string): vscode.Uri | undefined {
    return this.openPreviewsBySnippetId.get(snippetId)
  }

  public setOpenPreview(snippetId: string, uri: vscode.Uri | undefined): void {
    if (uri) {
      this.openPreviewsBySnippetId.set(snippetId, uri)
    } else {
      this.openPreviewsBySnippetId.delete(snippetId)
    }
  }

  public get onDidChange(): vscode.Event<vscode.Uri> {
    return this._onDidChange.event
  }

  public update(uri: vscode.Uri, content: string, language?: string): void {
    this.contents.set(uri.toString(), content)
    if (language) {
      this.languages.set(uri.toString(), language)
    }
    this._onDidChange.fire(uri)
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) || ''
  }
}
