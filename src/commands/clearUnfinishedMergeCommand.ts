import * as vscode from 'vscode'
import { SettingsManager } from '../utils/settingsManager'
import { PathUtils } from '../utils/pathUtils'

/**
 * 清理未完成的合并状态命令
 * 用于解决"Exiting because of unfinished merge"错误
 */
export async function clearUnfinishedMergeCommand(): Promise<void> {
  try {
    const activeConfig = SettingsManager.getActivePlatformConfig()
    if (!activeConfig) {
      vscode.window.showErrorMessage('未找到激活的同步配置')
      return
    }
    
    // 解析实际的本地路径
    const localPath = PathUtils.resolveDefaultPathToken(
      activeConfig.localPath || '', 
      activeConfig.provider, 
      SettingsManager.getExtensionContext() || undefined
    )
    
    const simpleGit = (await import('simple-git')).default
    const git = simpleGit(localPath)
    
    // 检查Git仓库状态
    const status = await git.status()
    
    if (status.conflicted.length > 0) {
      // 有冲突文件，询问用户如何处理
      const choice = await vscode.window.showWarningMessage(
        `检测到 ${status.conflicted.length} 个冲突文件\n\n请选择处理方式：`,
        {
          modal: true,
          detail: '建议先手动解决冲突，如果确定要放弃合并，选择"放弃合并"'
        },
        '手动解决冲突',
        '放弃合并',
        '取消'
      )
      
      if (choice === '手动解决冲突') {
        // 打开冲突解决工具
        await vscode.commands.executeCommand('starcode-snippets.resolveMergeConflict')
        return
      } else if (choice === '放弃合并') {
        // 放弃合并
        await git.raw(['merge', '--abort'])
        vscode.window.showInformationMessage('✅ 已放弃未完成的合并，Git仓库状态已清理')
      }
      return
    }
    
    // 检查是否有暂存的更改（合并已解决但未提交）
    if (status.staged.length > 0 || status.files.some(f => f.index === 'M')) {
      const choice = await vscode.window.showInformationMessage(
        '检测到已解决的合并更改，但尚未提交\n\n是否完成合并提交？',
        { modal: true },
        '完成合并',
        '放弃更改'
      )
      
      if (choice === '完成合并') {
        // 完成合并提交
        const commitMessage = `合并远程更改: ${new Date().toLocaleString()}`
        await git.commit(commitMessage)
        vscode.window.showInformationMessage('✅ 合并提交完成，可以继续同步')
      } else if (choice === '放弃更改') {
        // 重置到合并前状态
        await git.raw(['reset', '--hard', 'HEAD'])
        vscode.window.showInformationMessage('✅ 已重置到合并前状态')
      }
      return
    }
    
    // 检查是否真的有未完成的合并
    try {
      const mergeHead = await git.raw(['rev-parse', '--verify', 'MERGE_HEAD']).catch(() => null)
      if (mergeHead) {
        // 有MERGE_HEAD但没有冲突，可能是自动合并成功但未提交
        const choice = await vscode.window.showInformationMessage(
          '检测到未提交的自动合并\n\n是否完成合并提交？',
          { modal: true },
          '完成合并',
          '放弃合并'
        )
        
        if (choice === '完成合并') {
          const commitMessage = `自动合并远程更改: ${new Date().toLocaleString()}`
          await git.commit(commitMessage)
          vscode.window.showInformationMessage('✅ 自动合并提交完成')
        } else if (choice === '放弃合并') {
          await git.raw(['merge', '--abort'])
          vscode.window.showInformationMessage('✅ 已放弃未完成的合并')
        }
      } else {
        vscode.window.showInformationMessage('✅ Git仓库状态正常，无需清理')
      }
    } catch (error) {
      vscode.window.showInformationMessage('✅ Git仓库状态正常，无需清理')
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误'
    vscode.window.showErrorMessage(`清理合并状态失败: ${errorMessage}`)
    console.error('清理合并状态失败:', error)
  }
} 