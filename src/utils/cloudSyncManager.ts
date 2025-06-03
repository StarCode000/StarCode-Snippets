import * as vscode from 'vscode'
import { CloudSyncConfig, CloudSyncStatus, CodeSnippet, Directory } from '../types/types'
import { SettingsManager } from './settingsManager'
import { DiffMergeManager, MergeResult } from './diffMergeManager'
import { ContextManager } from './contextManager'
import { DeviceManager } from './deviceManager'
import { PathBasedManager } from './pathBasedManager'
import * as crypto from 'crypto'
import * as path from 'path'
import * as fs from 'fs'
import { simpleGit, SimpleGit, CleanOptions } from 'simple-git'

interface SyncResult {
  success: boolean
  message: string
  conflictsDetected?: boolean
  conflictDetails?: string[]
}

export class CloudSyncManager {
  private git: SimpleGit | null = null // Git client instance
  private config: CloudSyncConfig
  private context: vscode.ExtensionContext | null = null
  private storageManager: any = null

  constructor(context?: vscode.ExtensionContext, storageManager?: any) {
    this.config = SettingsManager.getCloudSyncConfig()
    this.context = context || null
    this.storageManager = storageManager || null
  }

  /**
   * 更新配置并重新初始化Git客户端
   */
  public updateConfig(newConfig: CloudSyncConfig): void {
    this.config = newConfig
    this.git = null // Reset git client to reinitialize with new config
  }

  /**
   * 检查是否已配置Git同步
   */
  public isConfigured(): boolean {
    return !!(
      this.config.provider &&
      this.config.repositoryUrl &&
      this.config.localPath &&
      (this.config.authenticationMethod === 'ssh' || this.config.token)
    )
  }

  /**
   * 初始化或打开本地Git仓库
   */
  private async initOrOpenLocalRepo(): Promise<SimpleGit> {
    if (!this.config.localPath) {
      throw new Error('本地仓库路径未配置')
    }

    // Ensure the directory exists
    if (!fs.existsSync(this.config.localPath)) {
      fs.mkdirSync(this.config.localPath, { recursive: true })
    }

    const git = simpleGit(this.config.localPath)

    // Check if it's already a git repository
    const isRepo = await git.checkIsRepo()
    
    if (!isRepo) {
      console.log('Initializing new Git repository...')
      await git.init()
      
      // Set up user configuration if not set
      try {
        await git.addConfig('user.name', 'StarCode Snippets')
        await git.addConfig('user.email', 'starcode-snippets@local')
      } catch (error) {
        console.warn('Failed to set git user config:', error)
      }
    }

    return git
  }

