import * as vscode from 'vscode'
import { SettingsManager } from '../utils/settingsManager'

/**
 * 调试Gitee认证配置的命令
 */
export function registerDebugGiteeAuthCommand(context: vscode.ExtensionContext): vscode.Disposable {
  
  return vscode.commands.registerCommand('starcode-snippets.debugGiteeAuth', async () => {
    try {
      const config = SettingsManager.getCloudSyncConfig()
      
      if (!config.provider || config.provider !== 'gitee') {
        vscode.window.showWarningMessage('当前配置的不是Gitee平台')
        return
      }
      
      if (!config.token || !config.repositoryUrl) {
        vscode.window.showWarningMessage('Gitee配置不完整，缺少Token或仓库URL')
        return
      }
      
      // 模拟URL构建过程
      const debugInfo = []
      debugInfo.push('=== Gitee认证调试信息 ===')
      debugInfo.push(`原始仓库URL: ${config.repositoryUrl}`)
      debugInfo.push(`Token: ${config.token.substring(0, 8)}...（已隐藏）`)
      debugInfo.push(`认证方式: ${config.authenticationMethod}`)
      
      // 测试URL构建
      try {
        const urlObj = new URL(config.repositoryUrl)
        debugInfo.push(`\n--- URL组件解析 ---`)
        debugInfo.push(`协议: ${urlObj.protocol}`)
        debugInfo.push(`主机: ${urlObj.host}`)
        debugInfo.push(`路径: ${urlObj.pathname}`)
        debugInfo.push(`原始用户名: ${urlObj.username || '(无)'}`)
        debugInfo.push(`原始密码: ${urlObj.password || '(无)'}`)
        
        // 构建新的URL（带认证）- 使用oauth2认证方式
        const newUrlObj = new URL(config.repositoryUrl)
        newUrlObj.username = 'oauth2'
        newUrlObj.password = config.token
        
        const finalUrl = newUrlObj.toString()
        debugInfo.push(`\n--- 构建的认证URL ---`)
        debugInfo.push(`完整URL: ${finalUrl.replace(config.token, config.token.substring(0, 8) + '...')}`)
        
        // 分析可能的问题
        debugInfo.push(`\n--- 潜在问题分析 ---`)
        
        if (config.repositoryUrl.endsWith('/')) {
          debugInfo.push(`⚠️ 仓库URL以斜杠结尾，可能导致问题`)
        }
        
        if (!config.repositoryUrl.endsWith('.git')) {
          debugInfo.push(`⚠️ 仓库URL不以.git结尾，可能导致问题`)
        }
        
        if (config.token.length < 20) {
          debugInfo.push(`⚠️ Token长度可能不正确（${config.token.length}字符）`)
        }
        
        // 检查Token格式
        const tokenPattern = /^[a-f0-9]{32}$/
        if (!tokenPattern.test(config.token)) {
          debugInfo.push(`⚠️ Token格式可能不正确（应为32位十六进制字符串）`)
        }
        
        debugInfo.push(`\n--- 建议的解决方案 ---`)
        debugInfo.push(`1. 确保仓库URL格式正确: https://gitee.com/用户名/仓库名.git`)
        debugInfo.push(`2. 检查Token是否有仓库访问权限`)
        debugInfo.push(`3. 尝试重新生成Token`)
        debugInfo.push(`4. 考虑使用SSH认证方式`)
        
        // 显示调试信息
        const document = await vscode.workspace.openTextDocument({
          content: debugInfo.join('\n'),
          language: 'plaintext'
        })
        
        await vscode.window.showTextDocument(document, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: true
        })
        
      } catch (urlError) {
        debugInfo.push(`\n❌ URL解析失败: ${urlError instanceof Error ? urlError.message : '未知错误'}`)
        vscode.window.showErrorMessage(`URL解析失败: ${urlError instanceof Error ? urlError.message : '未知错误'}`)
      }
      
    } catch (error) {
      console.error('调试Gitee认证失败:', error)
      vscode.window.showErrorMessage(`调试失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })
} 