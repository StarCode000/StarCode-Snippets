import * as vscode from 'vscode'
import { TempFilesCleaner } from '../utils/cleanupTempFiles'

/**
 * 注册清理相关的命令
 */
export function registerCleanupCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
  
  const cleanupTempFiles = vscode.commands.registerCommand('starcode-snippets.cleanupTempFiles', async () => {
    try {
      // 先检查是否有需要清理的文件
      const checkResult = await TempFilesCleaner.checkNeedCleanup()
      
      if (!checkResult.needCleanup) {
        vscode.window.showInformationMessage('没有发现需要清理的临时文件')
        return
      }
      
      // 获取详细信息
      const fileInfo = await TempFilesCleaner.getTempFilesInfo()
      const fileSizeKB = (fileInfo.totalSize / 1024).toFixed(2)
      
      // 询问用户是否确认清理
      const confirmMessage = `发现 ${checkResult.fileCount} 个临时凭据文件（总大小: ${fileSizeKB} KB）\n\n` +
        `这些文件是由于之前版本的bug而产生的，可以安全删除。\n\n` +
        `是否确认清理这些文件？`
      
      const confirm = await vscode.window.showWarningMessage(
        confirmMessage,
        { modal: true },
        '确认清理',
        '查看详情'
      )
      
      if (confirm === '查看详情') {
        // 显示详细的文件列表
        let details = '# 临时凭据文件清理详情\n\n'
        details += `发现 ${checkResult.fileCount} 个需要清理的文件：\n\n`
        
        for (const file of fileInfo.files) {
          const sizeKB = (file.size / 1024).toFixed(2)
          const modifiedDate = file.modifiedTime.toLocaleString()
          details += `## ${file.name}\n`
          details += `- **大小**: ${sizeKB} KB\n`
          details += `- **修改时间**: ${modifiedDate}\n`
          details += `- **路径**: ${file.path}\n\n`
        }
        
        details += `**总大小**: ${fileSizeKB} KB\n\n`
        details += '这些文件是由于之前版本中Gitee认证处理的bug而产生的临时凭据文件，可以安全删除。'
        
        // 创建临时文档显示详情
        const doc = await vscode.workspace.openTextDocument({
          content: details,
          language: 'markdown',
        })
        
        await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: true,
        })
        
        // 再次询问是否清理
        const finalConfirm = await vscode.window.showWarningMessage(
          '是否继续清理这些临时文件？',
          { modal: true },
          '确认清理'
        )
        
        if (finalConfirm !== '确认清理') {
          return
        }
      } else if (confirm !== '确认清理') {
        return
      }
      
      // 执行清理
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: '清理临时文件',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 0, message: '正在清理临时凭据文件...' })
          
          const result = await TempFilesCleaner.cleanupGiteeCredFiles()
          
          progress.report({ increment: 100, message: '清理完成' })
          
          if (result.success) {
            if (result.deletedFiles.length > 0) {
              vscode.window.showInformationMessage(
                `✅ 清理成功！已删除 ${result.deletedFiles.length} 个临时文件`
              )
            } else {
              vscode.window.showInformationMessage('没有发现需要清理的文件')
            }
          } else {
            vscode.window.showErrorMessage(`❌ 清理失败: ${result.message}`)
          }
        }
      )
      
    } catch (error) {
      console.error('清理临时文件失败:', error)
      vscode.window.showErrorMessage(`清理临时文件失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })
  
  const checkTempFiles = vscode.commands.registerCommand('starcode-snippets.checkTempFiles', async () => {
    try {
      const checkResult = await TempFilesCleaner.checkNeedCleanup()
      
      if (!checkResult.needCleanup) {
        vscode.window.showInformationMessage('✅ 没有发现需要清理的临时文件')
        return
      }
      
      const fileInfo = await TempFilesCleaner.getTempFilesInfo()
      const fileSizeKB = (fileInfo.totalSize / 1024).toFixed(2)
      
      const message = `⚠️ 发现 ${checkResult.fileCount} 个临时凭据文件\n\n` +
        `总大小: ${fileSizeKB} KB\n\n` +
        `这些文件是由于之前版本的bug而产生的，建议清理。`
      
      const action = await vscode.window.showWarningMessage(
        message,
        '立即清理',
        '查看详情'
      )
      
      if (action === '立即清理') {
        vscode.commands.executeCommand('starcode-snippets.cleanupTempFiles')
      } else if (action === '查看详情') {
        // 显示详细信息
        let details = '# 临时文件检查报告\n\n'
        details += `**状态**: ⚠️ 发现需要清理的文件\n`
        details += `**文件数量**: ${checkResult.fileCount}\n`
        details += `**总大小**: ${fileSizeKB} KB\n\n`
        
        details += '## 文件列表\n\n'
        for (const file of fileInfo.files) {
          const sizeKB = (file.size / 1024).toFixed(2)
          const modifiedDate = file.modifiedTime.toLocaleString()
          details += `- **${file.name}** (${sizeKB} KB, ${modifiedDate})\n`
        }
        
        details += '\n## 说明\n\n'
        details += '这些临时凭据文件是由于之前版本中Gitee认证处理的bug而产生的。\n'
        details += '文件名格式为 `UsersstarAppDataLocalTempgitee-cred-[timestamp].txt`\n\n'
        details += '**推荐操作**: 使用"清理临时文件"命令安全删除这些文件。'
        
        const doc = await vscode.workspace.openTextDocument({
          content: details,
          language: 'markdown',
        })
        
        await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: true,
        })
      }
      
    } catch (error) {
      console.error('检查临时文件失败:', error)
      vscode.window.showErrorMessage(`检查临时文件失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })
  
  return [cleanupTempFiles, checkTempFiles]
} 