import * as vscode from 'vscode'
import { SettingsManager } from '../utils/settingsManager'
import { simpleGit } from 'simple-git'

/**
 * 清除Git凭据缓存的命令
 */
export function registerClearGitCredentialsCommand(context: vscode.ExtensionContext): vscode.Disposable {
  
  return vscode.commands.registerCommand('starcode-snippets.clearGitCredentials', async () => {
    try {
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      const git = simpleGit(effectiveLocalPath)
      
      const result = await vscode.window.showWarningMessage(
        '清除Git凭据缓存可能需要重新输入认证信息。是否继续？',
        { modal: true },
        '继续清除',
        '取消'
      )
      
      if (result !== '继续清除') {
        return
      }
      
      const operations = []
      operations.push('=== Git凭据清除操作 ===')
      
      try {
        // 方法1：清除Windows凭据管理器中的Gitee凭据
        const config = SettingsManager.getCloudSyncConfig()
        if (config.provider === 'gitee' && config.repositoryUrl) {
          const url = new URL(config.repositoryUrl)
          const host = url.host
          
          operations.push(`\n1. 尝试清除 ${host} 的凭据...`)
          
          try {
            // 清除credential helper的缓存
            await git.raw(['config', '--unset', 'credential.helper'])
            operations.push('   ✅ 已清除 credential.helper 配置')
          } catch (error) {
            operations.push('   ⚠️ credential.helper 配置不存在或清除失败')
          }
          
          // 注意：credential reject 命令需要特殊处理，这里跳过
          operations.push('   ⚠️ 跳过credential reject命令（需手动清理）')
        }
        
        // 方法2：重新配置远程仓库
        operations.push('\n2. 重新配置远程仓库...')
        try {
          const remotes = await git.getRemotes(true)
          const originRemote = remotes.find(remote => remote.name === 'origin')
          
          if (originRemote) {
            operations.push(`   当前远程URL: ${originRemote.refs.fetch}`)
            
            // 移除并重新添加远程仓库
            await git.removeRemote('origin')
            operations.push('   ✅ 已移除旧的远程配置')
            
            // 构建新的认证URL
            const config = SettingsManager.getCloudSyncConfig()
            if (config.repositoryUrl && config.token) {
              const urlObj = new URL(config.repositoryUrl)
              urlObj.username = config.token
              urlObj.password = ''
              const newUrl = urlObj.toString()
              
              await git.addRemote('origin', newUrl)
              operations.push('   ✅ 已添加新的远程配置（带认证）')
            }
          } else {
            operations.push('   ⚠️ 未找到origin远程仓库')
          }
        } catch (remoteError) {
          operations.push(`   ❌ 重新配置远程仓库失败: ${remoteError instanceof Error ? remoteError.message : '未知错误'}`)
        }
        
        // 方法3：设置Git配置以跳过凭据提示
        operations.push('\n3. 配置Git认证设置...')
        try {
          // 设置credential helper为空，避免弹出对话框
          await git.raw(['config', 'credential.helper', ''])
          operations.push('   ✅ 已禁用credential helper')
          
          // 为Gitee配置特殊设置
          if (config.provider === 'gitee') {
            await git.raw(['config', 'credential.useHttpPath', 'true'])
            operations.push('   ✅ 已启用HTTP路径认证')
          }
        } catch (configError) {
          operations.push(`   ❌ 配置Git设置失败: ${configError instanceof Error ? configError.message : '未知错误'}`)
        }
        
        operations.push('\n=== 操作完成 ===')
        operations.push('请尝试重新执行同步操作。')
        operations.push('如果仍然出现认证对话框，请选择以下选项：')
        operations.push('- 用户名：您的Token')
        operations.push('- 密码：留空')
        
      } catch (error) {
        operations.push(`\n❌ 清除操作失败: ${error instanceof Error ? error.message : '未知错误'}`)
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
      
      vscode.window.showInformationMessage('Git凭据清除操作完成，请查看详细日志')
      
    } catch (error) {
      console.error('清除Git凭据失败:', error)
      vscode.window.showErrorMessage(`清除Git凭据失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })
} 