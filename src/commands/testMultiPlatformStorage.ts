import * as vscode from 'vscode'
import { SettingsManager } from '../utils/settingsManager'
import { CloudSyncConfig } from '../types/types'

/**
 * 测试多平台配置存储功能
 */
export function registerTestMultiPlatformStorageCommand(context: vscode.ExtensionContext): vscode.Disposable {
  
  return vscode.commands.registerCommand('starcode-snippets.testMultiPlatformStorage', async () => {
    try {
      console.log('开始测试多平台配置存储...')
      
      // 创建测试配置数据
      const testConfigs: { [provider: string]: CloudSyncConfig } = {
        'github': {
          provider: 'github',
          repositoryUrl: 'https://github.com/test/github-repo.git',
          token: 'github_test_token_123',
          localPath: '',
          defaultBranch: 'main',
          authenticationMethod: 'token',
          sshKeyPath: '',
          autoSync: false,
          syncInterval: 15,
          commitMessageTemplate: 'GitHub sync: {timestamp}'
        },
        'gitlab': {
          provider: 'gitlab',
          repositoryUrl: 'https://gitlab.com/test/gitlab-repo.git',
          token: 'gitlab_test_token_456',
          localPath: '',
          defaultBranch: 'main',
          authenticationMethod: 'token',
          sshKeyPath: '',
          autoSync: false,
          syncInterval: 15,
          commitMessageTemplate: 'GitLab sync: {timestamp}'
        },
        'gitee': {
          provider: 'gitee',
          repositoryUrl: 'https://gitee.com/test/gitee-repo.git',
          token: 'gitee_test_token_789',
          localPath: '',
          defaultBranch: 'main',
          authenticationMethod: 'token',
          sshKeyPath: '',
          autoSync: false,
          syncInterval: 15,
          commitMessageTemplate: 'Gitee sync: {timestamp}'
        }
      }
      
      // 测试批量保存
      console.log('测试批量保存三个平台配置...')
      const savedCount = await SettingsManager.saveBatchPlatformConfigs(testConfigs)
      console.log(`批量保存结果: ${savedCount} 个配置已保存`)
      
      // 验证保存结果
      console.log('验证保存结果...')
      const multiConfig = SettingsManager.getMultiPlatformCloudSyncConfig()
      console.log(`多平台配置中的平台数量: ${multiConfig.platforms.length}`)
      
      const results = []
      
      // 检查每个平台配置
      for (const platform of ['github', 'gitlab', 'gitee']) {
        const savedPlatform = multiConfig.platforms.find(p => p.provider === platform)
        if (savedPlatform) {
          results.push(`✅ ${platform.toUpperCase()}: 已保存`)
          console.log(`${platform} 配置详情:`, {
            id: savedPlatform.id,
            name: savedPlatform.name,
            repositoryUrl: savedPlatform.repositoryUrl,
            hasToken: !!savedPlatform.token,
            isActive: savedPlatform.isActive
          })
        } else {
          results.push(`❌ ${platform.toUpperCase()}: 未找到`)
        }
      }
      
      // 测试VSCode配置存储
      console.log('测试VSCode配置存储...')
      const vscodeConfig = vscode.workspace.getConfiguration()
      const storedMultiConfig = vscodeConfig.get('starcode-snippets.multiPlatformCloudSync')
      console.log('VSCode中存储的多平台配置:', storedMultiConfig)
      
      // 测试激活配置功能
      console.log('测试激活配置功能...')
      let legacyConfig: CloudSyncConfig | null = null
      const githubPlatform = multiConfig.platforms.find(p => p.provider === 'github')
      if (githubPlatform) {
        await SettingsManager.activatePlatformConfig(githubPlatform.id)
        console.log('已激活GitHub配置')
        
        // 验证传统配置同步
        legacyConfig = SettingsManager.getCloudSyncConfig()
        console.log('传统配置同步结果:', {
          provider: legacyConfig.provider,
          repositoryUrl: legacyConfig.repositoryUrl,
          hasToken: !!legacyConfig.token
        })
      }
      
      // 显示测试结果
      const resultMessage = [
        '🧪 多平台配置存储测试结果:',
        '',
        ...results,
        '',
        `📊 总共保存: ${savedCount} 个配置`,
        `📋 VSCode存储: ${storedMultiConfig ? '正常' : '异常'}`,
        `🔄 配置同步: ${legacyConfig && legacyConfig.provider === 'github' ? '正常' : '异常'}`,
        '',
        '详细信息请查看开发者控制台'
      ].join('\n')
      
      await vscode.window.showInformationMessage(
        resultMessage,
        { modal: true },
        '查看控制台'
      )
      
      // 询问是否清理测试数据
      const shouldCleanup = await vscode.window.showWarningMessage(
        '测试完成！是否清理测试数据？',
        '清理数据',
        '保留数据'
      )
      
      if (shouldCleanup === '清理数据') {
        console.log('清理测试数据...')
        await SettingsManager.resetConfig()
        console.log('测试数据已清理')
        vscode.window.showInformationMessage('测试数据已清理完成')
      }
      
    } catch (error) {
      console.error('多平台配置存储测试失败:', error)
      vscode.window.showErrorMessage(`测试失败: ${error}`)
    }
  })
} 