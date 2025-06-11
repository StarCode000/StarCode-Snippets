import * as vscode from 'vscode'
import { CloudSyncManager } from './cloudSyncManager'
import { CodeSnippet, Directory } from '../types/types'

/**
 * 【Git 标准】命令映射器
 * 
 * 将复杂的同步命令映射到简单的Git标准操作：
 * - sync: 标准同步（git pull + merge + push）
 * - clone: 从远程克隆数据（git clone）
 * - status: 检查状态（git status）
 * - test: 测试连接（git ls-remote）
 */
export class GitCommandMapper {
  private cloudSyncManager: CloudSyncManager

  constructor(context: vscode.ExtensionContext, storageManager: any) {
    this.cloudSyncManager = new CloudSyncManager(context, storageManager)
  }

  /**
   * 【Git 标准】执行同步
   * 映射复杂的 manualSync 命令到简单的 sync 操作
   */
  async executeSync(
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[]
  ): Promise<{ success: boolean; message: string }> {
    try {
      if (!this.cloudSyncManager.isConfigured()) {
        return {
          success: false,
          message: 'Git 同步未配置，请先在设置中配置仓库信息'
        }
      }

      console.log('🔄 执行Git标准同步...')
      const result = await this.cloudSyncManager.sync(currentSnippets, currentDirectories)
      
      return {
        success: result.success,
        message: result.message
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      console.error('❌ Git同步失败:', errorMessage)
      
      return {
        success: false,
        message: `同步失败: ${errorMessage}`
      }
    }
  }

  /**
   * 【Git 标准】克隆数据
   * 映射 forceImportFromGitRepo 命令到 clone 操作
   */
  async executeClone(): Promise<{
    success: boolean
    message: string
    importedData?: { snippets: CodeSnippet[]; directories: Directory[] }
  }> {
    try {
      if (!this.cloudSyncManager.isConfigured()) {
        return {
          success: false,
          message: 'Git 同步未配置，请先在设置中配置仓库信息'
        }
      }

      console.log('📥 执行Git标准克隆...')
      const result = await this.cloudSyncManager.clone()
      
      // 如果克隆成功，读取导入的数据
      let importedData: { snippets: CodeSnippet[]; directories: Directory[] } | undefined
      
      if (result.success && (result.imported.snippets > 0 || result.imported.directories > 0)) {
        try {
          importedData = await this.cloudSyncManager.readDataFromGitRepo()
        } catch (readError) {
          console.warn('⚠️ 读取克隆数据失败:', readError)
        }
      }

      return {
        success: result.success,
        message: result.message,
        importedData
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      console.error('❌ Git克隆失败:', errorMessage)
      
      return {
        success: false,
        message: `克隆失败: ${errorMessage}`
      }
    }
  }

  /**
   * 【Git 标准】检查状态
   * 提供简化的状态信息
   */
  async executeStatus(
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[]
  ): Promise<{
    success: boolean
    hasLocalChanges: boolean
    hasRemoteChanges: boolean
    message: string
  }> {
    try {
      if (!this.cloudSyncManager.isConfigured()) {
        return {
          success: false,
          hasLocalChanges: false,
          hasRemoteChanges: false,
          message: 'Git 同步未配置'
        }
      }

      console.log('📊 检查Git状态...')
      const statusResult = await this.cloudSyncManager.status(currentSnippets, currentDirectories)
      
      return {
        success: true,
        hasLocalChanges: statusResult.hasLocalChanges,
        hasRemoteChanges: statusResult.hasRemoteChanges,
        message: statusResult.message
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      console.error('❌ Git状态检查失败:', errorMessage)
      
      return {
        success: false,
        hasLocalChanges: false,
        hasRemoteChanges: false,
        message: `状态检查失败: ${errorMessage}`
      }
    }
  }

  /**
   * 【Git 标准】测试连接
   * 映射 testConnection 到 test 操作
   */
  async executeTest(): Promise<{ success: boolean; message: string }> {
    try {
      if (!this.cloudSyncManager.isConfigured()) {
        return {
          success: false,
          message: 'Git 同步未配置，请先在设置中配置仓库信息'
        }
      }

      console.log('🔗 测试Git连接...')
      return await this.cloudSyncManager.test()

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      console.error('❌ Git连接测试失败:', errorMessage)
      
      return {
        success: false,
        message: `连接测试失败: ${errorMessage}`
      }
    }
  }

  /**
   * 获取配置状态
   */
  isConfigured(): boolean {
    return this.cloudSyncManager.isConfigured()
  }

  /**
   * 【向后兼容】执行复杂命令
   * 保留复杂命令的支持，但推荐使用标准Git操作
   */
  async executeLegacyCommand(
    command: 'reinitializeRepository' | 'pullFromCloud' | 'forcePushToCloud' | 'applyResolvedConflicts',
    ...args: any[]
  ): Promise<any> {
    console.warn(`⚠️ 正在执行遗留命令: ${command}，建议使用Git标准操作`)
    
    switch (command) {
      case 'reinitializeRepository':
        return await this.cloudSyncManager.reinitializeRepository()
      
      case 'pullFromCloud':
        return await this.cloudSyncManager.pullFromCloud()
      
      case 'forcePushToCloud':
        const [snippets, directories, confirmed] = args
        return await this.cloudSyncManager.forcePushToCloud(snippets, directories, confirmed)
      
      case 'applyResolvedConflicts':
        return await this.cloudSyncManager.applyResolvedConflicts()
      
      default:
        throw new Error(`不支持的遗留命令: ${command}`)
    }
  }

  /**
   * 获取推荐的替代操作
   */
  getRecommendedAlternative(legacyCommand: string): string {
    const alternatives: { [key: string]: string } = {
      'manualSync': 'sync() - 标准Git同步',
      'forceImportFromGitRepo': 'clone() - 从远程克隆数据',
      'pullFromCloud': 'clone() - 从远程克隆数据',
      'forcePushToCloud': 'sync() - 标准Git同步（更安全）',
      'reinitializeRepository': '手动清理.git目录后重新配置',
      'applyResolvedConflicts': 'sync() - 冲突处理已集成',
      'testConnection': 'test() - 测试Git连接'
    }
    
    return alternatives[legacyCommand] || '使用Git标准操作'
  }
} 