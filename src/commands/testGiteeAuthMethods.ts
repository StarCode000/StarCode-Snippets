import * as vscode from 'vscode'
import { SettingsManager } from '../utils/settingsManager'
import { simpleGit } from 'simple-git'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

/**
 * 测试多种Gitee认证方式的命令
 */
export function registerTestGiteeAuthMethodsCommand(context: vscode.ExtensionContext): vscode.Disposable {
  
  return vscode.commands.registerCommand('starcode-snippets.testGiteeAuthMethods', async () => {
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
      
      const results = []
      results.push('=== Gitee认证方式测试报告 ===')
      results.push(`仓库: ${config.repositoryUrl}`)
      results.push(`Token: ${config.token.substring(0, 8)}...`)
      results.push('')
      
      // 创建临时测试目录
      const tempDir = path.join(os.tmpdir(), `gitee-auth-test-${Date.now()}`)
      fs.mkdirSync(tempDir, { recursive: true })
      
      const authMethods = [
        {
          name: '方法1: Token作为用户名，密码为空',
          buildUrl: (url: string, token: string) => {
            const urlObj = new URL(url)
            urlObj.username = token
            urlObj.password = ''
            return urlObj.toString()
          }
        },
        {
          name: '方法2: Token作为用户名，密码为x-oauth-basic',
          buildUrl: (url: string, token: string) => {
            const urlObj = new URL(url)
            urlObj.username = token
            urlObj.password = 'x-oauth-basic'
            return urlObj.toString()
          }
        },
        {
          name: '方法3: 用户名为空，Token作为密码',
          buildUrl: (url: string, token: string) => {
            const urlObj = new URL(url)
            urlObj.username = ''
            urlObj.password = token
            return urlObj.toString()
          }
        },
        {
          name: '方法4: 用户名为oauth2，Token作为密码',
          buildUrl: (url: string, token: string) => {
            const urlObj = new URL(url)
            urlObj.username = 'oauth2'
            urlObj.password = token
            return urlObj.toString()
          }
        },
        {
          name: '方法5: 用户名为git，Token作为密码',
          buildUrl: (url: string, token: string) => {
            const urlObj = new URL(url)
            urlObj.username = 'git'
            urlObj.password = token
            return urlObj.toString()
          }
        }
      ]
      
      // 测试每种认证方式
      for (let i = 0; i < authMethods.length; i++) {
        const method = authMethods[i]
        results.push(`\n--- ${method.name} ---`)
        
        try {
          // 构建认证URL
          const authUrl = method.buildUrl(config.repositoryUrl, config.token)
          const maskedUrl = authUrl.replace(config.token, '***')
          results.push(`构建的URL: ${maskedUrl}`)
          
          // 创建独立的测试目录
          const testDir = path.join(tempDir, `test-${i + 1}`)
          fs.mkdirSync(testDir, { recursive: true })
          
          const git = simpleGit(testDir)
          
          // 初始化仓库
          await git.init()
          
          // 添加远程仓库
          await git.addRemote('origin', authUrl)
          
          // 尝试列出远程分支（最轻量的测试）
          await git.listRemote(['--heads', 'origin'])
          
          results.push(`✅ 成功！这种认证方式有效`)
          
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '未知错误'
          results.push(`❌ 失败: ${errorMessage}`)
          
          // 分析错误类型
          if (errorMessage.includes('403')) {
            results.push(`   → 认证被拒绝（403错误）`)
          } else if (errorMessage.includes('404')) {
            results.push(`   → 仓库不存在或无权限访问（404错误）`)
          } else if (errorMessage.includes('401')) {
            results.push(`   → 认证信息无效（401错误）`)
          } else if (errorMessage.includes('Username')) {
            results.push(`   → 需要提供用户名`)
          }
        }
      }
      
      // 清理临时目录
      try {
        fs.rmSync(tempDir, { recursive: true, force: true })
      } catch (cleanupError) {
        console.warn('清理临时目录失败:', cleanupError)
      }
      
      results.push('\n=== 建议 ===')
      results.push('1. 如果所有方法都失败，请检查Token权限')
      results.push('2. 确认Token是否有仓库访问权限')
      results.push('3. 尝试重新生成Token')
      results.push('4. 考虑使用SSH认证方式')
      
      // 显示测试结果
      const document = await vscode.workspace.openTextDocument({
        content: results.join('\n'),
        language: 'plaintext'
      })
      
      await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: true
      })
      
    } catch (error) {
      console.error('测试Gitee认证方式失败:', error)
      vscode.window.showErrorMessage(`测试失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })
} 