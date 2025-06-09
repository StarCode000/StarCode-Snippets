import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { simpleGit, SimpleGit, CleanOptions } from 'simple-git'
import { CloudSyncConfig } from '../../types/types'
import { SettingsManager } from '../settingsManager'
import { GitOperationResult } from '../../types/syncTypes'

/**
 * Git操作管理器
 * 负责所有基础的Git仓库操作，包括初始化、配置、提交、推送、拉取等
 */
export class GitOperationsManager {
  private git: SimpleGit | null = null
  private config: CloudSyncConfig

  constructor(config: CloudSyncConfig) {
    this.config = config
  }

  /**
   * 更新配置
   */
  public updateConfig(newConfig: CloudSyncConfig): void {
    this.config = newConfig
    this.git = null // 重置Git客户端，使用新配置重新初始化
  }

  /**
   * 获取Git实例，如果不存在则创建
   */
  public async getGitInstance(): Promise<SimpleGit> {
    if (!this.git) {
      this.git = await this.initOrOpenLocalRepo()
      await this.configureRemote(this.git)
    }
    return this.git
  }

  /**
   * 初始化或打开本地Git仓库
   */
  private async initOrOpenLocalRepo(): Promise<SimpleGit> {
    // 获取有效的本地路径，优先使用配置的路径，否则使用默认路径
    const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()

    // 确保目录存在
    if (!fs.existsSync(effectiveLocalPath)) {
      fs.mkdirSync(effectiveLocalPath, { recursive: true })
    }

    const git = simpleGit(effectiveLocalPath)

    // 检查是否已经是Git仓库
    const isRepo = await git.checkIsRepo()
    
    if (!isRepo) {
      await this.initializeNewRepository(git, effectiveLocalPath)
    } else {
      await this.validateExistingRepository(git)
    }

    return git
  }

  /**
   * 初始化新的Git仓库
   */
  private async initializeNewRepository(git: SimpleGit, repoPath: string): Promise<void> {
    // 获取目标分支名
    const targetBranch = this.config.defaultBranch || 'main'
    
    // 初始化仓库
    await git.init()
    
    // 尝试设置默认分支名（如果Git版本支持）
    try {
      await git.raw(['config', 'init.defaultBranch', targetBranch])
    } catch (defaultBranchError) {
      console.warn('设置默认分支失败（可能是Git版本较旧）:', defaultBranchError)
    }
    
    // 设置用户配置
    try {
      await git.addConfig('user.name', 'StarCode Snippets')
      await git.addConfig('user.email', 'starcode-snippets@local')
    } catch (error) {
      console.warn('设置Git用户配置失败:', error)
    }
    
    // 创建初始分支
    await this.createInitialBranch(git, repoPath, targetBranch)
  }

  /**
   * 创建初始分支
   */
  private async createInitialBranch(git: SimpleGit, repoPath: string, targetBranch: string): Promise<void> {
    try {
      const branches = await git.branchLocal()
      if (branches.all.length === 0) {
        // 创建一个.gitkeep文件以便有内容可提交
        const gitkeepPath = path.join(repoPath, '.gitkeep')
        if (!fs.existsSync(gitkeepPath)) {
          fs.writeFileSync(gitkeepPath, '# StarCode Snippets Repository\n')
        }
        
        await git.add('.gitkeep')
        await git.commit('Initial commit for StarCode Snippets')
        
        // 如果当前不在目标分支，创建并切换到目标分支
        const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']).catch(() => 'HEAD')
        if (currentBranch !== targetBranch && currentBranch !== 'HEAD') {
          await git.checkoutLocalBranch(targetBranch)
        }
      }
    } catch (error) {
      console.warn('创建初始分支失败:', error)
      // 继续执行，后续同步时会处理
    }
  }

