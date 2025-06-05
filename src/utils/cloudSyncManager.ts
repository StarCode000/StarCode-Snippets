import * as vscode from 'vscode'
import { CloudSyncConfig, CloudSyncStatus, CodeSnippet, Directory } from '../types/types'
import { SettingsManager } from './settingsManager'
import { ContextManager } from './contextManager'
import { TempFilesCleaner } from './cleanupTempFiles'
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
  public async updateConfig(newConfig: CloudSyncConfig): Promise<{ platformChanged: boolean; needsAttention: boolean; message?: string }> {
    const oldConfig = this.config
    this.config = newConfig
    this.git = null // Reset git client to reinitialize with new config
    
    // 检查是否发生了平台变更
    const platformChanged = oldConfig.provider !== newConfig.provider || 
                           oldConfig.repositoryUrl !== newConfig.repositoryUrl
    
    if (!platformChanged) {
      return { platformChanged: false, needsAttention: false }
    }
    
    // 如果平台发生变更，检查是否有现有的Git仓库
    try {
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      const hasGitRepo = fs.existsSync(effectiveLocalPath) && 
                        fs.existsSync(path.join(effectiveLocalPath, '.git'))
      
      if (hasGitRepo) {
        // 有现有仓库，需要用户注意
        return {
          platformChanged: true,
          needsAttention: true,
          message: `检测到Git平台变更：${oldConfig.provider || '未知'} → ${newConfig.provider}。\n建议使用"切换Git平台"命令来妥善处理现有数据。`
        }
      } else {
        // 没有现有仓库，可以直接使用新配置
        return {
          platformChanged: true,
          needsAttention: false,
          message: `已切换到新的Git平台：${newConfig.provider}`
        }
      }
    } catch (error) {
      console.warn('检查Git仓库状态失败:', error)
      return {
        platformChanged: true,
        needsAttention: true,
        message: '配置已更新，但无法确定现有Git仓库状态。建议检查同步设置。'
      }
    }
  }

  /**
   * 检查是否已配置Git同步
   */
  public isConfigured(): boolean {
    return !!(
      this.config.provider &&
      this.config.repositoryUrl &&
      (this.config.authenticationMethod === 'ssh' || this.config.token)
    )
    // 注意：不再检查 localPath，因为系统会自动提供默认路径
  }

  /**
   * 初始化或打开本地Git仓库
   */
  private async initOrOpenLocalRepo(): Promise<SimpleGit> {
    // 获取有效的本地路径，优先使用配置的路径，否则使用默认路径
    const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()

    // Ensure the directory exists
    if (!fs.existsSync(effectiveLocalPath)) {
      fs.mkdirSync(effectiveLocalPath, { recursive: true })
    }

    const git = simpleGit(effectiveLocalPath)

    // Check if it's already a git repository
    const isRepo = await git.checkIsRepo()
    
    if (!isRepo) {
      // console.log('Initializing new Git repository...')
      
      // 获取目标分支名
      const targetBranch = this.config.defaultBranch || 'main'
      
      // 初始化仓库并设置默认分支
      await git.init()
      
      // 尝试设置默认分支名（如果Git版本支持）
      try {
        await git.raw(['config', 'init.defaultBranch', targetBranch])
        // console.log(`设置默认分支为: ${targetBranch}`)
      } catch (defaultBranchError) {
        console.warn('设置默认分支失败（可能是Git版本较旧）:', defaultBranchError)
      }
      
      // Set up user configuration if not set
      try {
        await git.addConfig('user.name', 'StarCode Snippets')
        await git.addConfig('user.email', 'starcode-snippets@local')
      } catch (error) {
        console.warn('Failed to set git user config:', error)
      }
      
      // 检查是否需要创建初始分支
      try {
        const branches = await git.branchLocal()
        if (branches.all.length === 0) {
          // console.log(`创建初始分支: ${targetBranch}`)
          // 创建一个初始的空提交来建立分支
          try {
            // 创建一个.gitkeep文件以便有内容可提交
            const gitkeepPath = path.join(effectiveLocalPath, '.gitkeep')
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
            
            // console.log(`初始分支 ${targetBranch} 创建成功`)
          } catch (initialCommitError) {
            console.warn('创建初始提交失败:', initialCommitError)
            // 如果创建初始提交失败，继续执行，后续同步时会处理
          }
        }
      } catch (branchCheckError) {
        console.warn('检查分支状态失败:', branchCheckError)
      }
    } else {
      // console.log('打开现有Git仓库...')
      
      // 检查现有仓库的分支状态
      try {
        const branches = await git.branchLocal()
        const targetBranch = this.config.defaultBranch || 'main'
        
        // console.log(`现有仓库分支: ${branches.all.join(', ')}`)
        // console.log(`目标分支: ${targetBranch}`)
        
        if (branches.all.length > 0) {
          const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']).catch(() => null)
          // console.log(`当前分支: ${currentBranch}`)
          
          // 如果目标分支不存在但有其他分支，提醒用户
          if (!branches.all.includes(targetBranch) && branches.all.length > 0) {
            console.warn(`警告: 目标分支 ${targetBranch} 不存在，当前分支: ${currentBranch}`)
            console.warn('将在同步过程中处理分支切换')
          }
        }
      } catch (branchInfoError) {
        console.warn('获取现有仓库分支信息失败:', branchInfoError)
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

      // 对于所有平台，统一使用URL嵌入token的方式
      if (this.config.authenticationMethod === 'token' && this.config.token) {
        remoteUrl = this.embedTokenInUrl(this.config.repositoryUrl, this.config.token)
        // console.log(`配置 ${this.config.provider} 认证完成`)
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
        // Gitee认证：使用测试中验证有效的oauth2方式
        urlObj.username = 'oauth2'
        urlObj.password = token
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

      // console.log('Testing Git connection...')
      
      // 为Gitee配置特殊处理
      if (this.config.provider === 'gitee' && this.config.authenticationMethod === 'token') {
        // console.log('使用Gitee特殊认证方式测试连接...')
        
        try {
          // 为Gitee使用特殊的连接测试方法
          return await this.testGiteeConnection();
        } catch (giteeError) {
          const errorMessage = giteeError instanceof Error ? giteeError.message : '未知错误';
          return {
            success: false,
            message: `Gitee连接测试失败: ${errorMessage}\n\n建议：\n1. 检查令牌是否有效\n2. 确认仓库地址格式是否正确\n3. 尝试使用SSH认证方式`
          };
        }
      }
      
      const git = await this.getGitInstance()
      
      // 首先测试远程仓库的可访问性
      try {
        await git.listRemote(['--heads', 'origin'])
        // console.log('远程仓库可访问')
        
        // 检查远程是否有分支
        const remoteBranches = await git.listRemote(['--heads', 'origin'])
        if (!remoteBranches || remoteBranches.trim() === '') {
          return {
            success: true,
            message: `成功连接到 ${this.config.provider} 仓库！\n\n⚠️ 注意：这是一个空仓库（没有任何分支）。\n首次同步时，系统会自动创建 '${this.config.defaultBranch || 'main'}' 分支并推送您的代码片段。`,
          }
        }
        
        // 仓库不为空，尝试获取指定分支
        const targetBranch = this.config.defaultBranch || 'main'
        try {
          await git.fetch('origin', targetBranch)
          return {
            success: true,
            message: `成功连接到 ${this.config.provider} 仓库！\n远程分支 '${targetBranch}' 存在，可以进行同步。`,
          }
        } catch (branchError) {
          // 分支不存在，但仓库可访问
          const branchErrorMsg = branchError instanceof Error ? branchError.message : '未知错误'
          if (branchErrorMsg.includes('couldn\'t find remote ref') || 
              branchErrorMsg.includes('does not exist')) {
            return {
              success: true,
              message: `成功连接到 ${this.config.provider} 仓库！\n\n⚠️ 注意：远程分支 '${targetBranch}' 不存在。\n首次同步时，系统会自动创建该分支并推送您的代码片段。`,
            }
          }
          throw branchError
        }
        
      } catch (remoteError) {
        const errorMessage = remoteError instanceof Error ? remoteError.message : '未知错误'
        
        // Gitee特有的错误处理
        if (this.config.provider === 'gitee') {
          if (errorMessage.includes('could not read Username')) {
            return {
              success: false,
              message: `Gitee认证失败！可能原因：\n• Token格式不正确\n• 需要提供用户名和密码（Gitee特性）\n\n请尝试：\n1. 确认Token是否有效\n2. 在Gitee设置中重新生成Token\n3. 如需使用密码认证，请选择SSH认证方式`,
            }
          }
        }
        
        // 分析错误类型并提供具体的解决建议
        if (errorMessage.includes('Authentication failed') || 
            errorMessage.includes('invalid username or password') ||
            errorMessage.includes('bad credentials')) {
          return {
            success: false,
            message: `认证失败！请检查：\n• Token 是否正确\n• Token 是否有相应的仓库权限\n• 仓库URL是否正确\n\n错误详情: ${errorMessage}`,
          }
        }
        
        if (errorMessage.includes('Repository not found') || 
            errorMessage.includes('not found')) {
          return {
            success: false,
            message: `仓库不存在！请检查：\n• 仓库URL是否正确\n• 仓库是否为私有（需要相应权限）\n• Token是否有访问该仓库的权限\n\n错误详情: ${errorMessage}`,
          }
        }
        
        if (errorMessage.includes('Network') || 
            errorMessage.includes('timeout') || 
            errorMessage.includes('connection')) {
          return {
            success: false,
            message: `网络连接失败！请检查：\n• 网络连接是否正常\n• 是否需要代理设置\n• 防火墙是否阻止了连接\n\n错误详情: ${errorMessage}`,
          }
        }
        
        return {
          success: false,
          message: `连接失败: ${errorMessage}\n\n请检查配置是否正确，或查看控制台日志获取更多信息。`,
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
   * 专用于Gitee的连接测试方法
   * 使用直接HTTP请求方式测试令牌有效性和仓库访问权限
   */
  private async testGiteeConnection(): Promise<{ success: boolean; message: string }> {
    try {
      if (!this.config.token) {
        return {
          success: false,
          message: 'Gitee需要访问令牌才能连接'
        };
      }
      
      // 从仓库URL中提取所有者和仓库名
      const repoUrl = this.config.repositoryUrl;
      const urlMatch = repoUrl.match(/gitee\.com\/([\w-]+)\/([\w-]+)(\.git)?$/);
      
      if (!urlMatch) {
        return {
          success: false,
          message: `无效的Gitee仓库URL: ${repoUrl}\n\n正确格式应为: https://gitee.com/用户名/仓库名.git`
        };
      }
      
      const owner = urlMatch[1];
      const repo = urlMatch[2];
      
      // console.log(`尝试直接访问Gitee API验证仓库: ${owner}/${repo}`);
      
      // 使用Gitee API检查仓库状态
      const apiUrl = `https://gitee.com/api/v5/repos/${owner}/${repo}?access_token=${this.config.token}`;
      
      // 使用Node.js内置的https模块进行请求
      const https = require('https');
      const result = await new Promise<{ success: boolean; message: string }>((resolve, reject) => {
        const req = https.get(apiUrl, (res: any) => {
          let data = '';
          
          res.on('data', (chunk: any) => {
            data += chunk;
          });
          
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const repoInfo = JSON.parse(data);
                resolve({
                  success: true,
                  message: `成功连接到Gitee仓库: ${repoInfo.full_name || `${owner}/${repo}`}\n\n仓库描述: ${repoInfo.description || '无描述'}\n默认分支: ${repoInfo.default_branch || 'master'}`
                });
              } catch (parseError) {
                resolve({
                  success: true,
                  message: `成功连接到Gitee仓库: ${owner}/${repo}\n但无法解析仓库详情`
                });
              }
            } else if (res.statusCode === 404) {
              resolve({
                success: false,
                message: `仓库不存在或无权访问: ${owner}/${repo}\n\n请检查:\n• 仓库URL是否正确\n• 令牌是否有权限访问该仓库`
              });
            } else if (res.statusCode === 401 || res.statusCode === 403) {
              resolve({
                success: false,
                message: `Gitee认证失败 (${res.statusCode})。\n\n请检查:\n• 访问令牌是否有效\n• 令牌是否具有正确的权限\n• 令牌是否已过期`
              });
            } else {
              resolve({
                success: false,
                message: `Gitee API返回错误: ${res.statusCode}\n\n响应数据: ${data}`
              });
            }
          });
        });
        
        req.on('error', (error: any) => {
          reject(new Error(`Gitee API请求失败: ${error.message}`));
        });
        
        req.end();
      });
      
      return result;
    } catch (error) {
      console.error('Gitee连接测试失败:', error);
      throw error;
    }
  }

  /**
   * 核心Git操作封装 - 拉取远程变更
   */
  public async gitPull(branch?: string): Promise<void> {
    const git = await this.getGitInstance()
    const targetBranch = branch || this.config.defaultBranch || 'main'
    
    try {
      // 先检查本地状态
      const status = await git.status()
      const hasUncommittedChanges = status.files.length > 0
      
      if (hasUncommittedChanges) {
        // console.log('检测到未提交的本地更改，使用智能合并策略...')
        
        // 暂存当前更改
        await git.stash(['push', '-m', 'Auto-stash before sync'])
        // console.log('已暂存本地更改')
        
        try {
          // 拉取远程更改
          await git.pull('origin', targetBranch)
          // console.log('远程更改拉取成功')
          
          // 尝试恢复暂存的更改
          try {
            await git.stash(['pop'])
            // console.log('已恢复本地更改')
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
            // console.log('检测到不相关历史错误，尝试使用 --allow-unrelated-histories 选项...')
            
            try {
              // 使用 --allow-unrelated-histories 选项重新拉取
              await git.pull('origin', targetBranch, ['--allow-unrelated-histories'])
              // console.log('使用 --allow-unrelated-histories 选项拉取成功')
              
              // 拉取成功后，尝试恢复暂存的更改
              try {
                await git.stash(['pop'])
                // console.log('已恢复本地更改')
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
                // console.log('重试拉取失败，已恢复本地更改')
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
                 // console.log('用户选择重新初始化仓库')
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
            // console.log('拉取失败，已恢复本地更改')
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
        // console.log('检测到不相关历史错误，尝试使用 --allow-unrelated-histories 选项...')
        
        try {
          // 使用 --allow-unrelated-histories 选项重新拉取
          await git.pull('origin', targetBranch, ['--allow-unrelated-histories'])
          // console.log('使用 --allow-unrelated-histories 选项拉取成功')
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
             // console.log('用户选择重新初始化仓库')
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
   * 重新初始化本地仓库以解决历史冲突
   * 这会删除本地Git历史并重新从远程克隆
   */
  public async reinitializeRepository(): Promise<{ success: boolean; message: string }> {
    try {
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      
      // console.log('开始重新初始化本地仓库...')
      
      // 1. 备份当前的数据文件
      const backupDir = path.join(effectiveLocalPath, '.backup-' + Date.now())
      const snippetsFile = path.join(effectiveLocalPath, 'snippets.json')
      const directoriesFile = path.join(effectiveLocalPath, 'directories.json')
      
      let hasBackup = false
      if (fs.existsSync(snippetsFile) || fs.existsSync(directoriesFile)) {
        fs.mkdirSync(backupDir, { recursive: true })
        
        if (fs.existsSync(snippetsFile)) {
          fs.copyFileSync(snippetsFile, path.join(backupDir, 'snippets.json'))
        }
        if (fs.existsSync(directoriesFile)) {
          fs.copyFileSync(directoriesFile, path.join(backupDir, 'directories.json'))
        }
        hasBackup = true
        // console.log(`已备份现有数据到: ${backupDir}`)
      }
      
      // 2. 删除 .git 目录
      const gitDir = path.join(effectiveLocalPath, '.git')
      if (fs.existsSync(gitDir)) {
        await this.deleteDirectory(gitDir)
        // console.log('已删除现有Git历史')
      }
      
      // 3. 重新初始化Git仓库
      this.git = null // 重置Git实例
      const git = await this.getGitInstance() // 这会重新初始化仓库
      
      // 4. 尝试从远程拉取
      try {
        await git.pull('origin', this.config.defaultBranch || 'main')
        // console.log('成功从远程拉取数据')
        
        // 5. 清理备份（如果拉取成功）
        if (hasBackup && fs.existsSync(backupDir)) {
          await this.deleteDirectory(backupDir)
          // console.log('已清理备份文件')
        }
        
        return {
          success: true,
          message: '仓库重新初始化成功，已从远程同步最新数据'
        }
      } catch (pullError) {
        // console.log('从远程拉取失败，恢复备份数据...')
        
        // 6. 如果拉取失败，恢复备份数据
        if (hasBackup && fs.existsSync(backupDir)) {
          if (fs.existsSync(path.join(backupDir, 'snippets.json'))) {
            fs.copyFileSync(path.join(backupDir, 'snippets.json'), snippetsFile)
          }
          if (fs.existsSync(path.join(backupDir, 'directories.json'))) {
            fs.copyFileSync(path.join(backupDir, 'directories.json'), directoriesFile)
          }
          
          // 提交恢复的数据
          await git.add('.')
          await git.commit('Restore local data after reinitialize')
          
          await this.deleteDirectory(backupDir)
          // console.log('已恢复备份数据')
        }
        
        return {
          success: true,
          message: '仓库重新初始化成功，已恢复本地数据。建议手动检查远程仓库配置。'
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      console.error('重新初始化仓库失败:', errorMessage)
      
      return {
        success: false,
        message: `重新初始化仓库失败: ${errorMessage}`
      }
    }
  }

  /**
   * 递归删除目录
   */
  private async deleteDirectory(dirPath: string): Promise<void> {
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath)
      
      for (const file of files) {
        const filePath = path.join(dirPath, file)
        const stat = fs.statSync(filePath)
        
        if (stat.isDirectory()) {
          await this.deleteDirectory(filePath)
        } else {
          // 在Windows上，可能需要移除只读属性
          try {
            fs.chmodSync(filePath, 0o666)
          } catch (chmodError) {
            // 忽略权限错误
          }
          fs.unlinkSync(filePath)
        }
      }
      
      fs.rmdirSync(dirPath)
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
   * 将代码片段和目录数据写入Git仓库文件系统
   */
  private async writeDataToGitRepo(snippets: CodeSnippet[], directories: Directory[], updateTimestamp: boolean = true): Promise<void> {
    const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
    
    // 确保仓库目录存在
    if (!fs.existsSync(effectiveLocalPath)) {
      fs.mkdirSync(effectiveLocalPath, { recursive: true })
    }

    // 准备新的文件内容
    const newSnippetsContent = JSON.stringify(snippets, null, 2)
    const newDirectoriesContent = JSON.stringify(directories, null, 2)

    const snippetsFile = path.join(effectiveLocalPath, 'snippets.json')
    const directoriesFile = path.join(effectiveLocalPath, 'directories.json')
    const metadataFile = path.join(effectiveLocalPath, '.starcode-meta.json')

    // 检查代码片段文件是否需要更新
    let needUpdateSnippets = true
    if (fs.existsSync(snippetsFile)) {
      try {
        const existingSnippetsContent = fs.readFileSync(snippetsFile, 'utf8')
        needUpdateSnippets = existingSnippetsContent !== newSnippetsContent
      } catch (error) {
        needUpdateSnippets = true
      }
    }

    // 检查目录文件是否需要更新
    let needUpdateDirectories = true
    if (fs.existsSync(directoriesFile)) {
      try {
        const existingDirectoriesContent = fs.readFileSync(directoriesFile, 'utf8')
        needUpdateDirectories = existingDirectoriesContent !== newDirectoriesContent
      } catch (error) {
        needUpdateDirectories = true
      }
    }

    // 准备元数据
    let metadata: any = {
      version: '2.0.0',
      totalSnippets: snippets.length,
      totalDirectories: directories.length,
      syncMethod: 'git'
    }

    // 处理时间戳
    if (updateTimestamp) {
      metadata.lastSync = new Date().toISOString()
    } else {
      // 尝试读取现有的时间戳
      try {
        if (fs.existsSync(metadataFile)) {
          const existingMetadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'))
          metadata.lastSync = existingMetadata.lastSync || new Date().toISOString()
        } else {
          metadata.lastSync = new Date().toISOString()
        }
      } catch (error) {
        metadata.lastSync = new Date().toISOString()
      }
    }

    // 检查元数据文件是否需要更新
    const newMetadataContent = JSON.stringify(metadata, null, 2)
    let needUpdateMetadata = true
    if (fs.existsSync(metadataFile)) {
      try {
        const existingMetadataContent = fs.readFileSync(metadataFile, 'utf8')
        needUpdateMetadata = existingMetadataContent !== newMetadataContent
      } catch (error) {
        needUpdateMetadata = true
      }
    }

    // 只有在内容真正发生变化时才写入文件
    if (needUpdateSnippets) {
      fs.writeFileSync(snippetsFile, newSnippetsContent, 'utf8')
      // console.log(`更新了代码片段文件: ${snippets.length} 个片段`)
    }

    if (needUpdateDirectories) {
      fs.writeFileSync(directoriesFile, newDirectoriesContent, 'utf8')
      // console.log(`更新了目录文件: ${directories.length} 个目录`)
    }

    if (needUpdateMetadata) {
      fs.writeFileSync(metadataFile, newMetadataContent, 'utf8')
      // console.log(`更新了元数据文件`)
    }

    // 如果没有任何文件需要更新，记录日志
    if (!needUpdateSnippets && !needUpdateDirectories && !needUpdateMetadata) {
      // console.log('所有文件内容均无变化，跳过写入操作')
    }
  }

  /**
   * 从Git仓库文件系统读取代码片段和目录数据
   */
  private async readDataFromGitRepo(): Promise<{ snippets: CodeSnippet[]; directories: Directory[] }> {
    const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
    
    const snippetsFile = path.join(effectiveLocalPath, 'snippets.json')
    const directoriesFile = path.join(effectiveLocalPath, 'directories.json')

    let snippets: CodeSnippet[] = []
    let directories: Directory[] = []

    try {
      if (fs.existsSync(snippetsFile)) {
        const snippetsData = fs.readFileSync(snippetsFile, 'utf8')
        snippets = JSON.parse(snippetsData)
      }
    } catch (error) {
      console.warn('读取代码片段文件失败:', error)
    }

    try {
      if (fs.existsSync(directoriesFile)) {
        const directoriesData = fs.readFileSync(directoriesFile, 'utf8')
        directories = JSON.parse(directoriesData)
      }
    } catch (error) {
      console.warn('读取目录文件失败:', error)
    }

    // console.log(`从Git仓库读取 ${snippets.length} 个代码片段和 ${directories.length} 个目录`)
    return { snippets, directories }
  }

  /**
   * 检测本地变更 - 比较VSCode存储与Git仓库文件
   */
  public async detectLocalChanges(currentSnippets: CodeSnippet[], currentDirectories: Directory[]): Promise<{
    hasChanges: boolean;
    type: 'none' | 'local_only' | 'repo_only' | 'both_differ';
    details: string;
  }> {
    try {
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      
      // 检查Git仓库文件是否存在
      const snippetsFile = path.join(effectiveLocalPath, 'snippets.json')
      const directoriesFile = path.join(effectiveLocalPath, 'directories.json')
      
      const snippetsFileExists = fs.existsSync(snippetsFile)
      const directoriesFileExists = fs.existsSync(directoriesFile)

      // 如果Git仓库文件不存在，说明需要首次同步
      if (!snippetsFileExists || !directoriesFileExists) {
        return {
          hasChanges: currentSnippets.length > 0 || currentDirectories.length > 0,
          type: 'local_only',
          details: `本地有 ${currentSnippets.length} 个代码片段和 ${currentDirectories.length} 个目录需要首次同步到Git仓库`
        }
      }

      // 读取Git仓库中的数据
      const repoData = await this.readDataFromGitRepo()
      
      // 比较数据是否一致 - 兼容V1和V2格式
      const getSortKey = (item: any) => {
        // V2格式使用fullPath，V1格式使用id
        return item.fullPath || item.id || ''
      }
      
      const snippetsEqual = JSON.stringify(currentSnippets.sort((a, b) => getSortKey(a).localeCompare(getSortKey(b)))) === 
                           JSON.stringify(repoData.snippets.sort((a, b) => getSortKey(a).localeCompare(getSortKey(b))))
      const directoriesEqual = JSON.stringify(currentDirectories.sort((a, b) => getSortKey(a).localeCompare(getSortKey(b)))) === 
                               JSON.stringify(repoData.directories.sort((a, b) => getSortKey(a).localeCompare(getSortKey(b))))

      // 检查元数据是否需要更新（忽略时间戳）
      const metadataFile = path.join(effectiveLocalPath, '.starcode-meta.json')
      let metadataEqual = true
      
      if (fs.existsSync(metadataFile)) {
        try {
          const existingMetadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'))
          // 比较除时间戳外的元数据
          const currentMetadata = {
            version: '2.0.0',
            totalSnippets: currentSnippets.length,
            totalDirectories: currentDirectories.length,
            syncMethod: 'git'
          }
          const existingMetadataWithoutTimestamp = {
            version: existingMetadata.version,
            totalSnippets: existingMetadata.totalSnippets,
            totalDirectories: existingMetadata.totalDirectories,
            syncMethod: existingMetadata.syncMethod
          }
          metadataEqual = JSON.stringify(currentMetadata) === JSON.stringify(existingMetadataWithoutTimestamp)
        } catch (error) {
          metadataEqual = false
        }
      } else {
        metadataEqual = false
      }

      if (snippetsEqual && directoriesEqual && metadataEqual) {
        return {
          hasChanges: false,
          type: 'none',
          details: '本地数据与Git仓库数据一致'
        }
      }

      return {
        hasChanges: true,
        type: 'both_differ',
        details: `数据差异: 代码片段${snippetsEqual ? '一致' : '不一致'}, 目录${directoriesEqual ? '一致' : '不一致'}, 元数据${metadataEqual ? '一致' : '不一致'}`
      }
    } catch (error) {
      console.error('检测本地变更失败:', error)
      return {
        hasChanges: true,
        type: 'local_only',
        details: `检测变更时出错: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 检查远程是否有更新
   */
  public async checkRemoteUpdates(): Promise<{
    hasUpdates: boolean;
    details: string;
  }> {
    if (!this.isConfigured()) {
      throw new Error('云端同步未配置')
    }

    try {
      const git = await this.getGitInstance()
      
      // 执行fetch获取远程更新
      await git.fetch()
      
      // 检查当前分支与远程分支的差异
      const branch = this.config.defaultBranch || 'main'
      const status = await git.status()
      
      // 检查是否有远程提交领先本地
      const localRef = `HEAD`
      const remoteRef = `origin/${branch}`
      
      try {
        // 检查远程分支是否存在以及是否有新的提交
        const log = await git.log({ from: localRef, to: remoteRef })
        const hasRemoteCommits = log.total > 0
        
        if (hasRemoteCommits) {
          return {
            hasUpdates: true,
            details: `远程分支有 ${log.total} 个新提交需要拉取`
          }
        }
        
        return {
          hasUpdates: false,
          details: '远程没有新的更新'
        }
      } catch (logError) {
        // 如果远程分支不存在或其他错误，说明可能是首次推送
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
   * 执行完整同步（重新实现的Git版本）
   */
  public async performSync(currentSnippets: CodeSnippet[], currentDirectories: Directory[]): Promise<SyncResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: '云端同步未配置，请先配置Git仓库信息',
      }
    }



    // 更新同步状态
    const status = SettingsManager.getCloudSyncStatus()
    status.isSyncing = true
    await SettingsManager.saveCloudSyncStatus(status)

    try {
      // console.log('开始Git云端同步...')
      
      // 0. 检查并清理临时文件（如果存在）
      try {
        const tempFilesCheck = await TempFilesCleaner.checkNeedCleanup()
        if (tempFilesCheck.needCleanup) {
          // console.log(`发现 ${tempFilesCheck.fileCount} 个临时凭据文件，自动清理中...`)
          const cleanupResult = await TempFilesCleaner.cleanupGiteeCredFiles()
          if (cleanupResult.success && cleanupResult.deletedFiles.length > 0) {
            // console.log(`已自动清理 ${cleanupResult.deletedFiles.length} 个临时凭据文件`)
          }
        }
      } catch (cleanupError) {
        console.warn('清理临时文件时出错（不影响同步）:', cleanupError)
      }
      
      // 1. 获取Git配置并确保仓库初始化
      const git = await this.getGitInstance()
      // console.log('Git仓库已初始化并配置远程')

      // Gitee特殊处理
      if (this.config.provider === 'gitee') {
        // console.log('检测到Gitee平台，使用特殊处理流程...')
      }

      // 2. 检查并确保正确的分支存在
      const targetBranch = this.config.defaultBranch || 'main'
      // console.log(`目标分支: ${targetBranch}`)
      
      try {
        // 检查当前分支状态
        const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD'])
        // console.log(`当前分支: ${currentBranch}`)
        
        // 获取所有本地分支
        const localBranches = await git.branchLocal()
        const targetBranchExists = localBranches.all.includes(targetBranch)
        
        // console.log(`本地分支列表: ${localBranches.all.join(', ')}`)
        // console.log(`目标分支 ${targetBranch} 是否存在: ${targetBranchExists}`)
        
        if (!targetBranchExists) {
          // console.log(`目标分支 ${targetBranch} 不存在，正在创建...`)
          
          // 如果目标分支不存在，创建并切换到该分支
          if (localBranches.all.length > 0) {
            // 如果有其他分支，基于当前分支创建新分支
            await git.checkoutLocalBranch(targetBranch)
          } else {
            // 如果没有任何分支，需要先提交一些内容才能创建分支
            // console.log('仓库没有任何分支，将创建初始提交...')
          }
        } else if (currentBranch !== targetBranch) {
          // console.log(`切换到目标分支 ${targetBranch}`)
          await git.checkout(targetBranch)
        }
      } catch (branchError) {
        console.warn('分支检查/切换失败:', branchError)
        // 如果分支操作失败，继续执行但记录警告
      }

      // 3. 先拉取远程变更，避免冲突
      // console.log('开始拉取远程变更...')
      let remotePullSuccess = false
      try {
        await this.gitPull()
        // console.log('远程变更拉取成功')
        remotePullSuccess = true
      } catch (pullError) {
        // 检查是否是因为远程分支不存在
        const errorMessage = pullError instanceof Error ? pullError.message : '未知错误'
        
        // Gitee特殊错误处理
        if (this.config.provider === 'gitee') {
          if (errorMessage.includes('could not read Username') || 
              errorMessage.includes('Authentication failed')) {
            return {
              success: false,
              message: `Gitee认证失败！\n\n可能原因：\n• Token格式不正确或已过期\n• Gitee API限制\n\n建议：\n1. 重新生成并更新Token\n2. 如使用基于HTTPS的URL，尝试切换到SSH认证\n3. 检查Gitee仓库权限设置`,
            }
          }
        }
        
        if (errorMessage.includes('couldn\'t find remote ref') || 
            errorMessage.includes('does not exist') ||
            errorMessage.includes('no upstream branch')) {
          // console.log('远程分支不存在，将执行首次推送')
          remotePullSuccess = false
        } else {
           // 检查是否是合并冲突
           try {
             const gitStatus = await this.gitStatus()
             if (gitStatus.conflicted && gitStatus.conflicted.length > 0) {
               return await this.handleGitConflicts(gitStatus.conflicted)
             }
           } catch (statusError) {
             console.warn('检查Git状态失败:', statusError)
           }
           throw pullError
        }
      }

      // 4. 检测本地变更（在拉取远程变更后）
      const localChanges = await this.detectLocalChanges(currentSnippets, currentDirectories)
      // console.log('本地变更检测结果:', localChanges)

      // 5. 如果有本地变更或者是首次推送，写入数据到Git仓库
      const needsDataWrite = !remotePullSuccess || 
                            localChanges.hasChanges && (localChanges.type === 'local_only' || localChanges.type === 'both_differ')
      
      if (needsDataWrite) {
        // console.log('写入本地数据到Git仓库文件系统...')
        // 只有在真正有变更时才更新时间戳
        const hasRealChanges = localChanges.hasChanges && localChanges.type !== 'none'
        await this.writeDataToGitRepo(currentSnippets, currentDirectories, hasRealChanges)
      }

      // 6. 检查Git状态并确保有内容可以提交
      const gitStatus = await this.gitStatus()
      // console.log(`Git状态 - 文件变更: ${gitStatus.files.length}, 是否为仓库: ${gitStatus.isClean()}`)
      
      // 如果没有任何文件且有数据要同步，强制写入数据（兼容空仓库情况）
      if (gitStatus.files.length === 0 && (currentSnippets.length > 0 || currentDirectories.length > 0)) {
        // console.log('检测到空仓库但有数据要同步，强制写入数据...')
        // 重新检查本地变更，以确定是否真的需要更新时间戳
        const emptyRepoChanges = await this.detectLocalChanges(currentSnippets, currentDirectories)
        const shouldUpdateTimestamp = emptyRepoChanges.hasChanges && emptyRepoChanges.type !== 'none'
        await this.writeDataToGitRepo(currentSnippets, currentDirectories, shouldUpdateTimestamp)
        
        // 重新检查状态
        const newGitStatus = await this.gitStatus()
        // console.log(`写入数据后的Git状态 - 文件变更: ${newGitStatus.files.length}`)
      }

      // 7. 提交变更（如果有的话）
      const finalGitStatus = await this.gitStatus()
      const hasUncommittedChanges = finalGitStatus.files.length > 0

      if (hasUncommittedChanges) {
        // console.log('检测到未提交的变更，开始提交流程...')
        
        // 添加所有变更到暂存区
        await this.gitAddAll()
        // console.log('已添加所有变更到暂存区')
        
        // 生成提交信息并提交
        const commitMessage = this.generateCommitMessage()
        await this.gitCommit(commitMessage)
        // console.log(`已提交变更: ${commitMessage}`)
      } else {
        // console.log('没有检测到需要提交的变更')
      }

      // 8. 确保我们在正确的分支上并推送
      try {
        // 再次确认当前分支
        const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD'])
        // console.log(`推送前确认当前分支: ${currentBranch}`)
        
        if (currentBranch !== targetBranch) {
          // console.log(`当前分支 ${currentBranch} 与目标分支 ${targetBranch} 不一致，尝试切换...`)
          await git.checkout(targetBranch)
        }
      } catch (branchCheckError) {
        console.warn('推送前分支检查失败:', branchCheckError)
      }

      // 9. 推送到远程（只有在有提交时才推送）
      if (hasUncommittedChanges) {
        // console.log(`开始推送分支 ${targetBranch} 到远程仓库...`)
        try {
          await this.gitPush(targetBranch)
          // console.log('推送到远程仓库成功')
        } catch (pushError) {
          const errorMessage = pushError instanceof Error ? pushError.message : '未知错误'
          console.error('推送失败:', errorMessage)
          
          // Gitee特殊错误处理
          if (this.config.provider === 'gitee') {
            if (errorMessage.includes('could not read Username') || 
                errorMessage.includes('Authentication failed')) {
              return {
                success: false,
                message: `Gitee推送失败！\n\n可能原因：\n• Token没有推送权限\n• 仓库设置了保护分支\n\n建议：\n1. 在Gitee上检查Token权限\n2. 检查仓库分支保护设置\n3. 尝试使用SSH认证方式`,
              }
            }
          }
          
          if (errorMessage.includes('no upstream branch') || 
              errorMessage.includes('has no upstream branch') ||
              errorMessage.includes('upstream branch') ||
              errorMessage.includes('src refspec') ||
              hasUncommittedChanges) { // 如果有新提交，很可能需要设置上游分支
            // console.log('尝试设置上游分支并推送（首次推送）...')
            
            try {
              await git.push('origin', targetBranch, ['--set-upstream'])
              // console.log('已设置上游分支并推送成功（首次推送）')
            } catch (upstreamError) {
              // 如果还是失败，尝试强制推送（用于空仓库）
              const upstreamErrorMsg = upstreamError instanceof Error ? upstreamError.message : '未知错误'
              console.error('设置上游分支失败:', upstreamErrorMsg)
              
              // Gitee特殊错误处理
              if (this.config.provider === 'gitee' && 
                  (upstreamErrorMsg.includes('could not read Username') || 
                   upstreamErrorMsg.includes('Authentication failed'))) {
                return {
                  success: false,
                  message: `Gitee首次推送失败！\n\n请尝试：\n1. 在Gitee上确认仓库已正确创建\n2. 检查仓库权限设置\n3. 获取新的Token或尝试SSH认证方式`,
                }
              }
              
              if (upstreamErrorMsg.includes('non-fast-forward') || 
                  upstreamErrorMsg.includes('rejected')) {
                // console.log('尝试强制推送到空仓库...')
                await git.push('origin', targetBranch, ['--set-upstream', '--force'])
                // console.log('强制推送成功（空仓库初始化）')
              } else {
                throw upstreamError
              }
            }
          } else {
            throw pushError
          }
        }
      }

      // 10. 更新同步状态
      const finalStatus = SettingsManager.getCloudSyncStatus()
      finalStatus.lastSyncTime = Date.now()
      finalStatus.lastError = null
      finalStatus.isConnected = true
      await SettingsManager.saveCloudSyncStatus(finalStatus)

      const successMessage = hasUncommittedChanges 
        ? `同步成功！已提交并推送 ${currentSnippets.length} 个代码片段和 ${currentDirectories.length} 个目录到分支 ${targetBranch}`
        : `同步成功！数据已是最新状态（分支: ${targetBranch}）`

      return {
        success: true,
        message: successMessage
      }

    } catch (error) {
      console.error('同步失败:', error)
      
      // 更新错误状态
      const errorStatus = SettingsManager.getCloudSyncStatus()
      errorStatus.lastError = error instanceof Error ? error.message : '未知错误'
      errorStatus.isConnected = false
      await SettingsManager.saveCloudSyncStatus(errorStatus)
      
      return {
        success: false,
        message: `同步失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    } finally {
      // 清除同步状态
      const finalStatus = SettingsManager.getCloudSyncStatus()
      finalStatus.isSyncing = false
      await SettingsManager.saveCloudSyncStatus(finalStatus)
    }
  }

  /**
   * 检查变更集是否包含变更 (保持兼容性)
   */
  private hasChanges(changeSet: any): boolean {
    if (typeof changeSet === 'object' && changeSet.hasChanges !== undefined) {
      return changeSet.hasChanges
    }
    
    // 兼容旧格式
    return (
      changeSet.addedFiles?.length > 0 ||
      changeSet.modifiedFiles?.length > 0 ||
      changeSet.deletedFiles?.length > 0 ||
      changeSet.addedDirectories?.length > 0 ||
      changeSet.deletedDirectories?.length > 0
    )
  }

  /**
   * 处理Git合并冲突
   * 当检测到冲突时，提供用户友好的指导和自动解决选项
   */
  private async handleGitConflicts(conflictedFiles: string[]): Promise<SyncResult> {
    const conflictCount = conflictedFiles.length
    
    // 检查是否是代码片段相关的冲突文件
    const isSnippetConflict = conflictedFiles.some(file => 
      file.includes('snippets.json') || 
      file.includes('directories.json') || 
      file.includes('.starcode-meta.json')
    )
    
    let message: string
    
    if (isSnippetConflict) {
      // 对于代码片段文件的冲突，提供更具体的解决方案
      message = `检测到代码片段同步冲突！\n\n` +
        `冲突文件：\n${conflictedFiles.map(file => `• ${file}`).join('\n')}\n\n` +
        `这通常发生在多个设备同时修改代码片段时。\n\n` +
        `解决方案：\n` +
        `1. 【推荐】重置本地仓库并重新同步：\n` +
        `   - 这会使用远程版本覆盖本地冲突\n` +
        `   - 您的VSCode中的代码片段不会丢失\n` +
        `2. 手动解决冲突：\n` +
        `   - 在VSCode中打开冲突文件\n` +
        `   - 使用内置合并工具选择要保留的内容\n` +
        `   - 保存后重新执行同步\n\n` +
        `建议：为避免此类冲突，请在不同设备间错开同步时间。`
    } else {
      // 通用冲突处理
      message = `检测到 ${conflictCount} 个文件存在合并冲突：\n\n` +
        `冲突文件：\n${conflictedFiles.map(file => `• ${file}`).join('\n')}\n\n` +
        `请按以下步骤解决冲突：\n` +
        `1. 在VSCode中打开冲突文件\n` +
        `2. 使用VSCode内置的合并工具解决冲突\n` +
        `3. 保存文件后重新执行同步\n\n` +
        `或者使用Git命令行工具手动解决冲突。`
    }

    return {
      success: false,
      message: message,
      conflictsDetected: true,
      conflictDetails: conflictedFiles
    }
  }

  /**
   * 重置本地Git仓库到远程状态
   * 用于解决无法自动合并的冲突
   */
  public async resetToRemote(branch?: string): Promise<{ success: boolean; message: string }> {
    try {
      const git = await this.getGitInstance()
      const targetBranch = branch || this.config.defaultBranch || 'main'
      
      // console.log(`重置本地仓库到远程分支 ${targetBranch}...`)
      
      // 先获取远程最新状态
      await git.fetch('origin', targetBranch)
      
      // 重置到远程分支
      await git.reset(['--hard', `origin/${targetBranch}`])
      
      // 清理未跟踪的文件
      await git.clean('f', ['-d'])
      
      // console.log('本地仓库已重置到远程状态')
      
      return {
        success: true,
        message: `本地Git仓库已重置到远程分支 ${targetBranch} 的最新状态。\n现在可以重新执行同步操作。`
      }
    } catch (error) {
      console.error('重置本地仓库失败:', error)
      return {
        success: false,
        message: `重置失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 清空本地代码库 (May be adapted to clear local Git repo or reset it)
   */
  private async clearLocalCodebase(): Promise<void> {
    if (!this.storageManager) {
      throw new Error('StorageManager 未初始化')
    }
    // console.log('清空本地代码库 (to be adapted for Git)...')
    try {
      const [snippets, directories] = await Promise.all([
        this.storageManager.getAllSnippets(),
        this.storageManager.getAllDirectories(),
      ])
      for (const snippet of snippets) {
        await this.storageManager.deleteSnippet(snippet.id)
      }
      // console.log(`已删除 ${snippets.length} 个代码片段 (from StorageManager)`)
      const sortedDirs = directories.sort((a: Directory, b: Directory) => {
        return (b.name || '').localeCompare(a.name || '') // Placeholder sort
      })
      for (const directory of sortedDirs) {
        await this.storageManager.deleteDirectory(directory.id)
      }
      // console.log(`已删除 ${directories.length} 个目录 (from StorageManager)`)
      if (this.storageManager.clearCache) {
        this.storageManager.clearCache()
      }
      // console.log('本地代码库清空完成 (StorageManager based)')
    } catch (error) {
      console.error('清空本地代码库失败:', error)
      throw error
    }
  }
}
