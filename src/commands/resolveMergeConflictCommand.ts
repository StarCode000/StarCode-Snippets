import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { SettingsManager } from '../utils/settingsManager'
import { PathUtils } from '../utils/pathUtils'

/**
 * 合并冲突解决命令
 * 帮助用户处理Git同步过程中出现的合并冲突
 */
export class ResolveMergeConflictCommand {
  
  /**
   * 执行合并冲突解决
   */
  public static async execute(context: vscode.ExtensionContext): Promise<void> {
    try {
      console.log('🔀 开始解决合并冲突...')
      
      // 获取当前激活的同步配置
      const activeConfig = SettingsManager.getActivePlatformConfig()
      if (!activeConfig) {
        vscode.window.showErrorMessage('未找到激活的同步配置')
        return
      }
      
      // 【修复】解析默认路径标识符为实际路径
      const localPath = PathUtils.resolveDefaultPathToken(
        activeConfig.localPath || '', 
        activeConfig.provider, 
        SettingsManager.getExtensionContext() || undefined
      )
      
      if (!fs.existsSync(localPath)) {
        vscode.window.showErrorMessage(`本地仓库路径不存在: ${localPath}`)
        return
      }
      
      // 检查是否存在合并冲突
      const simpleGit = (await import('simple-git')).default
      const git = simpleGit(localPath)
      
      const status = await git.status()
      const conflictFiles = status.conflicted
      
      if (conflictFiles.length === 0) {
        vscode.window.showInformationMessage('当前没有检测到合并冲突')
        return
      }
      
      console.log(`🔍 检测到 ${conflictFiles.length} 个冲突文件:`, conflictFiles)
      
      // 显示冲突解决选项
      const action = await vscode.window.showWarningMessage(
        `检测到 ${conflictFiles.length} 个文件存在合并冲突：\n${conflictFiles.join('\n')}\n\n请选择解决方式：`,
        {
          modal: true,
          detail: '建议选择"智能解决"让系统自动处理常见冲突。'
        },
        '智能解决',
        '手动解决', 
        '放弃合并',
        '使用本地版本',
        '使用远程版本'
      )
      
      if (!action) {
        return
      }
      
      switch (action) {
        case '智能解决':
          await this.performIntelligentResolve(git, conflictFiles, localPath)
          break
        case '手动解决':
          await this.openManualResolve(conflictFiles, localPath)
          break
        case '放弃合并':
          await this.abortMerge(git)
          break
        case '使用本地版本':
          await this.resolveWithLocal(git, conflictFiles)
          break
        case '使用远程版本':
          await this.resolveWithRemote(git, conflictFiles)
          break
      }
      
    } catch (error) {
      console.error('❌ 解决合并冲突失败:', error)
      vscode.window.showErrorMessage(`解决合并冲突失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
  
  /**
   * 智能解决冲突
   */
  private static async performIntelligentResolve(git: any, conflictFiles: string[], localPath: string): Promise<void> {
    try {
      console.log('🤖 开始智能解决冲突...')
      
      for (const file of conflictFiles) {
        const filePath = path.join(localPath, file)
        
        if (file === '.starcode-meta.json') {
          // 特殊处理元数据文件冲突
          await this.resolveMetadataConflict(filePath, git, file)
        } else if (file === 'snippets.json' || file === 'directories.json') {
          // 处理数据文件冲突
          await this.resolveDataFileConflict(filePath, git, file)
        } else {
          // 其他文件使用远程版本
          console.log(`📄 其他文件 ${file} 使用远程版本`)
          await git.raw(['checkout', '--theirs', file])
          await git.add(file)
        }
      }
      
      // 提交解决结果
      await git.commit('解决合并冲突 (智能解决)')
      
      vscode.window.showInformationMessage('✅ 智能冲突解决完成！')
      
    } catch (error) {
      console.error('❌ 智能解决失败:', error)
      throw error
    }
  }
  
  /**
   * 解决元数据文件冲突
   */
  private static async resolveMetadataConflict(filePath: string, git: any, fileName: string): Promise<void> {
    try {
      console.log(`🔧 解决元数据文件冲突: ${fileName}`)
      
      if (!fs.existsSync(filePath)) {
        console.log(`文件不存在，跳过: ${fileName}`)
        return
      }
      
      const content = fs.readFileSync(filePath, 'utf8')
      
      // 检查是否包含Git冲突标记
      if (content.includes('<<<<<<<') || content.includes('>>>>>>>')) {
        // 尝试智能合并元数据
        const resolvedContent = this.resolveMetadataContent(content)
        fs.writeFileSync(filePath, resolvedContent, 'utf8')
        
        await git.add(fileName)
        console.log(`✅ 元数据文件 ${fileName} 冲突已解决`)
      } else {
        console.log(`📄 文件 ${fileName} 无需解决冲突`)
      }
      
    } catch (error) {
      console.error(`❌ 解决元数据冲突失败: ${fileName}`, error)
      // 如果智能解决失败，使用远程版本
      await git.raw(['checkout', '--theirs', fileName])
      await git.add(fileName)
    }
  }
  
  /**
   * 解决数据文件冲突
   */
  private static async resolveDataFileConflict(filePath: string, git: any, fileName: string): Promise<void> {
    try {
      console.log(`📊 解决数据文件冲突: ${fileName}`)
      
      if (!fs.existsSync(filePath)) {
        console.log(`文件不存在，跳过: ${fileName}`)
        return
      }
      
      const content = fs.readFileSync(filePath, 'utf8')
      
      // 检查是否包含Git冲突标记
      if (content.includes('<<<<<<<') || content.includes('>>>>>>>')) {
        // 对于数据文件，优先使用远程版本以保证数据完整性
        console.log(`📄 数据文件 ${fileName} 使用远程版本以保证数据安全`)
        await git.raw(['checkout', '--theirs', fileName])
        await git.add(fileName)
      }
      
    } catch (error) {
      console.error(`❌ 解决数据文件冲突失败: ${fileName}`, error)
      // 失败时使用远程版本
      await git.raw(['checkout', '--theirs', fileName])
      await git.add(fileName)
    }
  }
  
  /**
   * 智能解析元数据内容冲突
   */
  private static resolveMetadataContent(content: string): string {
    try {
      // 简单的冲突解决策略：合并时间戳，保留最新的配置
      const lines = content.split('\n')
      const resolvedLines: string[] = []
      let inConflict = false
      let localSection: string[] = []
      let remoteSection: string[] = []
      let currentSection: 'local' | 'remote' | null = null
      
      for (const line of lines) {
        if (line.startsWith('<<<<<<<')) {
          inConflict = true
          currentSection = 'local'
          continue
        } else if (line.startsWith('=======')) {
          currentSection = 'remote'
          continue
        } else if (line.startsWith('>>>>>>>')) {
          inConflict = false
          
          // 合并本地和远程的内容
          const merged = this.mergeMetadataSections(localSection, remoteSection)
          resolvedLines.push(...merged)
          
          // 重置
          localSection = []
          remoteSection = []
          currentSection = null
          continue
        }
        
        if (inConflict) {
          if (currentSection === 'local') {
            localSection.push(line)
          } else if (currentSection === 'remote') {
            remoteSection.push(line)
          }
        } else {
          resolvedLines.push(line)
        }
      }
      
      return resolvedLines.join('\n')
      
    } catch (error) {
      console.error('❌ 解析元数据内容失败:', error)
      // 如果解析失败，返回一个基础的元数据结构
      return JSON.stringify({
        version: '2.0',
        lastSync: new Date().toISOString(),
        syncId: Date.now().toString()
      }, null, 2)
    }
  }
  
  /**
   * 合并元数据的本地和远程部分
   */
  private static mergeMetadataSections(localLines: string[], remoteLines: string[]): string[] {
    try {
      // 尝试解析JSON
      const localJson = localLines.length > 0 ? JSON.parse(localLines.join('\n')) : {}
      const remoteJson = remoteLines.length > 0 ? JSON.parse(remoteLines.join('\n')) : {}
      
      // 合并策略：使用最新的时间戳和版本信息
      const merged = {
        ...localJson,
        ...remoteJson,
        lastSync: new Date().toISOString(),
        conflictResolved: true,
        conflictResolvedAt: new Date().toISOString()
      }
      
      return JSON.stringify(merged, null, 2).split('\n')
      
    } catch (error) {
      console.error('❌ 合并元数据失败:', error)
      // 如果合并失败，使用远程版本
      return remoteLines.length > 0 ? remoteLines : localLines
    }
  }
  
  /**
   * 打开手动解决界面
   */
  private static async openManualResolve(conflictFiles: string[], localPath: string): Promise<void> {
    const message = `以下文件存在冲突，需要手动解决：\n\n${conflictFiles.join('\n')}\n\n1. 请在外部编辑器或Git工具中解决冲突\n2. 解决完成后运行 "starcode-snippets.completeMerge" 命令完成合并`
    
    vscode.window.showInformationMessage(message, '打开仓库文件夹', '了解如何解决冲突').then(action => {
      if (action === '打开仓库文件夹') {
        vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(localPath), true)
      } else if (action === '了解如何解决冲突') {
        vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/book/en/v2/Git-Tools-Advanced-Merging'))
      }
    })
  }
  
  /**
   * 放弃合并
   */
  private static async abortMerge(git: any): Promise<void> {
    try {
      await git.raw(['merge', '--abort'])
      vscode.window.showInformationMessage('✅ 已放弃合并，恢复到合并前状态')
    } catch (error) {
      console.error('❌ 放弃合并失败:', error)
      vscode.window.showErrorMessage('放弃合并失败，请手动处理')
    }
  }
  
  /**
   * 使用本地版本解决冲突
   */
  private static async resolveWithLocal(git: any, conflictFiles: string[]): Promise<void> {
    try {
      for (const file of conflictFiles) {
        await git.raw(['checkout', '--ours', file])
        await git.add(file)
      }
      await git.commit('解决合并冲突 (使用本地版本)')
      vscode.window.showInformationMessage('✅ 已使用本地版本解决所有冲突')
    } catch (error) {
      console.error('❌ 使用本地版本解决冲突失败:', error)
      throw error
    }
  }
  
  /**
   * 使用远程版本解决冲突
   */
  private static async resolveWithRemote(git: any, conflictFiles: string[]): Promise<void> {
    try {
      for (const file of conflictFiles) {
        await git.raw(['checkout', '--theirs', file])
        await git.add(file)
      }
      await git.commit('解决合并冲突 (使用远程版本)')
      vscode.window.showInformationMessage('✅ 已使用远程版本解决所有冲突')
    } catch (error) {
      console.error('❌ 使用远程版本解决冲突失败:', error)
      throw error
    }
  }
}

/**
 * 完成合并命令 - 用于手动解决冲突后完成合并过程
 */
export class CompleteMergeCommand {
  
  public static async execute(context: vscode.ExtensionContext): Promise<void> {
    try {
      console.log('✅ 完成合并过程...')
      
      const activeConfig = SettingsManager.getActivePlatformConfig()
      if (!activeConfig) {
        vscode.window.showErrorMessage('未找到激活的同步配置')
        return
      }
      
      // 【修复】解析默认路径标识符为实际路径
      const localPath = PathUtils.resolveDefaultPathToken(
        activeConfig.localPath || '', 
        activeConfig.provider, 
        SettingsManager.getExtensionContext() || undefined
      )
      
      const simpleGit = (await import('simple-git')).default
      const git = simpleGit(localPath)
      
      const status = await git.status()
      
      if (status.conflicted.length > 0) {
        vscode.window.showErrorMessage(`仍有 ${status.conflicted.length} 个文件存在冲突，请先解决所有冲突`)
        return
      }
      
      if (status.staged.length === 0) {
        vscode.window.showErrorMessage('没有暂存的文件，请确保已解决所有冲突并添加到暂存区')
        return
      }
      
      // 完成合并提交
      await git.commit('完成合并冲突解决')
      
      vscode.window.showInformationMessage('✅ 合并冲突解决完成！可以继续进行同步操作')
      
    } catch (error) {
      console.error('❌ 完成合并失败:', error)
      vscode.window.showErrorMessage(`完成合并失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
} 