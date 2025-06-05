import * as vscode from 'vscode'
import { StorageContext } from '../utils/storageContext'

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
        `迁移状态检查报告:`,
        `- 迁移完成标记: ${hasCompletedMigration}`,
        `- 当前存储版本: ${currentVersion}`,
        `- V1数据: ${v1Snippets.length}个代码片段, ${v1Directories.length}个目录`,
        `- V2数据: ${v2Snippets.length}个代码片段, ${v2Directories.length}个目录`,
        `- 旧格式数据: ${oldSnippets.length}个代码片段, ${oldDirectories.length}个目录`,
        ``,
        `数据通过StorageContext获取:`,
        `- 代码片段: ${(await storageContext.getAllSnippets()).length}个`,
        `- 目录: ${(await storageContext.getAllDirectories()).length}个`,
      ].join('\n')

      console.log(report)
      vscode.window.showInformationMessage('测试报告已输出到控制台')
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
      const snippets = await storageContext.getAllSnippets()
      const directories = await storageContext.getAllDirectories()
      const currentVersion = storageContext.getCurrentStorageVersion()
      
      const report = [`删除功能ID匹配测试 (${currentVersion}格式):`]
      
      // 测试代码片段ID
      report.push(`\n代码片段 (${snippets.length}个):`)
      snippets.slice(0, 3).forEach((snippet: any, index: number) => {
        if (currentVersion === 'v2') {
          const generatedId = require('../utils/pathBasedManager').PathBasedManager.generateIdFromPath(snippet.fullPath)
          report.push(`  ${index + 1}. "${snippet.name}"`)
          report.push(`     路径: ${snippet.fullPath}`)
          report.push(`     生成ID: ${generatedId}`)
          report.push(`     原始ID: ${snippet.id || '无'}`)
        } else {
          report.push(`  ${index + 1}. "${snippet.name}" (ID: ${snippet.id})`)
        }
      })
      
      // 测试目录ID
      report.push(`\n目录 (${directories.length}个):`)
      directories.slice(0, 3).forEach((directory: any, index: number) => {
        if (currentVersion === 'v2') {
          const generatedId = require('../utils/pathBasedManager').PathBasedManager.generateIdFromPath(directory.fullPath)
          report.push(`  ${index + 1}. "${directory.name}"`)
          report.push(`     路径: ${directory.fullPath}`)
          report.push(`     生成ID: ${generatedId}`)
          report.push(`     原始ID: ${directory.id || '无'}`)
        } else {
          report.push(`  ${index + 1}. "${directory.name}" (ID: ${directory.id})`)
        }
      })
      
      const reportText = report.join('\n')
      console.log(reportText)
      vscode.window.showInformationMessage('删除ID匹配测试报告已输出到控制台')
    } catch (error) {
      console.error('测试失败:', error)
      vscode.window.showErrorMessage(`测试失败: ${error}`)
    }
  })
  commands.push(testDeleteIdMatching)

  // 测试移动功能
  const testMoveFunction = vscode.commands.registerCommand('starcode-snippets.testMoveFunction', async () => {
    try {
      const snippets = await storageContext.getAllSnippets()
      const directories = await storageContext.getAllDirectories()
      const currentVersion = storageContext.getCurrentStorageVersion()
      
      const report = [`移动功能测试 (${currentVersion}格式):`]
      
      if (snippets.length === 0) {
        report.push('没有代码片段可供测试')
      } else {
        const firstSnippet = snippets[0] as any
        report.push(`\n测试代码片段: "${firstSnippet.name}"`)
        
        if (currentVersion === 'v2') {
          report.push(`当前路径: ${firstSnippet.fullPath}`)
          
          // 测试移动到不同目录的路径生成
          const testPaths = directories.slice(0, 2).map((dir: any) => {
            const newPath = dir.fullPath === '/' 
              ? `/${firstSnippet.name}` 
              : `${dir.fullPath}${firstSnippet.name}`
            return `移动到 "${dir.name}": ${newPath}`
          })
          
          if (testPaths.length > 0) {
            report.push('可能的移动目标:')
            testPaths.forEach(path => report.push(`  ${path}`))
          }
        } else {
          report.push(`当前parentId: ${firstSnippet.parentId}`)
          report.push(`当前ID: ${firstSnippet.id}`)
        }
      }
      
      const reportText = report.join('\n')
      console.log(reportText)
      vscode.window.showInformationMessage('移动功能测试报告已输出到控制台')
    } catch (error) {
      console.error('测试失败:', error)
      vscode.window.showErrorMessage(`测试失败: ${error}`)
    }
  })
  commands.push(testMoveFunction)

  return commands
} 