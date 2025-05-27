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

            // 执行迁移到V2
            await storageContext.convertToV2(true)

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

  disposables.push(migrateToV2Command, migrateToV1Command)

  return disposables
}
