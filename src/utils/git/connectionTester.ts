import * as vscode from 'vscode'
import { CloudSyncConfig } from '../../types/types'
import { ConnectionTestResult } from '../../types/syncTypes'
import { GitOperationsManager } from './gitOperationsManager'

/**
 * 连接测试器
 * 负责测试各平台的Git连接和认证
 */
export class ConnectionTester {
  private config: CloudSyncConfig
  private gitManager: GitOperationsManager

  constructor(config: CloudSyncConfig) {
    this.config = config
    this.gitManager = new GitOperationsManager(config)
  }

  /**
   * 更新配置
   */
  public updateConfig(newConfig: CloudSyncConfig): void {
    this.config = newConfig
    this.gitManager.updateConfig(newConfig)
  }

  /**
   * 测试连接
   */
  public async testConnection(): Promise<ConnectionTestResult> {
    if (!this.config.provider || !this.config.repositoryUrl) {
      return {
        success: false,
        message: '配置不完整：缺少provider或repositoryUrl'
      }
    }

    // 为Gitee配置特殊处理
    if (this.config.provider === 'gitee' && this.config.authenticationMethod === 'token') {
      try {
        // 为Gitee使用特殊的连接测试方法
        return await this.testGiteeConnection()
      } catch (giteeError) {
        const errorMessage = giteeError instanceof Error ? giteeError.message : '未知错误'
        return {
          success: false,
          message: `Gitee连接测试失败: ${errorMessage}\n\n建议：\n1. 检查令牌是否有效\n2. 确认仓库地址格式是否正确\n3. 尝试使用SSH认证方式`
        }
      }
    }
    
    // 其他平台使用通用Git连接测试
    return await this.testGenericGitConnection()
  }

