import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'

/**
 * 跨平台路径工具类
 * 负责处理不同操作系统下的默认路径逻辑
 * 基于VSCode globalStorageUri实现编辑器隔离
 */
export class PathUtils {
  // 默认路径的特殊标识符
  public static readonly DEFAULT_PATH_TOKENS = {
    GITHUB_DEFAULT_REPO: 'GITHUB_DEFAULT_REPO',
    GITLAB_DEFAULT_REPO: 'GITLAB_DEFAULT_REPO',
    GITEE_DEFAULT_REPO: 'GITEE_DEFAULT_REPO',
    GENERIC_DEFAULT_REPO: 'DEFAULT_REPO'
  } as const

  /**
   * 基于VSCode globalStorageUri获取编辑器特定的仓库路径
   * 这是推荐的主要方法，可确保不同编辑器间的数据隔离
   */
  static getEditorSpecificRepoPath(gitPlatform?: 'github' | 'gitlab' | 'gitee', context?: vscode.ExtensionContext): string {
    // 优先使用传入的context，否则尝试从SettingsManager获取
    let extensionContext = context
    if (!extensionContext) {
      try {
        const { SettingsManager } = require('./settingsManager')
        extensionContext = SettingsManager.getExtensionContext()
      } catch (error) {
        console.warn('无法获取扩展上下文，使用备用路径')
      }
    }

    if (extensionContext) {
      // 使用VSCode的globalStorageUri确保编辑器隔离
      const baseStoragePath = extensionContext.globalStorageUri.fsPath
      
      if (gitPlatform) {
        // 为特定Git平台创建子目录
        const platformName = this.getPlatformDisplayName(gitPlatform)
        return path.join(baseStoragePath, 'repos', platformName)
      } else {
        // 通用仓库目录
        return path.join(baseStoragePath, 'repos', 'default')
      }
    }

    // 备用方案：使用传统的默认路径
    console.warn('无法获取VSCode存储路径，使用备用默认路径')
    return gitPlatform ? 
      this.getDefaultLocalRepoPathForPlatform(gitPlatform) : 
      this.getDefaultLocalRepoPath()
  }

  /**
   * 获取编辑器特定的路径描述
   */
  static getEditorSpecificPathDescription(gitPlatform?: 'github' | 'gitlab' | 'gitee', context?: vscode.ExtensionContext): string {
    const editorPath = this.getEditorSpecificRepoPath(gitPlatform, context)
    
    // 检测编辑器类型
    const editorType = this.detectEditorType(context)
    const platformDesc = gitPlatform ? this.getPlatformDisplayName(gitPlatform) : '默认'
    
    return `${editorType} 专用存储 - ${platformDesc} 仓库: ${editorPath}`
  }

  /**
   * 检测当前编辑器类型
   */
  static detectEditorType(context?: vscode.ExtensionContext): string {
    let extensionContext = context
    if (!extensionContext) {
      try {
        const { SettingsManager } = require('./settingsManager')
        extensionContext = SettingsManager.getExtensionContext()
      } catch (error) {
        return '未知编辑器'
      }
    }

    if (extensionContext) {
      const globalStoragePath = extensionContext.globalStorageUri.fsPath.toLowerCase()
      const appName = vscode.env.appName.toLowerCase()
      
      if (appName.includes('cursor') || globalStoragePath.includes('cursor')) {
        return 'Cursor'
      } else if (appName.includes('visual studio code') || appName.includes('vscode') || globalStoragePath.includes('code')) {
        return 'VSCode'
      }
    }
    
    return vscode.env.appName || '未知编辑器'
  }

  /**
   * 获取默认的本地仓库路径（通用版本，保持向后兼容）
   * @deprecated 推荐使用 getEditorSpecificRepoPath() 替代
   */
  static getDefaultLocalRepoPath(): string {
    const platform = os.platform()
    const homeDir = os.homedir()

    switch (platform) {
      case 'win32':
        // Windows: %USERPROFILE%\Documents\StarCode-Snippets
        return path.join(homeDir, 'Documents', 'StarCode-Snippets')
      
      case 'darwin':
        // macOS: ~/Documents/StarCode-Snippets
        return path.join(homeDir, 'Documents', 'StarCode-Snippets')
      
      case 'linux':
      default:
        // Linux 和其他 Unix-like 系统: ~/.local/share/starcode-snippets
        return path.join(homeDir, '.local', 'share', 'starcode-snippets')
    }
  }