  /**
   * 验证现有仓库
   */
  private async validateExistingRepository(git: SimpleGit): Promise<void> {
    try {
      const branches = await git.branchLocal()
      const targetBranch = this.config.defaultBranch || 'main'
      
      if (branches.all.length > 0) {
        const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']).catch(() => null)
        
        // 如果目标分支不存在但有其他分支，记录警告
        if (!branches.all.includes(targetBranch) && branches.all.length > 0) {
          console.warn(`警告: 目标分支 ${targetBranch} 不存在，当前分支: ${currentBranch}`)
          console.warn('将在同步过程中处理分支切换')
        }
      }
    } catch (error) {
      console.warn('验证现有仓库失败:', error)
    }
  }

  /**
   * 配置远程仓库
   */
  private async configureRemote(git: SimpleGit): Promise<void> {
    if (!this.config.repositoryUrl) {
      throw new Error('仓库URL未配置')
    }

    try {
      const remotes = await git.getRemotes(true)
      const origin = remotes.find(remote => remote.name === 'origin')

      let effectiveUrl = this.config.repositoryUrl
      
      // 如果使用Token认证，需要将Token嵌入URL
      if (this.config.authenticationMethod === 'token' && this.config.token) {
        effectiveUrl = this.embedTokenInUrl(this.config.repositoryUrl, this.config.token)
      }

      if (origin) {
        // 更新现有的origin远程仓库
        if (origin.refs?.fetch !== effectiveUrl) {
          await git.removeRemote('origin')
          await git.addRemote('origin', effectiveUrl)
        }
      } else {
        // 添加新的origin远程仓库
        await git.addRemote('origin', effectiveUrl)
      }
    } catch (error) {
      throw new Error(`配置远程仓库失败: ${error}`)
    }
  }

  /**
   * 将Token嵌入到URL中
   */
  private embedTokenInUrl(url: string, token: string): string {
    try {
      const urlObj = new URL(url)
      
      // 检查是否已经包含认证信息
      if (urlObj.username || urlObj.password) {
        return url // 已经有认证信息，直接返回
      }
      
      // 根据不同平台使用不同的Token格式
      if (this.config.provider === 'github') {
        urlObj.username = token
        urlObj.password = 'x-oauth-basic'
      } else if (this.config.provider === 'gitlab') {
        urlObj.username = 'oauth2'
        urlObj.password = token
      } else if (this.config.provider === 'gitee') {
        // Gitee认证：使用测试中验证有效的oauth2方式
        urlObj.username = 'oauth2'
        urlObj.password = token
      } else {
        // 默认格式
        urlObj.username = token
      }
      
      return urlObj.toString()
    } catch (error) {
      console.warn('URL Token嵌入失败，使用原始URL:', error)
      return url
    }
  }