  /**
   * 测试通用Git连接（完整的原始逻辑）
   */
  private async testGenericGitConnection(): Promise<ConnectionTestResult> {
    try {
      // 验证认证配置
      if (this.config.authenticationMethod === 'token') {
        if (!this.config.token) {
          return {
            success: false,
            message: 'Git 同步配置不完整'
          }
        }
      } else if (this.config.authenticationMethod === 'ssh') {
        if (!this.config.sshKeyPath) {
          return {
            success: false,
            message: 'Git 同步配置不完整'
          }
        }
      }

      const git = await this.gitManager.getGitInstance()
      
      // 首先测试远程仓库的可访问性
      try {
        await git.listRemote(['--heads', 'origin'])
        
        // 检查远程是否有分支
        const remoteBranches = await git.listRemote(['--heads', 'origin'])
        if (!remoteBranches || remoteBranches.trim() === '') {
          return {
            success: true,
            message: `成功连接到 ${this.config.provider} 仓库！\n\n⚠️ 注意：这是一个空仓库（没有任何分支）。\n首次同步时，系统会自动创建 '${this.config.defaultBranch || 'main'}' 分支并推送您的代码片段。`
          }
        }
        
        // 仓库不为空，尝试获取指定分支
        const targetBranch = this.config.defaultBranch || 'main'
        try {
          await git.fetch('origin', targetBranch)
          return {
            success: true,
            message: `成功连接到 ${this.config.provider} 仓库！\n远程分支 '${targetBranch}' 存在，可以进行同步。`
          }
        } catch (branchError) {
          // 分支不存在，但仓库可访问
          const branchErrorMsg = branchError instanceof Error ? branchError.message : '未知错误'
          if (branchErrorMsg.includes('couldn\'t find remote ref') || 
              branchErrorMsg.includes('does not exist')) {
            return {
              success: true,
              message: `成功连接到 ${this.config.provider} 仓库！\n\n⚠️ 注意：远程分支 '${targetBranch}' 不存在。\n首次同步时，系统会自动创建该分支并推送您的代码片段。`
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
              message: `Gitee认证失败！可能原因：\n• Token格式不正确\n• 需要提供用户名和密码（Gitee特性）\n\n请尝试：\n1. 确认Token是否有效\n2. 在Gitee设置中重新生成Token\n3. 如需使用密码认证，请选择SSH认证方式`
            }
          }
        }
        
        // 分析错误类型并提供具体的解决建议
        if (errorMessage.includes('Authentication failed') || 
            errorMessage.includes('invalid username or password') ||
            errorMessage.includes('bad credentials')) {
          return {
            success: false,
            message: `认证失败！请检查：\n• Token 是否正确\n• Token 是否有相应的仓库权限\n• 仓库URL是否正确\n\n错误详情: ${errorMessage}`
          }
        }
        
        if (errorMessage.includes('Repository not found') || 
            errorMessage.includes('not found')) {
          return {
            success: false,
            message: `仓库不存在！请检查：\n• 仓库URL是否正确\n• 仓库是否为私有（需要相应权限）\n• Token是否有访问该仓库的权限\n\n错误详情: ${errorMessage}`
          }
        }
        
        if (errorMessage.includes('Network') || 
            errorMessage.includes('timeout') || 
            errorMessage.includes('connection')) {
          return {
            success: false,
            message: `网络连接失败！请检查：\n• 网络连接是否正常\n• 是否需要代理设置\n• 防火墙是否阻止了连接\n\n错误详情: ${errorMessage}`
          }
        }
        
        return {
          success: false,
          message: `连接失败: ${errorMessage}\n\n请检查配置是否正确，或查看控制台日志获取更多信息。`
        }
      }
    } catch (error) {
      console.error('Git connection test failed:', error)
      return {
        success: false,
        message: `连接测试失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 测试Gitee连接（特殊处理）
   * 使用Gitee API直接验证Token和仓库访问权限
   */
  private async testGiteeConnection(): Promise<ConnectionTestResult> {
    try {
      if (!this.config.token) {
        return {
          success: false,
          message: 'Gitee需要访问令牌才能连接'
        }
      }

      // 从仓库URL中提取所有者和仓库名
      const repoUrl = this.config.repositoryUrl
      const urlMatch = repoUrl.match(/gitee\.com\/([\w-]+)\/([\w-]+)(\.git)?$/)
      
      if (!urlMatch) {
        return {
          success: false,
          message: `无效的Gitee仓库URL: ${repoUrl}\n\n正确格式应为: https://gitee.com/用户名/仓库名.git`
        }
      }
      
      const owner = urlMatch[1]
      const repo = urlMatch[2]
      
      // 使用Gitee API检查仓库状态
      const apiUrl = `https://gitee.com/api/v5/repos/${owner}/${repo}?access_token=${this.config.token}`
      
      // 使用Node.js内置的https模块进行请求
      const https = require('https')
      const result = await new Promise<ConnectionTestResult>((resolve, reject) => {
        const req = https.get(apiUrl, (res: any) => {
          let data = ''
          
          res.on('data', (chunk: any) => {
            data += chunk
          })
          
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const repoInfo = JSON.parse(data)
                resolve({
                  success: true,
                  message: `成功连接到Gitee仓库: ${repoInfo.full_name || `${owner}/${repo}`}\n\n仓库描述: ${repoInfo.description || '无描述'}\n默认分支: ${repoInfo.default_branch || 'master'}`
                })
              } catch (parseError) {
                resolve({
                  success: true,
                  message: `成功连接到Gitee仓库: ${owner}/${repo}\n但无法解析仓库详情`
                })
              }
            } else if (res.statusCode === 404) {
              resolve({
                success: false,
                message: `仓库不存在或无权访问: ${owner}/${repo}\n\n请检查:\n• 仓库URL是否正确\n• 令牌是否有权限访问该仓库`
              })
            } else if (res.statusCode === 401 || res.statusCode === 403) {
              resolve({
                success: false,
                message: `Gitee认证失败 (${res.statusCode})。\n\n请检查:\n• 访问令牌是否有效\n• 令牌是否具有正确的权限\n• 令牌是否已过期`
              })
            } else {
              resolve({
                success: false,
                message: `Gitee API返回错误: ${res.statusCode}\n\n响应数据: ${data}`
              })
            }
          })
        })
        
        req.on('error', (error: any) => {
          reject(new Error(`Gitee API请求失败: ${error.message}`))
        })
        
        req.end()
      })
      
      return result

    } catch (error) {
      console.error('Gitee连接测试失败:', error)
      throw error
    }
  }

  /**
   * 验证Gitee Token格式
   */
  private isValidGiteeToken(token: string): boolean {
    // Gitee个人访问令牌通常是32位的十六进制字符串
    const giteeTokenPattern = /^[a-f0-9]{32}$/i
    return giteeTokenPattern.test(token)
  }

  /**
   * 验证仓库URL格式
   */
  public validateRepositoryUrl(url: string): { valid: boolean; message: string } {
    try {
      const urlObj = new URL(url)
      
      // 检查协议
      if (!['http:', 'https:', 'ssh:'].includes(urlObj.protocol)) {
        return {
          valid: false,
          message: '仓库URL协议必须是http、https或ssh'
        }
      }

      // 检查域名
      const hostname = urlObj.hostname.toLowerCase()
      const validHostnames = ['github.com', 'gitlab.com', 'gitee.com']
      const isValidHostname = validHostnames.some(host => hostname.includes(host)) ||
                             hostname.includes('gitlab') // 支持私有GitLab实例

      if (!isValidHostname) {
        return {
          valid: false,
          message: '不支持的Git平台，目前支持GitHub、GitLab和Gitee'
        }
      }

      // 检查路径格式
      const pathname = urlObj.pathname
      if (!pathname || pathname === '/') {
        return {
          valid: false,
          message: '仓库URL必须包含用户名和仓库名'
        }
      }

      // 基本的路径格式检查（应该类似 /username/repository.git 或 /username/repository）
      const pathParts = pathname.split('/').filter(part => part.length > 0)
      if (pathParts.length < 2) {
        return {
          valid: false,
          message: '仓库URL格式不正确，应为 https://domain.com/username/repository'
        }
      }

      return {
        valid: true,
        message: '仓库URL格式正确'
      }

    } catch (error) {
      return {
        valid: false,
        message: '无效的URL格式'
      }
    }
  }

  /**
   * 获取平台特定的帮助信息
   */
  public getPlatformHelp(): string {
    switch (this.config.provider) {
      case 'github':
        return `GitHub配置帮助：
1. 创建Personal Access Token：Settings → Developer settings → Personal access tokens
2. Token需要 'repo' 权限
3. 仓库URL格式：https://github.com/username/repository.git`

      case 'gitlab':
        return `GitLab配置帮助：
1. 创建Personal Access Token：User Settings → Access Tokens
2. Token需要 'api', 'read_repository', 'write_repository' 权限
3. 仓库URL格式：https://gitlab.com/username/repository.git`

      case 'gitee':
        return `Gitee配置帮助：
1. 创建私人令牌：设置 → 私人令牌
2. 令牌需要 'projects' 权限
3. 仓库URL格式：https://gitee.com/username/repository.git
4. 注意：Token应为32位十六进制字符串`

      default:
        return '请选择正确的Git平台以获取配置帮助'
    }
  }
} 