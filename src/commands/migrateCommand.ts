import * as vscode from 'vscode'
import { StorageContext } from '../utils/storageContext'

/**
 * 注册迁移命令
 * @param context vscode扩展上下文
 * @param storageContext 存储上下文
 */
export function registerMigrateCommands(
  context: vscode.ExtensionContext,
  storageContext: StorageContext
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = []

  // 注册迁移到V2的命令
  const migrateToV2Command = vscode.commands.registerCommand('starcode-snippets.migrateToV2', async () => {
    try {
      // 显示确认对话框
      const result = await vscode.window.showInformationMessage(
        '确定要将数据从V1(基于ID)迁移到V2(基于路径)格式吗？此操作将保留原有数据。',
        { modal: true },
        '确定',
        '取消'
      )

      if (result === '确定') {
        // 显示进度
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: '正在迁移数据...',
            cancellable: false,
          },
          async (progress) => {
            // 执行迁移
            progress.report({ increment: 0, message: '开始迁移...' })

            // 先检查V1数据是否为空
            const v1Snippets = await storageContext.getAllSnippets()
            const v1Directories = await storageContext.getAllDirectories()

            if (v1Snippets.length === 0 && v1Directories.length === 0) {
              progress.report({ increment: 20, message: '检查旧版本数据...' })

              // 尝试从旧版本globalState获取数据
              const oldSnippets = context.globalState.get('snippets', [])
              const oldDirectories = context.globalState.get('directories', [])

              if (oldSnippets.length > 0 || oldDirectories.length > 0) {
                progress.report({
                  increment: 30,
                  message: `发现${oldSnippets.length}个代码片段和${oldDirectories.length}个目录，正在导入...`,
                })

                // 导入旧数据到V1
                for (const dir of oldDirectories) {
                  await storageContext.createDirectory(dir)
                }

                for (const snippet of oldSnippets) {
                  await storageContext.saveSnippet(snippet)
                }

                progress.report({ increment: 50, message: '旧数据导入完成，开始转换到V2...' })
              } else {
                progress.report({ increment: 30, message: '未找到旧版本数据，继续执行空迁移...' })
              }
            } else {
              progress.report({
                increment: 30,
                message: `找到${v1Snippets.length}个代码片段和${v1Directories.length}个目录，开始转换...`,
              })
            }

            // 执行迁移到V2，删除V1数据
            await storageContext.convertToV2(true, true, true)

            progress.report({ increment: 80, message: '更新设置...' })

            // 不使用配置存储版本信息，StorageContext已经处理了版本
            // 使用globalState备份一下版本信息
            context.globalState.update('migratedToV2', true)

            // 清除缓存，确保刷新时能获取最新数据
            await storageContext.clearCache()

            progress.report({ increment: 100, message: '迁移完成！' })
          }
        )

        // 显示成功消息
        const reload = await vscode.window.showInformationMessage(
          '数据迁移成功！需要重新加载窗口以应用更改。',
          '立即重新加载',
          '稍后重新加载'
        )

        // 根据用户选择重新加载窗口
        if (reload === '立即重新加载') {
          await vscode.commands.executeCommand('workbench.action.reloadWindow')
        } else {
          // 如果用户选择稍后重新加载，则强制刷新视图
          vscode.commands.executeCommand('starcode-snippets.forceRefreshView')
        }
      }
    } catch (error) {
      console.error('迁移失败:', error)
      vscode.window.showErrorMessage(`迁移失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })

  // 注册迁移回V1的命令（用于调试或回退）
  const migrateToV1Command = vscode.commands.registerCommand('starcode-snippets.migrateToV1', async () => {
    try {
      // 显示确认对话框
      const result = await vscode.window.showWarningMessage(
        '确定要将数据从V2(基于路径)迁移回V1(基于ID)格式吗？此操作通常用于调试或回退。',
        { modal: true },
        '确定',
        '取消'
      )

      if (result === '确定') {
        // 显示进度
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: '正在迁移数据...',
            cancellable: false,
          },
          async (progress) => {
            // 执行迁移
            progress.report({ increment: 0, message: '开始迁移...' })

            await storageContext.convertToV1(true)

            progress.report({ increment: 50, message: '更新设置...' })

            // 不使用配置存储版本信息，StorageContext已经处理了版本
            // 使用globalState备份一下版本信息
            context.globalState.update('migratedToV2', false)

            progress.report({ increment: 100, message: '迁移完成！' })
          }
        )

        // 显示成功消息
        const reload = await vscode.window.showInformationMessage(
          '数据迁移成功！需要重新加载窗口以应用更改。',
          '立即重新加载',
          '稍后重新加载'
        )

        // 根据用户选择重新加载窗口
        if (reload === '立即重新加载') {
          await vscode.commands.executeCommand('workbench.action.reloadWindow')
        } else {
          // 如果用户选择稍后重新加载，则强制刷新视图
          vscode.commands.executeCommand('starcode-snippets.forceRefreshView')
        }
      }
    } catch (error) {
      console.error('迁移失败:', error)
      vscode.window.showErrorMessage(`迁移失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })

  // 注册清理V1残留数据的命令
  const cleanupV1DataCommand = vscode.commands.registerCommand('starcode-snippets.cleanupV1Data', async () => {
    try {
      // 显示确认对话框
      const result = await vscode.window.showWarningMessage(
        '确定要清理所有V1格式的残留数据吗？此操作将删除所有旧格式的数据文件和缓存。请确保已迁移到V2格式。',
        { modal: true },
        '确定',
        '取消'
      )

      if (result === '确定') {
        // 显示进度
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: '正在清理V1数据...',
            cancellable: false,
          },
          async (progress) => {
            progress.report({ increment: 0, message: '开始清理...' })

            try {
              // 清除globalState中的V1数据
              await context.globalState.update('snippets', undefined)
              await context.globalState.update('directories', undefined)
              
              progress.report({ increment: 30, message: '清理globalState数据...' })

              // 清除StorageManager的文件数据
              const storagePath = context.globalStorageUri
              const snippetsFile = vscode.Uri.joinPath(storagePath, 'snippets.json')
              const directoriesFile = vscode.Uri.joinPath(storagePath, 'directories.json')
              
              // 清空文件内容
              await vscode.workspace.fs.writeFile(snippetsFile, Buffer.from(JSON.stringify([], null, 2)))
              await vscode.workspace.fs.writeFile(directoriesFile, Buffer.from(JSON.stringify([], null, 2)))
              
              progress.report({ increment: 60, message: '清理文件数据...' })

              // 清除存储上下文缓存
              await storageContext.clearCache()
              
              progress.report({ increment: 90, message: '清理缓存...' })

              progress.report({ increment: 100, message: '清理完成！' })
            } catch (cleanupError) {
              console.error('清理V1数据时出错:', cleanupError)
              throw cleanupError
            }
          }
        )

        // 显示成功消息
        vscode.window.showInformationMessage(
          'V1数据清理完成！如果您正在使用V2格式，数据不会受到影响。'
        )

        // 强制刷新视图
        vscode.commands.executeCommand('starcode-snippets.forceRefreshView')
      }
    } catch (error) {
      console.error('清理V1数据失败:', error)
      vscode.window.showErrorMessage(`清理V1数据失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })

  // 注册测试重名处理的命令（用于开发调试）
  const testDuplicateHandlingCommand = vscode.commands.registerCommand('starcode-snippets.testDuplicateHandling', async () => {
    try {
      // 显示确认对话框
      const result = await vscode.window.showInformationMessage(
        '此命令用于测试重名处理逻辑。将创建一些测试数据来验证V1到V2转换时的重名处理。',
        { modal: true },
        '开始测试',
        '取消'
      )

      if (result === '开始测试') {
        // 显示进度
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: '正在测试重名处理...',
            cancellable: false,
          },
          async (progress) => {
            progress.report({ increment: 0, message: '准备测试数据...' })

            // 获取当前的V2数据
            const existingSnippets = await storageContext.getAllSnippets()
            const existingDirectories = await storageContext.getAllDirectories()
            
            progress.report({ increment: 25, message: `当前有${existingSnippets.length}个代码片段，${existingDirectories.length}个目录` })

            // 创建模拟的V1数据，包含与现有V2数据重名的项目
            const mockV1Snippets = [
              {
                id: 'test-1',
                name: existingSnippets.length > 0 ? existingSnippets[0].name : 'TestSnippet',
                code: 'console.log("This is a duplicate test snippet")',
                filePath: '',
                fileName: '',
                category: 'test',
                parentId: null,
                order: 1,
                createTime: Date.now(),
                language: 'javascript'
              }
            ]

            const mockV1Directories = [
              {
                id: 'test-dir-1',
                name: existingDirectories.length > 0 ? existingDirectories[0].name : 'TestDirectory',
                parentId: null,
                order: 1
              }
            ]

            progress.report({ increment: 50, message: '执行转换测试...' })

            // 使用PathBasedManager转换数据
            const { snippets: convertedV2Snippets, directories: convertedV2Directories } = 
              (storageContext as any).constructor.name === 'StorageContext' ? 
              require('../utils/pathBasedManager').PathBasedManager.convertToV2(mockV1Snippets, mockV1Directories) :
              { snippets: [], directories: [] }

            progress.report({ increment: 75, message: '检查转换结果...' })

            // 输出测试结果
            console.log('=== 重名处理测试结果 ===')
            console.log('原始V1数据:', { snippets: mockV1Snippets, directories: mockV1Directories })
            console.log('转换后V2数据:', { snippets: convertedV2Snippets, directories: convertedV2Directories })
            console.log('现有V2数据:', { snippets: existingSnippets, directories: existingDirectories })

            progress.report({ increment: 100, message: '测试完成！' })
          }
        )

        // 显示测试结果
        vscode.window.showInformationMessage(
          '重名处理测试完成！请查看开发者控制台获取详细结果。'
        )
      }
    } catch (error) {
      console.error('重名处理测试失败:', error)
      vscode.window.showErrorMessage(`重名处理测试失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })

  disposables.push(migrateToV2Command, migrateToV1Command, cleanupV1DataCommand, testDuplicateHandlingCommand)

  return disposables
}