  /**
   * 执行Git拉取操作（完整的原始逻辑）
   */
  public async gitPull(branch?: string): Promise<void> {
    const git = await this.getGitInstance()
    const targetBranch = branch || this.config.defaultBranch || 'main'
    
    try {
      // 先检查本地状态
      const status = await git.status()
      const hasUncommittedChanges = status.files.length > 0
      
      if (hasUncommittedChanges) {
        // 检测到未提交的本地更改，使用智能合并策略
        
        // 暂存当前更改
        await git.stash(['push', '-m', 'Auto-stash before sync'])
        
        try {
          // 拉取远程更改
          await git.pull('origin', targetBranch)
          
          // 尝试恢复暂存的更改
          try {
            await git.stash(['pop'])
          } catch (stashPopError) {
            // 如果恢复暂存时发生冲突，需要手动处理
            const stashErrorMsg = stashPopError instanceof Error ? stashPopError.message : '未知错误'
            if (stashErrorMsg.includes('conflict') || stashErrorMsg.includes('CONFLICT')) {
              throw new Error(`合并冲突：本地更改与远程更改存在冲突。请手动解决冲突后重新同步。\n\n详细信息：${stashErrorMsg}`)
            }
            throw stashPopError
          }
        } catch (pullError) {
          const pullErrorMessage = pullError instanceof Error ? pullError.message : '未知错误'
          
          // 处理 "refusing to merge unrelated histories" 错误
          if (pullErrorMessage.includes('refusing to merge unrelated histories')) {
            try {
              // 使用 --allow-unrelated-histories 选项重新拉取
              await git.pull('origin', targetBranch, ['--allow-unrelated-histories'])
              
              // 拉取成功后，尝试恢复暂存的更改
              try {
                await git.stash(['pop'])
              } catch (stashPopError) {
                const stashErrorMsg = stashPopError instanceof Error ? stashPopError.message : '未知错误'
                if (stashErrorMsg.includes('conflict') || stashErrorMsg.includes('CONFLICT')) {
                  throw new Error(`合并冲突：本地更改与远程更改存在冲突。请手动解决冲突后重新同步。\n\n详细信息：${stashErrorMsg}`)
                }
                throw stashPopError
              }
              return // 成功处理，退出函数
            } catch (retryError) {
              // 如果重试也失败，恢复暂存的更改
              try {
                await git.stash(['pop'])
              } catch (restoreError) {
                console.warn('恢复本地更改失败:', restoreError)
              }
              
              const retryErrorMessage = retryError instanceof Error ? retryError.message : '未知错误'
              
              // 询问用户是否要重新初始化仓库
              const shouldReinitialize = await vscode.window.showErrorMessage(
                `Git历史冲突无法自动解决。这通常发生在本地仓库和远程仓库有不同的提交历史时。\n\n原始错误: ${pullErrorMessage}\n重试错误: ${retryErrorMessage}`,
                { modal: true },
                '重新初始化仓库',
                '取消'
              )
              
              if (shouldReinitialize === '重新初始化仓库') {
                const reinitResult = await this.reinitializeRepository()
                
                if (reinitResult.success) {
                  // 重新初始化成功，显示成功消息
                  vscode.window.showInformationMessage(reinitResult.message)
                  return // 成功处理，退出函数
                } else {
                  throw new Error(`重新初始化失败: ${reinitResult.message}`)
                }
              } else {
                throw new Error(`拉取远程变更失败: 用户取消了重新初始化操作。\n\n建议：\n1. 检查远程仓库是否正确\n2. 手动删除本地仓库目录后重新同步\n3. 或者联系技术支持`)
              }
            }
          }
          
          // 如果不是 unrelated histories 错误，恢复暂存的更改并抛出原始错误
          try {
            await git.stash(['pop'])
          } catch (restoreError) {
            console.warn('恢复本地更改失败:', restoreError)
          }
          throw pullError
        }
      } else {
        // 没有本地更改，直接拉取
        await git.pull('origin', targetBranch)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      
      // 处理 "refusing to merge unrelated histories" 错误
      if (errorMessage.includes('refusing to merge unrelated histories')) {
        try {
          // 使用 --allow-unrelated-histories 选项重新拉取
          await git.pull('origin', targetBranch, ['--allow-unrelated-histories'])
          return
        } catch (retryError) {
          const retryErrorMessage = retryError instanceof Error ? retryError.message : '未知错误'
          
          // 询问用户是否要重新初始化仓库
          const shouldReinitialize = await vscode.window.showErrorMessage(
            `Git历史冲突无法自动解决。这通常发生在本地仓库和远程仓库有不同的提交历史时。\n\n原始错误: ${errorMessage}\n重试错误: ${retryErrorMessage}`,
            { modal: true },
            '重新初始化仓库',
            '取消'
          )
          
          if (shouldReinitialize === '重新初始化仓库') {
            const reinitResult = await this.reinitializeRepository()
            
            if (reinitResult.success) {
              // 重新初始化成功，显示成功消息
              vscode.window.showInformationMessage(reinitResult.message)
              return // 成功处理，退出函数
            } else {
              throw new Error(`重新初始化失败: ${reinitResult.message}`)
            }
          } else {
            throw new Error(`拉取远程变更失败: 用户取消了重新初始化操作。\n\n建议：\n1. 检查远程仓库是否正确\n2. 手动删除本地仓库目录后重新同步\n3. 或者联系技术支持`)
          }
        }
      }
      
      throw new Error(`拉取远程变更失败: ${errorMessage}`)
    }
  }

  /**
   * 添加所有更改到暂存区
   */
  public async gitAddAll(): Promise<void> {
    const git = await this.getGitInstance()
    try {
      await git.add('.')
    } catch (error) {
      throw new Error(`添加文件到暂存区失败: ${error}`)
    }
  }

  /**
   * 提交更改
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
   * 推送到远程仓库
   */
  public async gitPush(branch?: string): Promise<void> {
    const git = await this.getGitInstance()
    const targetBranch = branch || this.config.defaultBranch || 'main'
    
    try {
      await git.push('origin', targetBranch)
    } catch (error) {
      throw new Error(`推送失败: ${error}`)
    }
  }

  /**
   * 获取Git状态
   */
  public async gitStatus(): Promise<any> {
    const git = await this.getGitInstance()
    try {
      return await git.status()
    } catch (error) {
      throw new Error(`获取状态失败: ${error}`)
    }
  }

  /**
   * 获取远程更新
   */
  public async gitFetch(): Promise<void> {
    const git = await this.getGitInstance()
    try {
      await git.fetch()
    } catch (error) {
      throw new Error(`获取远程更新失败: ${error}`)
    }
  }

  /**
   * 重新初始化仓库
   */
  public async reinitializeRepository(): Promise<GitOperationResult> {
    try {
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      
      // 删除现有的.git目录
      const gitDir = path.join(effectiveLocalPath, '.git')
      if (fs.existsSync(gitDir)) {
        await this.deleteDirectory(gitDir)
      }
      
      // 重置Git客户端
      this.git = null
      
      // 重新初始化
      await this.getGitInstance()
      
      return {
        success: true,
        message: '仓库重新初始化成功'
      }
    } catch (error) {
      return {
        success: false,
        message: `重新初始化失败: ${error}`
      }
    }
  }

  /**
   * 删除目录的辅助方法
   */
  private async deleteDirectory(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      return
    }

    const items = fs.readdirSync(dirPath)
    for (const item of items) {
      const itemPath = path.join(dirPath, item)
      const stat = fs.statSync(itemPath)
      
      if (stat.isDirectory()) {
        await this.deleteDirectory(itemPath)
      } else {
        fs.unlinkSync(itemPath)
      }
    }
    
    fs.rmdirSync(dirPath)
  }