  /**
   * 获取特定Git平台的默认本地仓库路径（保持向后兼容）
   * @deprecated 推荐使用 getEditorSpecificRepoPath(gitPlatform) 替代
   */
  static getDefaultLocalRepoPathForPlatform(gitPlatform: 'github' | 'gitlab' | 'gitee'): string {
    const platform = os.platform()
    const homeDir = os.homedir()
    
    // 获取平台名称的友好显示
    const platformDisplayName = this.getPlatformDisplayName(gitPlatform)

    switch (platform) {
      case 'win32':
        // Windows: %USERPROFILE%\Documents\StarCode-Snippets\GitHub
        return path.join(homeDir, 'Documents', 'StarCode-Snippets', platformDisplayName)
      
      case 'darwin':
        // macOS: ~/Documents/StarCode-Snippets/GitHub
        return path.join(homeDir, 'Documents', 'StarCode-Snippets', platformDisplayName)
      
      case 'linux':
      default:
        // Linux: ~/.local/share/starcode-snippets/github
        return path.join(homeDir, '.local', 'share', 'starcode-snippets', gitPlatform.toLowerCase())
    }
  }

  /**
   * 获取Git平台的友好显示名称
   */
  private static getPlatformDisplayName(gitPlatform: 'github' | 'gitlab' | 'gitee'): string {
    switch (gitPlatform) {
      case 'github':
        return 'GitHub'
      case 'gitlab':
        return 'GitLab'
      case 'gitee':
        return 'Gitee'
    }
  }

  /**
   * 获取平台特定的配置目录
   */
  static getPlatformConfigDir(): string {
    const platform = os.platform()
    const homeDir = os.homedir()

    switch (platform) {
      case 'win32':
        return process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming')
      
      case 'darwin':
        return path.join(homeDir, 'Library', 'Application Support')
      
      case 'linux':
      default:
        return process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config')
    }
  }

  /**
   * 检查路径是否为默认路径
   */
  static isDefaultPath(inputPath: string): boolean {
    const defaultPath = this.getDefaultLocalRepoPath()
    return path.resolve(inputPath) === path.resolve(defaultPath)
  }

