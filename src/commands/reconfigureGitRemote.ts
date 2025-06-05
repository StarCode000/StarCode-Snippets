import * as vscode from 'vscode'
import { SettingsManager } from '../utils/settingsManager'
import { simpleGit } from 'simple-git'

/**
 * 重新配置Git远程仓库的命令
 */
export function registerReconfigureGitRemoteCommand(context: vscode.ExtensionContext): vscode.Disposable {
  
  return vscode.commands.registerCommand('starcode-snippets.reconfigureGitRemote', async () => {
    try {
      const config = SettingsManager.getCloudSyncConfig()
      
      if (!config.provider || !config.repositoryUrl || !config.token) {
        vscode.window.showWarningMessage('Git同步配置不完整')
        return
      }
      
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      const git = simpleGit(effectiveLocalPath)
      
      const result = await vscode.window.showInformationMessage(
        '重新配置Git远程仓库将使用最新的认证设置。是否继续？',
        '确认重新配置',
        '取消'
      )
      
      if (result !== '确认重新配置') {
        return
      }
      
      const operations = []
      operations.push('=== Git远程仓库重新配置 ===')
      operations.push(`平台: ${config.provider}`)
      operations.push(`仓库: ${config.repositoryUrl}`)
      
      try {
        // 1. 检查当前远程配置
        operations.push('\n1. 检查当前远程配置...')
        const remotes = await git.getRemotes(true)
        const originRemote = remotes.find(remote => remote.name === 'origin')
        
        if (originRemote) {
          operations.push(`   当前origin URL: ${originRemote.refs.fetch}`)
        } else {
          operations.push('   ⚠️ 未找到origin远程仓库')
        }
        
        // 2. 构建新的认证URL
        operations.push('\n2. 构建新的认证URL...')
        const urlObj = new URL(config.repositoryUrl)
        
        if (config.provider === 'github') {
          urlObj.username = config.token
          urlObj.password = 'x-oauth-basic'
        } else if (config.provider === 'gitlab') {
          urlObj.username = 'oauth2'
          urlObj.password = config.token
        } else if (config.provider === 'gitee') {
          urlObj.username = 'oauth2'
          urlObj.password = config.token
        } else {
          urlObj.username = config.token
          urlObj.password = ''
        }
        
        const newUrl = urlObj.toString()
        const maskedUrl = newUrl.replace(config.token, '***')
        operations.push(`   新URL: ${maskedUrl}`)
        
        // 3. 移除旧的远程配置
        if (originRemote) {
          operations.push('\n3. 移除旧的远程配置...')
          await git.removeRemote('origin')
          operations.push('   ✅ 已移除origin远程仓库')
        }
        
        // 4. 添加新的远程配置
        operations.push('\n4. 添加新的远程配置...')
        await git.addRemote('origin', newUrl)
        operations.push('   ✅ 已添加新的origin远程仓库（带认证）')
        
        // 5. 测试远程连接
        operations.push('\n5. 测试远程连接...')
        try {
          await git.listRemote(['--heads', 'origin'])
          operations.push('   ✅ 远程连接测试成功')
        } catch (testError) {
          operations.push(`   ❌ 远程连接测试失败: ${testError instanceof Error ? testError.message : '未知错误'}`)
        }
        
        // 6. 清理Git配置
        operations.push('\n6. 优化Git配置...')
        try {
          // 清除可能冲突的credential helper设置
          await git.raw(['config', '--unset', 'credential.helper']).catch(() => {})
          operations.push('   ✅ 已清除credential helper配置')
          
          // 禁用credential helper避免弹出对话框
          await git.raw(['config', 'credential.helper', ''])
          operations.push('   ✅ 已禁用credential helper')
          
          if (config.provider === 'gitee') {
            await git.raw(['config', 'credential.useHttpPath', 'true'])
            operations.push('   ✅ 已启用HTTP路径认证（Gitee优化）')
          }
        } catch (configError) {
          operations.push(`   ⚠️ Git配置优化失败: ${configError instanceof Error ? configError.message : '未知错误'}`)
        }
        
        operations.push('\n=== 配置完成 ===')
        operations.push('✅ Git远程仓库已重新配置')
        operations.push('现在可以尝试同步操作了')
        
      } catch (error) {
        operations.push(`\n❌ 重新配置失败: ${error instanceof Error ? error.message : '未知错误'}`)
      }
      
      // 显示操作结果
      const document = await vscode.workspace.openTextDocument({
        content: operations.join('\n'),
        language: 'plaintext'
      })
      
      await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: true
      })
      
      vscode.window.showInformationMessage('Git远程仓库重新配置完成')
      
    } catch (error) {
      console.error('重新配置Git远程仓库失败:', error)
      vscode.window.showErrorMessage(`重新配置失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })
} 