  /**
   * 检查远程仓库状态（来自原始performSync）
   */
  public async checkRemoteRepositoryStatus(targetBranch: string): Promise<{ isRemoteEmpty: boolean; remotePullSuccess: boolean; remoteHasData: boolean }> {
    let isRemoteEmpty = false
    let remotePullSuccess = false
    let remoteHasData = false

    try {
      const git = await this.getGitInstance()
      
      // 首先检查远程是否有分支
      const remoteRefs = await git.listRemote(['--heads', 'origin'])
      isRemoteEmpty = !remoteRefs || remoteRefs.trim() === ''
      
      if (!isRemoteEmpty) {
        // 远程不为空，尝试拉取并检查是否有数据
        try {
          await this.gitPull()
          remotePullSuccess = true
          
          // 拉取成功后，检查是否有实际的代码片段数据
          // 注意：这里需要FileSystemManager来读取数据，但为了避免循环依赖，
          // 我们只检查基本的Git状态，具体的数据检查由调用方处理
          console.log('远程拉取成功，需要调用方检查数据内容')
          remoteHasData = true // 假设有数据，由调用方进一步验证
          
        } catch (pullError) {
          const errorMessage = pullError instanceof Error ? pullError.message : '未知错误'
          
          // Gitee特殊错误处理
          if (this.config.provider === 'gitee') {
            if (errorMessage.includes('could not read Username') || 
                errorMessage.includes('Authentication failed')) {
              throw new Error(`Gitee认证失败！\n\n可能原因：\n• Token格式不正确或已过期\n• Gitee API限制\n\n建议：\n1. 重新生成并更新Token\n2. 如使用基于HTTPS的URL，尝试切换到SSH认证\n3. 检查Gitee仓库权限设置`)
            }
          }
          
          if (errorMessage.includes('couldn\'t find remote ref') || 
              errorMessage.includes('does not exist') ||
              errorMessage.includes('no upstream branch')) {
            console.log('远程分支不存在，将执行首次推送')
            remotePullSuccess = false
          } else {
            // 检查是否是合并冲突
            try {
              const gitStatus = await this.gitStatus()
              if (gitStatus.conflicted && gitStatus.conflicted.length > 0) {
                throw new Error(`检测到Git合并冲突：${gitStatus.conflicted.join(', ')}`)
              }
            } catch (statusError) {
              console.warn('检查Git状态失败:', statusError)
            }
            throw pullError
          }
        }
      }
    } catch (remoteCheckError) {
      console.warn('检查远程仓库状态失败:', remoteCheckError)
      // 如果无法检查远程状态，假设为首次推送
      isRemoteEmpty = true
    }

    return { isRemoteEmpty, remotePullSuccess, remoteHasData }
  }

