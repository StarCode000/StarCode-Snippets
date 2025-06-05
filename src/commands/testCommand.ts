import * as vscode from 'vscode'
import { StorageContext } from '../utils/storageContext'
import { PathUtils } from '../utils/pathUtils'
import { SettingsManager } from '../utils/settingsManager'

/**
 * 注册测试相关命令
 */
export function registerTestCommands(
  context: vscode.ExtensionContext,
  storageContext: StorageContext
): vscode.Disposable[] {
  const commands: vscode.Disposable[] = []

  // 测试迁移状态检查
  const testMigrationStatus = vscode.commands.registerCommand('starcode-snippets.testMigrationStatus', async () => {
    try {
      // 创建输出通道
      const outputChannel = vscode.window.createOutputChannel('StarCode Snippets - 迁移状态')
      
      const hasCompletedMigration = context.globalState.get('migratedToV2', false)
      const currentVersion = storageContext.getCurrentStorageVersion()
      
      // 检查各种数据源
      const v1Snippets = context.globalState.get('snippets.v1', [])
      const v1Directories = context.globalState.get('directories.v1', [])
      const v2Snippets = context.globalState.get('snippets.v2', [])
      const v2Directories = context.globalState.get('directories.v2', [])
      const oldSnippets = context.globalState.get('snippets', [])
      const oldDirectories = context.globalState.get('directories', [])
      
      const report = [
        `📊 迁移状态检查报告`,
        `===================`,
        ``,
        `🏷️ 迁移标记:`,
        `- 迁移完成标记: ${hasCompletedMigration}`,
        `- 当前存储版本: ${currentVersion}`,
        ``,
        `📁 原始数据统计:`,
        `- V1数据: ${v1Snippets.length}个代码片段, ${v1Directories.length}个目录`,
        `- V2数据: ${v2Snippets.length}个代码片段, ${v2Directories.length}个目录`,
        `- 旧格式数据: ${oldSnippets.length}个代码片段, ${oldDirectories.length}个目录`,
        ``,
        `🔄 StorageContext获取结果:`,
        `- 代码片段: ${(await storageContext.getAllSnippets()).length}个`,
        `- 目录: ${(await storageContext.getAllDirectories()).length}个`,
        ``,
        `📋 详细说明:`,
        `- V1数据: 基于ID和parentID的树状结构（兼容旧版本）`,
        `- V2数据: 基于路径的扁平结构（当前推荐格式）`,
        `- 旧格式数据: 早期版本的存储格式`,
        `- StorageContext: 通过存储上下文获取的当前有效数据`,
      ].join('\n')

      // 输出到通道
      outputChannel.clear()
      outputChannel.appendLine(report)
      outputChannel.show(true)
      
      // 同时输出到控制台
      console.log(report)
      
      // 显示用户友好的摘要信息
      const summaryMessage = [
        `📊 迁移状态检查完成`,
        ``,
        `当前版本: ${currentVersion}`,
        `迁移状态: ${hasCompletedMigration ? '✅ 已完成' : '❌ 未完成'}`,
        ``,
        `详细报告已显示在输出面板中`
      ].join('\n')
      
      vscode.window.showInformationMessage(summaryMessage, '查看详细报告').then(selection => {
        if (selection === '查看详细报告') {
          outputChannel.show()
        }
      })
    } catch (error) {
      console.error('测试失败:', error)
      vscode.window.showErrorMessage(`测试失败: ${error}`)
    }
  })
  commands.push(testMigrationStatus)

  // 手动触发迁移标记重置（用于测试）
  const resetMigrationFlag = vscode.commands.registerCommand('starcode-snippets.resetMigrationFlag', async () => {
    const confirm = await vscode.window.showWarningMessage(
      '确定要重置迁移标记吗？这将导致下次启动时重新检查迁移。',
      { modal: true },
      '确定'
    )
    
    if (confirm === '确定') {
      await context.globalState.update('migratedToV2', false)
      vscode.window.showInformationMessage('迁移标记已重置，请重启插件以测试迁移逻辑')
    }
  })
  commands.push(resetMigrationFlag)

  // 测试删除功能的ID匹配
  const testDeleteIdMatching = vscode.commands.registerCommand('starcode-snippets.testDeleteIdMatching', async () => {
    try {
      // 创建输出通道
      const outputChannel = vscode.window.createOutputChannel('StarCode Snippets - ID匹配测试')
      
      const snippets = await storageContext.getAllSnippets()
      const directories = await storageContext.getAllDirectories()
      const currentVersion = storageContext.getCurrentStorageVersion()
      
      const report = [
        `🔍 删除功能ID匹配测试报告`,
        `========================`,
        ``,
        `📋 测试信息:`,
        `- 存储版本: ${currentVersion}`,
        `- 代码片段总数: ${snippets.length}个`,
        `- 目录总数: ${directories.length}个`,
        ``,
        `🧩 代码片段ID测试 (前3个):`
      ]
      
      // 测试代码片段ID
      if (snippets.length === 0) {
        report.push(`  ⚠️ 没有代码片段可供测试`)
      } else {
        snippets.slice(0, 3).forEach((snippet: any, index: number) => {
          if (currentVersion === 'v2') {
            const generatedId = require('../utils/pathBasedManager').PathBasedManager.generateIdFromPath(snippet.fullPath)
            report.push(`  ${index + 1}. "${snippet.name}"`)
            report.push(`     📂 路径: ${snippet.fullPath}`)
            report.push(`     🔑 生成ID: ${generatedId}`)
            report.push(`     🏷️ 原始ID: ${snippet.id || '无'}`)
            report.push(``)
          } else {
            report.push(`  ${index + 1}. "${snippet.name}" (ID: ${snippet.id})`)
          }
        })
      }
      
      // 测试目录ID
      report.push(`📁 目录ID测试 (前3个):`)
      if (directories.length === 0) {
        report.push(`  ⚠️ 没有目录可供测试`)
      } else {
        directories.slice(0, 3).forEach((directory: any, index: number) => {
          if (currentVersion === 'v2') {
            const generatedId = require('../utils/pathBasedManager').PathBasedManager.generateIdFromPath(directory.fullPath)
            report.push(`  ${index + 1}. "${directory.name}"`)
            report.push(`     📂 路径: ${directory.fullPath}`)
            report.push(`     🔑 生成ID: ${generatedId}`)
            report.push(`     🏷️ 原始ID: ${directory.id || '无'}`)
            report.push(``)
          } else {
            report.push(`  ${index + 1}. "${directory.name}" (ID: ${directory.id})`)
          }
        })
      }
      
      report.push(`📝 测试说明:`)
      if (currentVersion === 'v2') {
        report.push(`- V2格式使用路径生成唯一ID，确保删除操作的准确性`)
        report.push(`- 生成ID基于完整路径的哈希值`)
        report.push(`- 原始ID可能为空或不匹配，这是正常的`)
      } else {
        report.push(`- V1格式使用固定ID，通过ID直接匹配进行删除`)
        report.push(`- 每个项目都有唯一的固定ID`)
      }
      
      const reportText = report.join('\n')
      
      // 输出到通道
      outputChannel.clear()
      outputChannel.appendLine(reportText)
      outputChannel.show(true)
      
      // 同时输出到控制台
      console.log(reportText)
      
      // 显示摘要信息
      const summaryMessage = [
        `🔍 ID匹配测试完成`,
        ``,
        `存储版本: ${currentVersion}`,
        `测试项目: ${snippets.length + directories.length}个`,
        ``,
        `详细报告已显示在输出面板中`
      ].join('\n')
      
      vscode.window.showInformationMessage(summaryMessage, '查看详细报告').then(selection => {
        if (selection === '查看详细报告') {
          outputChannel.show()
        }
      })
    } catch (error) {
      console.error('测试失败:', error)
      vscode.window.showErrorMessage(`测试失败: ${error}`)
    }
  })
  commands.push(testDeleteIdMatching)

  // 测试移动功能
  const testMoveFunction = vscode.commands.registerCommand('starcode-snippets.testMoveFunction', async () => {
    try {
      // 创建输出通道
      const outputChannel = vscode.window.createOutputChannel('StarCode Snippets - 移动功能测试')
      
      const snippets = await storageContext.getAllSnippets()
      const directories = await storageContext.getAllDirectories()
      const currentVersion = storageContext.getCurrentStorageVersion()
      
      const report = [
        `🔄 移动功能测试报告`,
        `==================`,
        ``,
        `📋 测试环境:`,
        `- 存储版本: ${currentVersion}`,
        `- 代码片段总数: ${snippets.length}个`,
        `- 目录总数: ${directories.length}个`,
        ``
      ]
      
      if (snippets.length === 0) {
        report.push(`⚠️ 没有代码片段可供测试`)
        report.push(``)
        report.push(`建议: 先创建一些代码片段，然后重新运行此测试`)
      } else {
        const firstSnippet = snippets[0] as any
        report.push(`🎯 测试目标代码片段: "${firstSnippet.name}"`)
        
        if (currentVersion === 'v2') {
          report.push(`📂 当前完整路径: ${firstSnippet.fullPath}`)
          report.push(``)
          
          // 测试移动到不同目录的路径生成
          if (directories.length === 0) {
            report.push(`📁 可移动目标: 无可用目录`)
            report.push(`  提示: 创建一些目录来测试移动功能`)
          } else {
            report.push(`📁 可移动目标 (前2个):`)
            const testPaths = directories.slice(0, 2).map((dir: any, index: number) => {
              const newPath = dir.fullPath === '/' 
                ? `/${firstSnippet.name}` 
                : `${dir.fullPath}${firstSnippet.name}`
              return {
                dirName: dir.name,
                dirPath: dir.fullPath,
                newPath: newPath,
                index: index + 1
              }
            })
            
            testPaths.forEach(({ dirName, dirPath, newPath, index }) => {
              report.push(`  ${index}. 移动到目录 "${dirName}":`)
              report.push(`     📂 目录路径: ${dirPath}`)
              report.push(`     ➡️ 新路径: ${newPath}`)
              report.push(``)
            })
          }
          
          report.push(`🔧 V2移动机制:`)
          report.push(`- 基于路径的移动操作`)
          report.push(`- 重新生成完整路径`)
          report.push(`- 自动更新路径相关的ID`)
        } else {
          report.push(`🏷️ 当前parentId: ${firstSnippet.parentId}`)
          report.push(`🔑 当前ID: ${firstSnippet.id}`)
          report.push(``)
          
          if (directories.length === 0) {
            report.push(`📁 可移动目标: 无可用目录`)
          } else {
            report.push(`📁 可移动目标 (前2个):`)
            directories.slice(0, 2).forEach((dir: any, index: number) => {
              report.push(`  ${index + 1}. 移动到目录 "${dir.name}" (ID: ${dir.id})`)
              report.push(`     ➡️ 新parentId: ${dir.id}`)
              report.push(``)
            })
          }
          
          report.push(`🔧 V1移动机制:`)
          report.push(`- 基于ID的父子关系`)
          report.push(`- 修改parentId字段`)
          report.push(`- 保持原有ID不变`)
        }
      }
      
      const reportText = report.join('\n')
      
      // 输出到通道
      outputChannel.clear()
      outputChannel.appendLine(reportText)
      outputChannel.show(true)
      
      // 同时输出到控制台
      console.log(reportText)
      
      // 显示摘要信息
      const summaryMessage = [
        `🔄 移动功能测试完成`,
        ``,
        `存储版本: ${currentVersion}`,
        `测试数据: ${snippets.length}个代码片段, ${directories.length}个目录`,
        ``,
        `详细报告已显示在输出面板中`
      ].join('\n')
      
      vscode.window.showInformationMessage(summaryMessage, '查看详细报告').then(selection => {
        if (selection === '查看详细报告') {
          outputChannel.show()
        }
      })
    } catch (error) {
      console.error('测试失败:', error)
      vscode.window.showErrorMessage(`测试失败: ${error}`)
    }
  })
  commands.push(testMoveFunction)

  // 测试编辑器检测功能
  const testEditorDetection = vscode.commands.registerCommand('starcode-snippets.testEditorDetection', async () => {
    try {
      // 创建或获取输出通道
      const outputChannel = vscode.window.createOutputChannel('StarCode Snippets - 编辑器检测')
      
      // 基础编辑器信息检测
      const appName = vscode.env.appName
      const appRoot = vscode.env.appRoot
      const appHost = vscode.env.appHost
      const version = vscode.version
      
      // 全局存储路径检测
      const globalStoragePath = context.globalStorageUri.fsPath
      const workspaceStoragePath = context.storageUri?.fsPath || '未设置工作区'
      
      // 扩展路径信息
      const extensionPath = context.extensionPath
      const extensionUri = context.extensionUri.toString()
      
      // 编辑器类型检测函数
      function detectEditor(): { 
        name: 'vscode' | 'cursor' | 'unknown',
        displayName: string,
        confidence: 'high' | 'medium' | 'low'
      } {
        const appNameLower = appName.toLowerCase()
        const appRootLower = appRoot.toLowerCase()
        const globalStorageLower = globalStoragePath.toLowerCase()
        
        // 优先级1: appName检测
        if (appNameLower.includes('cursor')) {
          return { name: 'cursor', displayName: 'Cursor', confidence: 'high' }
        } else if (appNameLower.includes('visual studio code') || appNameLower.includes('vscode')) {
          return { name: 'vscode', displayName: 'Visual Studio Code', confidence: 'high' }
        }
        
        // 优先级2: appRoot路径检测
        if (appRootLower.includes('cursor')) {
          return { name: 'cursor', displayName: 'Cursor', confidence: 'medium' }
        } else if (appRootLower.includes('visual studio code') || appRootLower.includes('vscode') || appRootLower.includes('code')) {
          return { name: 'vscode', displayName: 'Visual Studio Code', confidence: 'medium' }
        }
        
        // 优先级3: globalStorage路径检测
        if (globalStorageLower.includes('cursor')) {
          return { name: 'cursor', displayName: 'Cursor', confidence: 'medium' }
        } else if (globalStorageLower.includes('code') && !globalStorageLower.includes('cursor')) {
          return { name: 'vscode', displayName: 'Visual Studio Code', confidence: 'medium' }
        }
        
        return { name: 'unknown', displayName: appName || 'Unknown Editor', confidence: 'low' }
      }
      
      const editorInfo = detectEditor()
      
      // 生成潜在的编辑器特定路径
      function generateEditorSpecificPaths(): string[] {
        const basePaths = [
          process.platform === 'win32' ? 
            `${require('os').homedir()}\\Documents\\StarCode-Snippets` :
            `${require('os').homedir()}/Documents/StarCode-Snippets`,
          process.platform === 'linux' ? 
            `${require('os').homedir()}/.local/share/starcode-snippets` :
            undefined
        ].filter(Boolean) as string[]
        
        const paths: string[] = []
        
        basePaths.forEach(basePath => {
          paths.push(`${basePath} (通用默认路径)`)
          paths.push(`${basePath}-VSCode (VSCode特定)`)
          paths.push(`${basePath}-Cursor (Cursor特定)`)
          paths.push(`${basePath}/vscode (VSCode子目录)`)
          paths.push(`${basePath}/cursor (Cursor子目录)`)
        })
        
        return paths
      }
      
      const potentialPaths = generateEditorSpecificPaths()
      
      // 构建完整的检测报告
      const report = [
        `🔍 编辑器检测测试报告`,
        `====================`,
        ``,
        `📱 基础信息:`,
        `  应用名称: ${appName}`,
        `  应用版本: ${version}`,
        `  应用主机: ${appHost}`,
        `  应用根路径: ${appRoot}`,
        ``,
        `📁 存储路径:`,
        `  全局存储: ${globalStoragePath}`,
        `  工作区存储: ${workspaceStoragePath}`,
        `  扩展路径: ${extensionPath}`,
        `  扩展URI: ${extensionUri}`,
        ``,
        `🎯 编辑器检测结果:`,
        `  检测类型: ${editorInfo.name}`,
        `  显示名称: ${editorInfo.displayName}`,
        `  置信度: ${editorInfo.confidence}`,
        ``,
        `💡 建议的编辑器特定路径:`,
        ...potentialPaths.map((path, index) => `  ${index + 1}. ${path}`),
        ``,
        `🔧 平台信息:`,
        `  操作系统: ${process.platform}`,
        `  架构: ${process.arch}`,
        `  用户主目录: ${require('os').homedir()}`,
        ``,
        `📊 路径分析:`,
        `  从globalStorage推断编辑器: ${globalStoragePath.includes('Cursor') ? 'Cursor' : globalStoragePath.includes('Code') ? 'VSCode' : '未知'}`,
        `  从appRoot推断编辑器: ${appRoot.includes('Cursor') ? 'Cursor' : appRoot.includes('Code') ? 'VSCode' : '未知'}`,
        ``,
        `⚡ 推荐方案:`,
        editorInfo.name === 'cursor' ? 
          `  使用Cursor特定路径: StarCode-Snippets-Cursor` :
          editorInfo.name === 'vscode' ?
            `  使用VSCode特定路径: StarCode-Snippets-VSCode` :
            `  使用通用路径: StarCode-Snippets`,
      ].join('\n')

      // 清空并写入报告到输出通道
      outputChannel.clear()
      outputChannel.appendLine(report)
      outputChannel.show(true) // 显示输出通道
      
      // 同时也输出到控制台
      console.log(report)
      
      // 显示简化的用户友好信息
      const userMessage = [
        `🎯 编辑器检测完成！`,
        ``,
        `当前编辑器: ${editorInfo.displayName}`,
        `检测置信度: ${editorInfo.confidence === 'high' ? '高' : editorInfo.confidence === 'medium' ? '中' : '低'}`,
        ``,
        `全局存储位置:`,
        `${globalStoragePath}`,
        ``,
        `详细报告已显示在输出面板中`,
        `（视图 → 输出 → 选择 "StarCode Snippets - 编辑器检测"）`
      ].join('\n')
      
      vscode.window.showInformationMessage(userMessage, '查看详细报告').then(selection => {
        if (selection === '查看详细报告') {
          outputChannel.show()
        }
      })
      
    } catch (error) {
      const errorMessage = `编辑器检测测试失败: ${error instanceof Error ? error.message : '未知错误'}`
      console.error('编辑器检测测试失败:', error)
      vscode.window.showErrorMessage(errorMessage)
    }
  })
  commands.push(testEditorDetection)

  // 测试编辑器特定路径功能
  const testEditorSpecificPaths = vscode.commands.registerCommand('starcode-snippets.testEditorSpecificPaths', async () => {
    try {
      // 创建专用输出通道
      const outputChannel = vscode.window.createOutputChannel('StarCode Snippets - 编辑器路径测试')
      outputChannel.show()
      
      // 获取扩展上下文
      const extensionContext = context
      
      outputChannel.appendLine('🔍 编辑器特定路径测试报告')
      outputChannel.appendLine('========================')
      outputChannel.appendLine('')
      
      // 基础编辑器检测
      const editorType = PathUtils.detectEditorType(extensionContext)
      const globalStoragePath = extensionContext.globalStorageUri.fsPath
      
      outputChannel.appendLine('📱 编辑器信息:')
      outputChannel.appendLine(`  检测到的编辑器: ${editorType}`)
      outputChannel.appendLine(`  应用名称: ${vscode.env.appName}`)
      outputChannel.appendLine(`  全局存储路径: ${globalStoragePath}`)
      outputChannel.appendLine('')
      
      // 测试不同平台的编辑器特定路径
      outputChannel.appendLine('🗂️ 编辑器特定路径:')
      const platforms: ('github' | 'gitlab' | 'gitee')[] = ['github', 'gitlab', 'gitee']
      
      platforms.forEach(platform => {
        const editorSpecificPath = PathUtils.getEditorSpecificRepoPath(platform, extensionContext)
        const pathDescription = PathUtils.getEditorSpecificPathDescription(platform, extensionContext)
        
        outputChannel.appendLine(`  ${platform.toUpperCase()}:`)
        outputChannel.appendLine(`    路径: ${editorSpecificPath}`)
        outputChannel.appendLine(`    描述: ${pathDescription}`)
        outputChannel.appendLine('')
      })
      
      // 测试通用路径
      const defaultPath = PathUtils.getEditorSpecificRepoPath(undefined, extensionContext)
      outputChannel.appendLine(`  默认通用路径: ${defaultPath}`)
      outputChannel.appendLine('')
      
      // 与传统路径对比
      outputChannel.appendLine('🔄 与传统路径对比:')
      platforms.forEach(platform => {
        const editorPath = PathUtils.getEditorSpecificRepoPath(platform, extensionContext)
        const traditionalPath = PathUtils.getDefaultLocalRepoPathForPlatform(platform)
        
        outputChannel.appendLine(`  ${platform.toUpperCase()}:`)
        outputChannel.appendLine(`    编辑器特定: ${editorPath}`)
        outputChannel.appendLine(`    传统路径: ${traditionalPath}`)
        outputChannel.appendLine(`    路径隔离: ${editorPath !== traditionalPath ? '✅ 已隔离' : '❌ 未隔离'}`)
        outputChannel.appendLine('')
      })
      
      // 当前配置状态
      outputChannel.appendLine('⚙️ 当前配置状态:')
      const effectivePath = SettingsManager.getEffectiveLocalPath()
      const pathDescription = SettingsManager.getLocalPathDescription()
      const isUsingDefault = SettingsManager.isUsingDefaultPath()
      
      outputChannel.appendLine(`  当前有效路径: ${effectivePath}`)
      outputChannel.appendLine(`  路径描述: ${pathDescription}`)
      outputChannel.appendLine(`  使用默认路径: ${isUsingDefault ? '是' : '否'}`)
      outputChannel.appendLine('')
      
      // 多平台配置检查
      const multiConfig = SettingsManager.getMultiPlatformCloudSyncConfig()
      const activePlatform = SettingsManager.getActivePlatformConfig()
      
      outputChannel.appendLine('🌐 多平台配置状态:')
      outputChannel.appendLine(`  配置的平台数量: ${multiConfig.platforms.length}`)
      outputChannel.appendLine(`  激活的平台: ${activePlatform ? `${activePlatform.provider} (${activePlatform.name})` : '无'}`)
      
      if (multiConfig.platforms.length > 0) {
        outputChannel.appendLine('  各平台路径解析:')
        multiConfig.platforms.forEach(platform => {
          const resolvedPath = PathUtils.resolveDefaultPathToken(
            platform.localPath || '', 
            platform.provider, 
            extensionContext
          )
          outputChannel.appendLine(`    ${platform.provider} (${platform.name}): ${resolvedPath}`)
        })
      }
      outputChannel.appendLine('')
      
      // 优势总结
      outputChannel.appendLine('✨ 编辑器特定路径的优势:')
      outputChannel.appendLine('  • 自动编辑器隔离：VSCode 和 Cursor 使用完全独立的存储目录')
      outputChannel.appendLine('  • 避免路径冲突：无需用户手动选择路径，系统自动管理')
      outputChannel.appendLine('  • 跨平台兼容：基于 VSCode globalStorageUri，天然支持不同操作系统')
      outputChannel.appendLine('  • 简化用户体验：用户无需理解复杂的路径配置')
      outputChannel.appendLine('  • 提高数据安全：避免意外的数据覆盖和冲突')
      outputChannel.appendLine('')
      outputChannel.appendLine('测试完成！查看上方详细信息了解编辑器特定路径的工作方式。')
      
      // 显示简化的用户消息
      vscode.window.showInformationMessage(
        `编辑器特定路径测试完成！\n\n当前编辑器: ${editorType}\n配置的平台: ${multiConfig.platforms.length} 个\n\n详细信息请查看输出面板`,
        '查看详细报告'
      ).then((selection) => {
        if (selection === '查看详细报告') {
          outputChannel.show()
        }
      })
      
    } catch (error) {
      console.error('编辑器特定路径测试失败:', error)
      vscode.window.showErrorMessage(`编辑器特定路径测试失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })
  commands.push(testEditorSpecificPaths)

  return commands
} 