  /**
   * 配置远程仓库
   */
  private async configureRemote(git: SimpleGit): Promise<void> {
    if (!this.config.repositoryUrl) {
      throw new Error('仓库URL未配置')
    }

    try {
      // Check if origin remote exists
      const remotes = await git.getRemotes(true)
      const originRemote = remotes.find(remote => remote.name === 'origin')

      let remoteUrl = this.config.repositoryUrl

      // For token authentication, embed token in URL
      if (this.config.authenticationMethod === 'token' && this.config.token) {
        remoteUrl = this.embedTokenInUrl(this.config.repositoryUrl, this.config.token)
      }

      if (originRemote) {
        // Update existing remote if URL is different
        if (originRemote.refs.fetch !== remoteUrl) {
          await git.removeRemote('origin')
          await git.addRemote('origin', remoteUrl)
        }
      } else {
        // Add new remote
        await git.addRemote('origin', remoteUrl)
      }
    } catch (error) {
      throw new Error(`配置远程仓库失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 在Git URL中嵌入认证令牌
   */
  private embedTokenInUrl(url: string, token: string): string {
    try {
      const urlObj = new URL(url)
      
      // For GitHub, GitLab, and Gitee, use token as username
      if (this.config.provider === 'github') {
        urlObj.username = token
        urlObj.password = 'x-oauth-basic'
      } else if (this.config.provider === 'gitlab') {
        urlObj.username = 'oauth2'
        urlObj.password = token
      } else if (this.config.provider === 'gitee') {
        urlObj.username = token
        urlObj.password = ''
      } else {
        // Generic token embedding
        urlObj.username = token
      }
      
      return urlObj.toString()
    } catch (error) {
      console.warn('Failed to embed token in URL, using original URL:', error)
      return url
    }
  }

  /**
   * 获取或初始化Git实例
   */
  private async getGitInstance(): Promise<SimpleGit> {
    if (!this.git) {
      this.git = await this.initOrOpenLocalRepo()
      await this.configureRemote(this.git)
    }
    return this.git
  }

  /**
   * 测试Git连接
   */
  public async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      if (!this.isConfigured()) {
        return {
          success: false,
          message: 'Git 同步配置不完整',
        }
      }

      console.log('Testing Git connection...')
      
      const git = await this.getGitInstance()
      
      // Test remote connectivity by fetching
      try {
        await git.fetch('origin', this.config.defaultBranch || 'main')
        return {
          success: true,
          message: `成功连接到 ${this.config.provider} 仓库`,
        }
      } catch (fetchError) {
        // If fetch fails, try to check if the remote exists
        try {
          const remotes = await git.getRemotes(true)
          const originRemote = remotes.find(remote => remote.name === 'origin')
          
          if (originRemote) {
            return {
              success: false,
              message: `远程仓库配置正确，但无法访问。请检查网络连接、令牌权限或仓库是否存在。错误: ${fetchError instanceof Error ? fetchError.message : '未知错误'}`,
            }
          } else {
            return {
              success: false,
              message: '远程仓库未配置',
            }
          }
        } catch (remoteError) {
          return {
            success: false,
            message: `Git 配置错误: ${remoteError instanceof Error ? remoteError.message : '未知错误'}`,
          }
        }
      }
    } catch (error) {
      console.error('Git connection test failed:', error)
      return {
        success: false,
        message: `连接测试失败: ${error instanceof Error ? error.message : '未知错误'}`,
      }
    }
  }

  /**
   * 核心Git操作封装 - 拉取远程变更
   */
  public async gitPull(branch?: string): Promise<void> {
    const git = await this.getGitInstance()
    const targetBranch = branch || this.config.defaultBranch || 'main'
    
    try {
      await git.pull('origin', targetBranch)
    } catch (error) {
      throw new Error(`拉取远程变更失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 核心Git操作封装 - 添加所有变更
   */
  public async gitAddAll(): Promise<void> {
    const git = await this.getGitInstance()
    
    try {
      await git.add('.')
    } catch (error) {
      throw new Error(`添加文件到暂存区失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 核心Git操作封装 - 提交变更
   */
  public async gitCommit(message: string): Promise<void> {
    const git = await this.getGitInstance()
    
    try {
      // Check if there are changes to commit
      const status = await git.status()
      if (status.files.length === 0) {
        throw new Error('没有变更需要提交')
      }
      
      await git.commit(message)
    } catch (error) {
      throw new Error(`提交变更失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 核心Git操作封装 - 推送到远程
   */
  public async gitPush(branch?: string): Promise<void> {
    const git = await this.getGitInstance()
    const targetBranch = branch || this.config.defaultBranch || 'main'
    
    try {
      await git.push('origin', targetBranch)
    } catch (error) {
      throw new Error(`推送到远程仓库失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 核心Git操作封装 - 获取状态
   */
  public async gitStatus(): Promise<any> {
    const git = await this.getGitInstance()
    
    try {
      return await git.status()
    } catch (error) {
      throw new Error(`获取Git状态失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 核心Git操作封装 - 获取远程变更
   */
  public async gitFetch(): Promise<void> {
    const git = await this.getGitInstance()
    
    try {
      await git.fetch()
    } catch (error) {
      throw new Error(`获取远程变更失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 生成提交信息
   */
  private generateCommitMessage(): string {
    const template = this.config.commitMessageTemplate || 'Sync snippets: {timestamp}'
    const timestamp = new Date().toISOString()
    return template.replace('{timestamp}', timestamp)
  }

  /**
   * 计算字符串的哈希值 (Generic, can be kept)
   */
  private calculateHash(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
  }

  /**
   * 将代码片段转换为JSON字符串
   */
  private snippetToJson(snippet: CodeSnippet): string {
    return JSON.stringify(snippet, null, 2)
  }

  /**
   * 从JSON字符串解析代码片段
   */
  private jsonToSnippet(json: string): CodeSnippet {
    return JSON.parse(json)
  }

  /**
   * 检测本地变更 (Will be heavily refactored for Git)
   */
  public async detectLocalChanges(currentSnippets: CodeSnippet[], currentDirectories: Directory[]): Promise<any> { // ChangeSet type removed
    console.warn('detectLocalChanges needs reimplementation for Git')
    return { addedFiles: [], modifiedFiles: [], deletedFiles: [], addedDirectories: [], deletedDirectories: [] } // Placeholder
  }

  /**
   * 检查云端是否有更新 (Will be heavily refactored for Git - git fetch / git status)
   */
  public async checkRemoteUpdates(): Promise<{
    hasUpdates: boolean
  }> {
    if (!this.isConfigured()) {
      throw new Error('云端同步未配置')
    }
    console.warn('checkRemoteUpdates needs reimplementation for Git')
    return { hasUpdates: false } // Placeholder
  }

  /**
   * 执行完整同步（智能检测是否需要初始化）(Will be heavily refactored for Git)
   */
  public async performSync(currentSnippets: CodeSnippet[], currentDirectories: Directory[]): Promise<SyncResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: '云端同步未配置',
      }
    }

    if (ContextManager.isEditingSnippet()) {
      return {
        success: false,
        message: '用户正在编辑代码片段，无法进行同步',
      }
    }

    const status = SettingsManager.getCloudSyncStatus() // This status object might change
    status.isSyncing = true
    await SettingsManager.saveCloudSyncStatus(status)

    try {
      console.log('开始云端同步 (Git)...')

      const localChanges = await this.detectLocalChanges(currentSnippets, currentDirectories)
      const hasLocalChanges = this.hasChanges(localChanges) // hasChanges might need adjustment based on new localChanges structure

      const remoteCheck = await this.checkRemoteUpdates()

      console.log(`本地变更: ${hasLocalChanges}, 远端更新: ${remoteCheck.hasUpdates}`)

      if (!hasLocalChanges && !remoteCheck.hasUpdates) {
        const status = SettingsManager.getCloudSyncStatus()
        status.lastSyncTime = Date.now()
        status.lastError = null
        await SettingsManager.saveCloudSyncStatus(status)
        return { success: true, message: '没有需要同步的变更，同步时间已更新' }
      }

      if (hasLocalChanges && !remoteCheck.hasUpdates) {
        console.warn('Push logic to be implemented for Git')
      } else if (!hasLocalChanges && remoteCheck.hasUpdates) {
        console.warn('Pull logic to be implemented for Git')
      } else {
        console.warn('Conflict handling to be implemented for Git')
      }
      return { success: false, message: 'Sync logic not yet implemented for Git.'} // Placeholder
    } catch (error) {
      console.error('同步失败:', error)
      const status = SettingsManager.getCloudSyncStatus()
      status.isSyncing = false
      status.lastError = error instanceof Error ? error.message : '未知错误'
      await SettingsManager.saveCloudSyncStatus(status)
      return { success: false, message: `同步失败: ${error instanceof Error ? error.message : '未知错误'}` }
    } finally {
      const status = SettingsManager.getCloudSyncStatus()
      status.isSyncing = false
      await SettingsManager.saveCloudSyncStatus(status)
    }
  }

  /**
   * 检查变更集是否包含变更 (May need adjustment based on new localChanges structure)
   */
  private hasChanges(changeSet: any): boolean { // ChangeSet type removed
    return (
      changeSet.addedFiles.length > 0 ||
      changeSet.modifiedFiles.length > 0 ||
      changeSet.deletedFiles.length > 0 ||
      changeSet.addedDirectories.length > 0 ||
      changeSet.deletedDirectories.length > 0
    )
  }

  /**
   * 推送本地变更到云端 (Will be heavily refactored for Git - git add, commit, push)
   */
  private async pushLocalChanges(
    changeSet: any, // ChangeSet type removed
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[]
  ): Promise<SyncResult> {
    console.warn('pushLocalChanges needs reimplementation for Git')
    return { success: false, message: 'Push logic not yet implemented for Git.'} // Placeholder
  }

  /**
   * 从云端拉取变更 (Will be heavily refactored for Git - git pull)
   */
  private async pullRemoteChanges(
  ): Promise<SyncResult> {
    console.warn('pullRemoteChanges needs reimplementation for Git')
    return { success: false, message: 'Pull logic not yet implemented for Git.'} // Placeholder
  }

  /**
   * 处理冲突 (Will be heavily refactored for Git conflicts)
   */
  private async handleConflicts(
    localChanges: any, // ChangeSet type removed
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[]
  ): Promise<SyncResult> {
    console.warn('handleConflicts needs reimplementation for Git')
    return { success: false, message: 'Conflict handling not yet implemented for Git.'} // Placeholder
  }

  /**
   * 检测并解决冲突 (S3 specific, will be replaced by Git conflict markers and user resolution)
   */
  private async detectAndResolveConflicts(
    localChanges: any, // ChangeSet type removed
    currentSnippets: CodeSnippet[],
    currentDirectories: Directory[]
  ): Promise<MergeResult[]> { // MergeResult might be reused if applicable to Git diffs
    console.warn('detectAndResolveConflicts (S3 specific) needs replacement for Git.')
    return [] // Placeholder
  }

  /**
   * 清空本地代码库 (May be adapted to clear local Git repo or reset it)
   */
  private async clearLocalCodebase(): Promise<void> {
    if (!this.storageManager) {
      throw new Error('StorageManager 未初始化')
    }
    console.log('清空本地代码库 (to be adapted for Git)...')
    try {
      const [snippets, directories] = await Promise.all([
        this.storageManager.getAllSnippets(),
        this.storageManager.getAllDirectories(),
      ])
      for (const snippet of snippets) {
        await this.storageManager.deleteSnippet(snippet.id)
      }
      console.log(`已删除 ${snippets.length} 个代码片段 (from StorageManager)`)
      const sortedDirs = directories.sort((a: Directory, b: Directory) => {
        return (b.name || '').localeCompare(a.name || '') // Placeholder sort
      })
      for (const directory of sortedDirs) {
        await this.storageManager.deleteDirectory(directory.id)
      }
      console.log(`已删除 ${directories.length} 个目录 (from StorageManager)`)
      if (this.storageManager.clearCache) {
        this.storageManager.clearCache()
      }
      console.log('本地代码库清空完成 (StorageManager based)')
    } catch (error) {
      console.error('清空本地代码库失败:', error)
      throw error
    }
  }
}