  /**
   * 检查远程是否有更新
   */
  public async checkRemoteUpdates(): Promise<{ hasUpdates: boolean; details: string }> {
    try {
      const git = await this.getGitInstance()
      
      // 首先执行fetch获取远程最新信息
      await this.gitFetch()
      
      // 检查本地分支和远程分支的差异
      const currentBranch = this.config.defaultBranch || 'main'
      
      try {
        const logOutput = await git.log(['HEAD..origin/' + currentBranch])
        
        if (logOutput.total > 0) {
          return {
            hasUpdates: true,
            details: `远程有 ${logOutput.total} 个新提交需要拉取`
          }
        }
        
        return {
          hasUpdates: false,
          details: '远程没有新的更新'
        }
      } catch (logError) {
        console.warn('检查远程更新时出现错误:', logError)
        return {
          hasUpdates: false,
          details: '远程分支可能不存在，将执行首次推送'
        }
      }
      
    } catch (error) {
      console.error('检查远程更新失败:', error)
      throw new Error(`检查远程更新失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 生成提交消息
   */
  public generateCommitMessage(): string {
    const template = this.config.commitMessageTemplate || 'Sync snippets: {timestamp}'
    const timestamp = new Date().toISOString()
    return template.replace('{timestamp}', timestamp)
  }

  /**
   * 重置到远程分支
   */
  public async resetToRemote(branch?: string): Promise<GitOperationResult> {
    try {
      const git = await this.getGitInstance()
      const targetBranch = branch || this.config.defaultBranch || 'main'
      
      // 首先获取远程更新
      await git.fetch('origin')
      
      // 检查远程分支是否存在
      const remoteBranches = await git.branch(['--remote'])
      const remoteHasBranch = remoteBranches.all.some(branch => 
        branch.includes(`origin/${targetBranch}`)
      )
      
      if (!remoteHasBranch) {
        return {
          success: false,
          message: `远程分支 origin/${targetBranch} 不存在`
        }
      }
      
      // 切换到目标分支（如果需要）
      const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']).catch(() => null)
      if (currentBranch !== targetBranch) {
        try {
          await git.checkout(targetBranch)
        } catch (checkoutError) {
          // 如果本地分支不存在，创建新分支
          await git.checkoutBranch(targetBranch, `origin/${targetBranch}`)
        }
      }
      
      // 硬重置到远程分支
      await git.reset(['--hard', `origin/${targetBranch}`])
      
      // 清理未跟踪的文件
      await git.clean(CleanOptions.FORCE)
      
      return {
        success: true,
        message: `成功重置到远程分支 origin/${targetBranch}`
      }
      
    } catch (error) {
      return {
        success: false,
        message: `重置到远程分支失败: ${error}`
      }
    }
  }
} 