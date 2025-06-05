import * as vscode from 'vscode'
import { SettingsManager } from '../utils/settingsManager'
import { simpleGit } from 'simple-git'
import * as fs from 'fs'
import * as path from 'path'

/**
 * 处理Git平台切换的命令
 */
export function registerSwitchPlatformCommand(context: vscode.ExtensionContext): vscode.Disposable {
  
  return vscode.commands.registerCommand('starcode-snippets.switchPlatform', async () => {
    try {
      const config = SettingsManager.getCloudSyncConfig()
      
      if (!config.provider || !config.repositoryUrl) {
        vscode.window.showWarningMessage('请先配置Git同步信息')
        return
      }
      
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      
      // 检查是否存在本地Git仓库
      if (!fs.existsSync(effectiveLocalPath) || !fs.existsSync(path.join(effectiveLocalPath, '.git'))) {
        vscode.window.showInformationMessage('未发现现有Git仓库，无需处理平台切换')
        return
      }
      
      const git = simpleGit(effectiveLocalPath)
      
      // 获取当前远程信息
      const remotes = await git.getRemotes(true)
      const originRemote = remotes.find(remote => remote.name === 'origin')
      
      if (!originRemote) {
        vscode.window.showWarningMessage('未找到origin远程仓库')
        return
      }
      
      // 分析当前远程URL，判断平台
      const currentUrl = originRemote.refs.fetch
      let currentPlatform = 'unknown'
      
      if (currentUrl.includes('github.com')) {
        currentPlatform = 'github'
      } else if (currentUrl.includes('gitlab.com')) {
        currentPlatform = 'gitlab'
      } else if (currentUrl.includes('gitee.com')) {
        currentPlatform = 'gitee'
      }
      
      const newPlatform = config.provider
      
      // 如果平台相同，只需要更新认证信息
      if (currentPlatform === newPlatform) {
        vscode.window.showInformationMessage(`当前已经是${newPlatform}平台，正在更新认证信息...`)
        
        // 使用重新配置远程仓库命令
        await vscode.commands.executeCommand('starcode-snippets.reconfigureGitRemote')
        return
      }
      
      // 平台不同，需要特殊处理
      const switchOptions = [
        {
          label: '🔄 切换并保留历史',
          detail: '将当前仓库重新指向新平台，保留提交历史',
          action: 'switch'
        },
        {
          label: '🆕 重新开始',
          detail: '备份当前数据，清空仓库，连接到新平台',
          action: 'restart'
        },
        {
          label: '📋 仅查看影响',
          detail: '显示切换平台的详细影响分析',
          action: 'analyze'
        }
      ]
      
      const selected = await vscode.window.showQuickPick(switchOptions, {
        placeHolder: `检测到平台变更：${currentPlatform} → ${newPlatform}`,
        ignoreFocusOut: true
      })
      
      if (!selected) {
        return
      }
      
      const operations = []
      operations.push('=== Git平台切换操作 ===')
      operations.push(`原平台: ${currentPlatform}`)
      operations.push(`新平台: ${newPlatform}`)
      operations.push(`原远程URL: ${currentUrl}`)
      operations.push(`新远程URL: ${config.repositoryUrl}`)
      operations.push('')
      
      if (selected.action === 'analyze') {
        // 分析影响
        operations.push('=== 影响分析 ===')
        
        try {
          const status = await git.status()
          const logs = await git.log(['--oneline', '-10'])
          
          operations.push(`当前分支: ${status.current}`)
          operations.push(`工作区状态: ${status.files.length > 0 ? '有未提交变更' : '干净'}`)
          operations.push(`最近提交数: ${logs.total}`)
          
          if (logs.total > 0) {
            operations.push('\n最近的提交:')
            logs.all.forEach(commit => {
              operations.push(`  - ${commit.hash.substring(0, 7)}: ${commit.message}`)
            })
          }
          
          operations.push('\n=== 切换选项说明 ===')
          operations.push('1. 🔄 切换并保留历史:')
          operations.push('   - 保留所有提交历史')
          operations.push('   - 只更改远程仓库URL')
          operations.push('   - 适合迁移到新平台但保持历史连续性')
          operations.push('   - 首次推送时需要使用 --force')
          
          operations.push('\n2. 🆕 重新开始:')
          operations.push('   - 备份当前代码片段数据')
          operations.push('   - 删除Git历史，重新初始化')
          operations.push('   - 连接到新平台仓库')
          operations.push('   - 适合完全重新开始')
          
        } catch (analysisError) {
          operations.push(`分析失败: ${analysisError instanceof Error ? analysisError.message : '未知错误'}`)
        }
        
      } else if (selected.action === 'switch') {
        // 切换并保留历史
        operations.push('=== 执行平台切换（保留历史）===')
        
        try {
          // 1. 检查工作区状态
          const status = await git.status()
          if (status.files.length > 0) {
            operations.push('⚠️ 检测到未提交的变更，建议先提交或暂存')
            operations.push('变更文件:')
            status.files.forEach(file => {
              operations.push(`  - ${file.working_dir}${file.index} ${file.path}`)
            })
            
            const shouldContinue = await vscode.window.showWarningMessage(
              '检测到未提交的变更，是否继续切换？',
              '继续切换',
              '取消'
            )
            
            if (shouldContinue !== '继续切换') {
              operations.push('用户取消操作')
              return
            }
          }
          
          // 2. 备份当前远程配置
          operations.push('\n1. 备份原远程配置...')
          await git.addRemote('origin-backup', currentUrl).catch(() => {
            operations.push('   远程备份已存在，跳过')
          })
          operations.push('   ✅ 已备份为 origin-backup')
          
          // 3. 更新远程URL
          operations.push('\n2. 更新远程仓库URL...')
          await git.removeRemote('origin')
          
          // 构建新的认证URL
          const urlObj = new URL(config.repositoryUrl)
          if (config.authenticationMethod === 'token' && config.token) {
            if (newPlatform === 'github') {
              urlObj.username = config.token
              urlObj.password = 'x-oauth-basic'
            } else if (newPlatform === 'gitlab' || newPlatform === 'gitee') {
              urlObj.username = 'oauth2'
              urlObj.password = config.token
            } else {
              urlObj.username = config.token
              urlObj.password = ''
            }
          }
          
          await git.addRemote('origin', urlObj.toString())
          operations.push('   ✅ 已更新远程URL')
          
          // 4. 测试连接
          operations.push('\n3. 测试新平台连接...')
          try {
            await git.listRemote(['--heads', 'origin'])
            operations.push('   ✅ 新平台连接成功')
          } catch (testError) {
            operations.push(`   ❌ 连接测试失败: ${testError instanceof Error ? testError.message : '未知错误'}`)
            operations.push('   建议检查认证配置或网络连接')
          }
          
          operations.push('\n=== 切换完成 ===')
          operations.push('✅ 平台切换成功')
          operations.push('💡 首次同步时可能需要强制推送（--force）')
          operations.push('💡 如需回退，可使用 origin-backup 远程仓库')
          
        } catch (switchError) {
          operations.push(`\n❌ 切换失败: ${switchError instanceof Error ? switchError.message : '未知错误'}`)
        }
        
      } else if (selected.action === 'restart') {
        // 重新开始
        const confirmRestart = await vscode.window.showWarningMessage(
          '⚠️ 重新开始将删除所有Git历史！请确认您已备份重要数据。',
          { modal: true },
          '确认重新开始',
          '取消'
        )
        
        if (confirmRestart !== '确认重新开始') {
          operations.push('用户取消重新开始操作')
        } else {
          operations.push('=== 执行重新开始 ===')
          
          try {
            // 1. 备份当前数据文件
            operations.push('\n1. 备份数据文件...')
            const backupDir = path.join(effectiveLocalPath, `backup-${Date.now()}`)
            fs.mkdirSync(backupDir, { recursive: true })
            
            const dataFiles = ['snippets.json', 'directories.json', '.starcode-meta.json']
            for (const file of dataFiles) {
              const srcPath = path.join(effectiveLocalPath, file)
              const destPath = path.join(backupDir, file)
              if (fs.existsSync(srcPath)) {
                fs.copyFileSync(srcPath, destPath)
                operations.push(`   ✅ 已备份 ${file}`)
              }
            }
            
            // 2. 删除.git目录
            operations.push('\n2. 清除Git历史...')
            const gitDir = path.join(effectiveLocalPath, '.git')
            if (fs.existsSync(gitDir)) {
              fs.rmSync(gitDir, { recursive: true, force: true })
              operations.push('   ✅ 已删除Git历史')
            }
            
            // 3. 重新初始化Git仓库
            operations.push('\n3. 重新初始化仓库...')
            await git.init()
            
            // 设置分支
            const targetBranch = config.defaultBranch || 'main'
            await git.raw(['config', 'init.defaultBranch', targetBranch]).catch(() => {})
            await git.addConfig('user.name', 'StarCode Snippets')
            await git.addConfig('user.email', 'starcode-snippets@local')
            
            // 4. 配置新远程
            operations.push('\n4. 配置新平台远程...')
            const urlObj = new URL(config.repositoryUrl)
            if (config.authenticationMethod === 'token' && config.token) {
              if (newPlatform === 'github') {
                urlObj.username = config.token
                urlObj.password = 'x-oauth-basic'
              } else if (newPlatform === 'gitlab' || newPlatform === 'gitee') {
                urlObj.username = 'oauth2'
                urlObj.password = config.token
              } else {
                urlObj.username = config.token
                urlObj.password = ''
              }
            }
            
            await git.addRemote('origin', urlObj.toString())
            operations.push('   ✅ 已配置新远程仓库')
            
            operations.push('\n=== 重新开始完成 ===')
            operations.push('✅ 已重新初始化Git仓库')
            operations.push(`📁 数据备份位置: ${backupDir}`)
            operations.push('💡 现在可以执行首次同步了')
            
          } catch (restartError) {
            operations.push(`\n❌ 重新开始失败: ${restartError instanceof Error ? restartError.message : '未知错误'}`)
          }
        }
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
      
    } catch (error) {
      console.error('平台切换操作失败:', error)
      vscode.window.showErrorMessage(`平台切换失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })
} 