  /**
   * 规范化路径格式
   * 处理相对路径、环境变量等
   */
  static normalizePath(inputPath: string): string {
    if (!inputPath || inputPath.trim() === '') {
      return this.getDefaultLocalRepoPath()
    }

    // 处理环境变量 (如 $HOME, %USERPROFILE% 等)
    let normalizedPath = inputPath
    
    // 替换 ~ 为用户主目录
    if (normalizedPath.startsWith('~/') || normalizedPath === '~') {
      normalizedPath = path.join(os.homedir(), normalizedPath.slice(2))
    }

    // Windows 环境变量处理
    if (os.platform() === 'win32') {
      normalizedPath = normalizedPath.replace(/%([^%]+)%/g, (match, envVar) => {
        return process.env[envVar] || match
      })
    }

    // Unix-like 环境变量处理
    normalizedPath = normalizedPath.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, envVar) => {
      return process.env[envVar] || match
    })

    return path.resolve(normalizedPath)
  }

  /**
   * 获取平台显示友好的路径描述
   */
  static getPathDescription(inputPath?: string): string {
    const platform = os.platform()
    const targetPath = inputPath || this.getDefaultLocalRepoPath()
    
    let description = `当前路径: ${targetPath}`
    
    if (this.isDefaultPath(targetPath)) {
      switch (platform) {
        case 'win32':
          description += ' (Windows 默认文档目录)'
          break
        case 'darwin':
          description += ' (macOS 默认文档目录)'
          break
        case 'linux':
        default:
          description += ' (Linux 默认应用数据目录)'
          break
      }
    } else {
      description += ' (自定义路径)'
    }

    return description
  }

  /**
   * 检查多个平台配置中是否有路径冲突
   */
  static checkPathConflicts(platforms: Array<{ id: string; provider: 'github' | 'gitlab' | 'gitee'; localPath: string; name: string }>): {
    hasConflicts: boolean;
    conflicts: Array<{
      path: string;
      platforms: Array<{ id: string; provider: string; name: string }>;
    }>;
    suggestions: Array<{
      platformId: string;
      suggestedPath: string;
    }>;
  } {
    const pathMap = new Map<string, Array<{ id: string; provider: string; name: string }>>()
    const conflicts: Array<{
      path: string;
      platforms: Array<{ id: string; provider: string; name: string }>;
    }> = []
    const suggestions: Array<{
      platformId: string;
      suggestedPath: string;
    }> = []

    // 收集所有有效路径（非空且已规范化）
    platforms.forEach(platform => {
      let effectivePath = platform.localPath?.trim()
      
      // 如果路径为空，使用该平台的默认路径
      if (!effectivePath) {
        effectivePath = this.getDefaultLocalRepoPathForPlatform(platform.provider)
      } else {
        // 如果是默认路径标识符，解析为实际路径
        if (this.isDefaultPathToken(effectivePath)) {
          effectivePath = this.resolveDefaultPathToken(effectivePath, platform.provider)
        } else {
          // 普通路径进行规范化处理
          effectivePath = this.normalizePath(effectivePath)
        }
      }

      const normalizedPath = path.resolve(effectivePath)
      
      if (!pathMap.has(normalizedPath)) {
        pathMap.set(normalizedPath, [])
      }
      
      pathMap.get(normalizedPath)!.push({
        id: platform.id,
        provider: platform.provider,
        name: platform.name
      })
    })

    // 找出冲突的路径（有多个平台使用相同路径）
    pathMap.forEach((platformsUsingPath, conflictPath) => {
      if (platformsUsingPath.length > 1) {
        conflicts.push({
          path: conflictPath,
          platforms: platformsUsingPath
        })

        // 为冲突的平台提供建议路径
        platformsUsingPath.forEach(platform => {
          const suggestedPath = this.getDefaultLocalRepoPathForPlatform(platform.provider as 'github' | 'gitlab' | 'gitee')
          suggestions.push({
            platformId: platform.id,
            suggestedPath: suggestedPath
          })
        })
      }
    })

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
      suggestions
    }
  }

  /**
   * 检查指定路径是否为某个平台的默认路径
   */
  static isDefaultPathForPlatform(inputPath: string, gitPlatform: 'github' | 'gitlab' | 'gitee'): boolean {
    const defaultPath = this.getDefaultLocalRepoPathForPlatform(gitPlatform)
    return path.resolve(inputPath) === path.resolve(defaultPath)
  }

  /**
   * 验证路径是否可写
   */
  static async validatePath(targetPath: string): Promise<{ isValid: boolean; error?: string }> {
    try {
      const fs = await import('fs')
      const normalizedPath = this.normalizePath(targetPath)
      
      // 检查父目录是否存在和可写
      const parentDir = path.dirname(normalizedPath)
      
      try {
        await fs.promises.access(parentDir, fs.constants.W_OK)
      } catch (error) {
        // 如果父目录不存在，尝试创建
        try {
          await fs.promises.mkdir(parentDir, { recursive: true })
        } catch (mkdirError) {
          return {
            isValid: false,
            error: `无法创建目录: ${parentDir}。请检查权限。`
          }
        }
      }

      // 如果目标目录不存在，尝试创建
      try {
        await fs.promises.access(normalizedPath)
      } catch (error) {
        try {
          await fs.promises.mkdir(normalizedPath, { recursive: true })
        } catch (mkdirError) {
          return {
            isValid: false,
            error: `无法创建仓库目录: ${normalizedPath}。请检查权限。`
          }
        }
      }

      return { isValid: true }
    } catch (error) {
      return {
        isValid: false,
        error: `路径验证失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }

  /**
   * 检查路径是否适用于当前平台
   * 用于验证导入的配置路径是否与当前操作系统兼容
   */
  static isPathCompatibleWithCurrentPlatform(inputPath: string): {
    isCompatible: boolean;
    reason?: string;
    suggestedPath?: string;
  } {
    if (!inputPath || inputPath.trim() === '') {
      return { isCompatible: true } // 空路径总是兼容的，会使用默认路径
    }

    const currentPlatform = os.platform()
    
    // 检查是否包含平台特定的路径分隔符或模式
    const isWindowsPath = /^[A-Za-z]:|\\/.test(inputPath) || inputPath.includes('%') || inputPath.includes('\\')
    const isUnixPath = inputPath.startsWith('/') || inputPath.startsWith('~') || inputPath.includes('$')
    
    switch (currentPlatform) {
      case 'win32':
        if (isUnixPath && !isWindowsPath) {
          return {
            isCompatible: false,
            reason: '检测到Unix/Linux格式路径，当前系统为Windows',
            suggestedPath: this.getDefaultLocalRepoPath()
          }
        }
        break
        
      case 'darwin':
      case 'linux':
        if (isWindowsPath && !isUnixPath) {
          return {
            isCompatible: false,
            reason: '检测到Windows格式路径，当前系统为Unix/Linux',
            suggestedPath: this.getDefaultLocalRepoPath()
          }
        }
        break
    }

    // 尝试解析路径，如果失败则不兼容
    try {
      this.normalizePath(inputPath)
      return { isCompatible: true }
    } catch (error) {
      return {
        isCompatible: false,
        reason: `路径格式无效: ${error instanceof Error ? error.message : '未知错误'}`,
        suggestedPath: this.getDefaultLocalRepoPath()
      }
    }
  }

  /**
   * 获取平台对应的默认路径标识符
   */
  static getDefaultPathToken(gitPlatform: 'github' | 'gitlab' | 'gitee'): string {
    switch (gitPlatform) {
      case 'github':
        return this.DEFAULT_PATH_TOKENS.GITHUB_DEFAULT_REPO
      case 'gitlab':
        return this.DEFAULT_PATH_TOKENS.GITLAB_DEFAULT_REPO
      case 'gitee':
        return this.DEFAULT_PATH_TOKENS.GITEE_DEFAULT_REPO
    }
  }

  /**
   * 检查路径是否为默认路径标识符
   */
  static isDefaultPathToken(path: string): boolean {
    const tokens = Object.values(this.DEFAULT_PATH_TOKENS)
    return tokens.includes(path as any)
  }

  /**
   * 将默认路径标识符解析为实际路径
   * 优先使用编辑器特定路径，确保编辑器间数据隔离
   */
  static resolveDefaultPathToken(pathOrToken: string, gitPlatform?: 'github' | 'gitlab' | 'gitee', context?: vscode.ExtensionContext): string {
    if (!pathOrToken || pathOrToken.trim() === '') {
      // 空路径，使用编辑器特定的默认路径
      return this.getEditorSpecificRepoPath(gitPlatform, context)
    }

    // 检查是否为默认路径标识符
    switch (pathOrToken) {
      case this.DEFAULT_PATH_TOKENS.GITHUB_DEFAULT_REPO:
        return this.getEditorSpecificRepoPath('github', context)
      case this.DEFAULT_PATH_TOKENS.GITLAB_DEFAULT_REPO:
        return this.getEditorSpecificRepoPath('gitlab', context)
      case this.DEFAULT_PATH_TOKENS.GITEE_DEFAULT_REPO:
        return this.getEditorSpecificRepoPath('gitee', context)
      case this.DEFAULT_PATH_TOKENS.GENERIC_DEFAULT_REPO:
        return this.getEditorSpecificRepoPath(undefined, context)
      default:
        // 不是默认路径标识符，直接返回原路径
        // 避免使用 normalizePath，因为其中的 path.resolve 会受当前工作目录影响
        return pathOrToken
    }
  }

  /**
   * 智能处理导入的路径配置
   * 自动检测和修复跨平台路径兼容性问题
   */
  static processImportedPath(
    importedPath: string, 
    gitPlatform?: 'github' | 'gitlab' | 'gitee'
  ): {
    processedPath: string;
    wasModified: boolean;
    reason?: string;
  } {
    if (!importedPath || importedPath.trim() === '') {
      return {
        processedPath: '',
        wasModified: false
      }
    }

    // 如果是默认路径标识符，直接返回对应的标识符
    if (this.isDefaultPathToken(importedPath)) {
      return {
        processedPath: importedPath,
        wasModified: false
      }
    }

    const compatibilityCheck = this.isPathCompatibleWithCurrentPlatform(importedPath)
    
    if (compatibilityCheck.isCompatible) {
      return {
        processedPath: importedPath,
        wasModified: false
      }
    }

    // 路径不兼容，使用平台特定的默认路径标识符
    const defaultToken = gitPlatform 
      ? this.getDefaultPathToken(gitPlatform)
      : this.DEFAULT_PATH_TOKENS.GENERIC_DEFAULT_REPO

    return {
      processedPath: defaultToken,
      wasModified: true,
      reason: compatibilityCheck.reason
    }
  }

  /**
   * 检查配置的路径是否使用默认路径
   * 支持检查默认路径标识符和空路径
   */
  static isUsingDefaultPath(configuredPath: string, gitPlatform?: 'github' | 'gitlab' | 'gitee'): boolean {
    if (!configuredPath || configuredPath.trim() === '') {
      return true
    }

    // 检查是否为默认路径标识符
    if (this.isDefaultPathToken(configuredPath)) {
      return true
    }

    // 检查是否与当前平台的默认路径一致
    const actualDefaultPath = gitPlatform 
      ? this.getDefaultLocalRepoPathForPlatform(gitPlatform)
      : this.getDefaultLocalRepoPath()
    
    try {
      return path.resolve(configuredPath) === path.resolve(actualDefaultPath)
    } catch (error) {
      return false
    }
  }
} 