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
   * 【重要修复】智能选择初始化还是克隆远程仓库
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
      // 【重要修复】本地仓库不存在时，优先尝试从远程克隆
      await this.smartInitializeRepository(git, effectiveLocalPath)
    } else {
      await this.validateExistingRepository(git)
    }

    return git
  }

  /**
   * 【新增】智能初始化仓库：优先克隆远程，否则初始化新仓库
   */
  private async smartInitializeRepository(git: SimpleGit, repoPath: string): Promise<void> {
    console.log('🔍 智能初始化仓库：检查远程仓库状态...')

    try {
      // 第一步：尝试检查远程仓库是否存在
      const tempGit = simpleGit()
      let remoteHasData = false

      try {
        console.log('📡 检查远程仓库是否有数据...')
        const remoteRefs = await tempGit.listRemote(['--heads', this.config.repositoryUrl])
        remoteHasData = !!(remoteRefs && remoteRefs.trim())
        console.log(`   远程仓库状态: ${remoteHasData ? '有数据' : '无数据/不存在'}`)
      } catch (remoteCheckError) {
        console.log('   远程仓库检查失败，将初始化新仓库')
        remoteHasData = false
      }

      if (remoteHasData) {
        // 第二步：远程有数据，克隆远程仓库
        console.log('🔄 远程仓库有数据，开始克隆...')
        await this.cloneFromRemote(repoPath)
      } else {
        // 第三步：远程无数据，初始化新仓库
        console.log('📝 远程仓库无数据，初始化新仓库...')
        await this.initializeNewRepository(git, repoPath)
      }
    } catch (error) {
      console.warn('智能初始化失败，回退到普通初始化:', error)
      // 如果智能初始化失败，回退到原来的逻辑
      await this.initializeNewRepository(git, repoPath)
    }
  }

  /**
   * 【新增】从远程仓库克隆
   */
  private async cloneFromRemote(repoPath: string): Promise<void> {
    try {
      const targetBranch = this.config.defaultBranch || 'main'

      // 准备克隆URL（包含认证信息）
      let cloneUrl = this.config.repositoryUrl
      if (this.config.authenticationMethod === 'token' && this.config.token) {
        cloneUrl = this.embedTokenInUrl(this.config.repositoryUrl, this.config.token)
      }

      console.log(`📥 开始克隆远程仓库到: ${repoPath}`)
      console.log(`   目标分支: ${targetBranch}`)

      // 删除目标目录的内容（保留目录本身）
      if (fs.existsSync(repoPath)) {
        const entries = fs.readdirSync(repoPath)
        for (const entry of entries) {
          const entryPath = path.join(repoPath, entry)
          if (fs.statSync(entryPath).isDirectory()) {
            await this.deleteDirectory(entryPath)
          } else {
            fs.unlinkSync(entryPath)
          }
        }
      }

      // 使用 simple-git 克隆仓库
      const tempGit = simpleGit()
      await tempGit.clone(cloneUrl, repoPath, ['--branch', targetBranch, '--single-branch'])

      console.log('✅ 远程仓库克隆成功')

      // 设置用户配置
      const git = simpleGit(repoPath)
      try {
        await git.addConfig('user.name', 'StarCode Snippets')
        await git.addConfig('user.email', 'starcode-snippets@local')
      } catch (configError) {
        console.warn('设置Git用户配置失败:', configError)
      }
    } catch (cloneError) {
      console.error('克隆远程仓库失败:', cloneError)

      // 如果克隆失败，尝试其他分支
      const alternativeBranches = ['master', 'main']
      const targetBranch = this.config.defaultBranch || 'main'

      for (const branch of alternativeBranches) {
        if (branch === targetBranch) {
          continue
        } // 跳过已经尝试过的分支

        try {
          console.log(`🔄 尝试克隆分支: ${branch}`)
          let cloneUrl = this.config.repositoryUrl
          if (this.config.authenticationMethod === 'token' && this.config.token) {
            cloneUrl = this.embedTokenInUrl(this.config.repositoryUrl, this.config.token)
          }

          // 清理目录
          if (fs.existsSync(repoPath)) {
            const entries = fs.readdirSync(repoPath)
            for (const entry of entries) {
              const entryPath = path.join(repoPath, entry)
              if (fs.statSync(entryPath).isDirectory()) {
                await this.deleteDirectory(entryPath)
              } else {
                fs.unlinkSync(entryPath)
              }
            }
          }

          const tempGit = simpleGit()
          await tempGit.clone(cloneUrl, repoPath, ['--branch', branch, '--single-branch'])

          console.log(`✅ 成功克隆分支 ${branch}`)

          // 如果成功但分支不是目标分支，切换分支
          if (branch !== targetBranch) {
            const git = simpleGit(repoPath)
            try {
              await git.checkoutLocalBranch(targetBranch)
              console.log(`✅ 已切换到目标分支: ${targetBranch}`)
            } catch (branchError) {
              console.warn(`切换到目标分支失败，继续使用 ${branch}:`, branchError)
            }
          }

          return // 成功克隆，退出函数
        } catch (alternativeError) {
          console.warn(`克隆分支 ${branch} 失败:`, alternativeError)
          continue
        }
      }

      // 所有克隆尝试都失败
      throw new Error(
        `无法克隆远程仓库，已尝试分支: ${[targetBranch, ...alternativeBranches].join(', ')}。原始错误: ${cloneError}`
      )
    }
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
      const origin = remotes.find((remote) => remote.name === 'origin')

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
   * Git拉取操作（智能处理非快进和历史不相关问题）
   */
  public async gitPull(branch?: string): Promise<void> {
    const git = await this.getGitInstance()
    const targetBranch = branch || this.config.defaultBranch || 'main'

    try {
      // 检查是否有本地更改
      const status = await git.status()
      const hasLocalChanges = status.files.length > 0

      if (hasLocalChanges) {
        console.log('⚠️ 检测到本地更改，先暂存...')
        // 暂存本地更改
        try {
          await git.stash(['push', '-m', 'Auto-stash before pull'])
        } catch (stashError) {
          const stashErrorMsg = stashError instanceof Error ? stashError.message : '未知错误'
          throw new Error(`暂存本地更改失败: ${stashErrorMsg}`)
        }

        // 尝试拉取
        try {
          await git.pull('origin', targetBranch)
          console.log('✅ 拉取成功，恢复本地更改...')

          // 拉取成功后，恢复暂存的更改
          try {
            await git.stash(['pop'])
          } catch (stashPopError) {
            // 如果恢复暂存时发生冲突，需要手动处理
            const stashErrorMsg = stashPopError instanceof Error ? stashPopError.message : '未知错误'
            if (stashErrorMsg.includes('conflict') || stashErrorMsg.includes('CONFLICT')) {
              throw new Error(
                `合并冲突：本地更改与远程更改存在冲突。请手动解决冲突后重新同步。\n\n详细信息：${stashErrorMsg}`
              )
            }
            throw stashPopError
          }
        } catch (pullError) {
          const pullErrorMessage = pullError instanceof Error ? pullError.message : '未知错误'

          // 处理 "refusing to merge unrelated histories" 错误
          if (pullErrorMessage.includes('refusing to merge unrelated histories')) {
            console.log('⚠️ 检测到不相关历史记录，使用--allow-unrelated-histories重试...')
            try {
              // 使用 --allow-unrelated-histories 选项重新拉取
              await git.pull('origin', targetBranch, ['--allow-unrelated-histories'])
              console.log('✅ 使用--allow-unrelated-histories拉取成功')

              // 拉取成功后，尝试恢复暂存的更改
              try {
                await git.stash(['pop'])
              } catch (stashPopError) {
                const stashErrorMsg = stashPopError instanceof Error ? stashPopError.message : '未知错误'
                if (stashErrorMsg.includes('conflict') || stashErrorMsg.includes('CONFLICT')) {
                  throw new Error(
                    `合并冲突：本地更改与远程更改存在冲突。请手动解决冲突后重新同步。\n\n详细信息：${stashErrorMsg}`
                  )
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
              console.error('⚠️ 即使使用--allow-unrelated-histories也无法合并')

              // 提供更好的解决方案建议
              throw new Error(
                `Git历史冲突无法自动解决：\n\n原因：本地仓库和远程仓库有不同的Git历史记录\n\n解决方案：\n1. 使用"重新初始化仓库"命令（推荐）\n2. 手动删除本地Git仓库目录后重新同步\n3. 或联系技术支持\n\n技术详情：\n原始错误: ${pullErrorMessage}\n重试错误: ${retryErrorMessage}`
              )
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
        try {
          await git.pull('origin', targetBranch)
          console.log('✅ 拉取成功（无本地更改）')
        } catch (pullError) {
          const errorMessage = pullError instanceof Error ? pullError.message : '未知错误'

          // 处理 "refusing to merge unrelated histories" 错误
          if (errorMessage.includes('refusing to merge unrelated histories')) {
            console.log('⚠️ 检测到不相关历史记录，使用--allow-unrelated-histories重试...')
            try {
              // 使用 --allow-unrelated-histories 选项重新拉取
              await git.pull('origin', targetBranch, ['--allow-unrelated-histories'])
              console.log('✅ 使用--allow-unrelated-histories拉取成功')
              return
            } catch (retryError) {
              const retryErrorMessage = retryError instanceof Error ? retryError.message : '未知错误'
              console.error('⚠️ 即使使用--allow-unrelated-histories也无法合并')

              // 提供更好的解决方案建议
              throw new Error(
                `Git历史冲突无法自动解决：\n\n原因：本地仓库和远程仓库有不同的Git历史记录\n\n解决方案：\n1. 使用"重新初始化仓库"命令（推荐）\n2. 手动删除本地Git仓库目录后重新同步\n3. 或联系技术支持\n\n技术详情：\n原始错误: ${errorMessage}\n重试错误: ${retryErrorMessage}`
              )
            }
          }

          throw new Error(`拉取远程变更失败: ${errorMessage}`)
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      console.error('❌ Git拉取操作失败:', errorMessage)
      throw error
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
   * 推送到远程仓库（智能处理非快进推送）
   */
  public async gitPush(branch?: string): Promise<void> {
    const git = await this.getGitInstance()
    const targetBranch = branch || this.config.defaultBranch || 'main'

    try {
      await git.push('origin', targetBranch)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误'

      // 【新增】处理没有上游分支的情况
      if (errorMessage.includes('no upstream branch') || errorMessage.includes('has no upstream branch')) {
        console.log('🔧 检测到没有上游分支，设置上游分支并推送...')
        try {
          await git.push(['--set-upstream', 'origin', targetBranch])
          console.log('✅ 已设置上游分支并推送成功')
          return
        } catch (upstreamError) {
          console.error('设置上游分支推送失败:', upstreamError)
          throw new Error(`推送失败: ${upstreamError instanceof Error ? upstreamError.message : '未知错误'}`)
        }
      }

      // 处理非快进推送错误
      if (
        errorMessage.includes('non-fast-forward') ||
        errorMessage.includes('rejected') ||
        errorMessage.includes('tip of your current branch is behind')
      ) {
        console.log('⚠️ 检测到非快进推送，尝试先拉取远程更改...')

        try {
          // 先拉取远程更改
          await this.gitPull(targetBranch)

          // 重新尝试推送
          console.log('🔄 重新尝试推送...')
          await git.push('origin', targetBranch)
          console.log('✅ 推送成功')
        } catch (retryError) {
          const retryErrorMessage = retryError instanceof Error ? retryError.message : '未知错误'

          // 如果拉取后仍然失败，可能是有冲突
          if (retryErrorMessage.includes('conflict') || retryErrorMessage.includes('CONFLICT')) {
            throw new Error(`推送失败：检测到合并冲突。请手动解决冲突后重新同步。\n\n详细信息：${retryErrorMessage}`)
          }

          throw new Error(
            `推送失败：即使在拉取远程更改后仍然失败。\n\n原始错误：${errorMessage}\n重试错误：${retryErrorMessage}`
          )
        }
      } else {
        throw new Error(`推送失败: ${errorMessage}`)
      }
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
        message: '仓库重新初始化成功',
      }
    } catch (error) {
      return {
        success: false,
        message: `重新初始化失败: ${error}`,
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
   * 检查远程仓库状态（增强版本：添加文件内容验证）
   */
  public async checkRemoteRepositoryStatus(
    targetBranch: string
  ): Promise<{ isRemoteEmpty: boolean; remotePullSuccess: boolean; remoteHasData: boolean }> {
    let isRemoteEmpty = false
    let remotePullSuccess = false
    let remoteHasData = false

    console.log(`🔍 开始检查远程仓库状态 (分支: ${targetBranch})...`)

    try {
      const git = await this.getGitInstance()

      // 【增强】步骤1: 详细检查远程分支情况
      console.log(`📡 正在检查远程分支信息...`)
      const remoteRefs = await git.listRemote(['--heads', 'origin'])
      console.log(
        `   远程分支引用: ${remoteRefs ? remoteRefs.substring(0, 200) : 'null'}${
          remoteRefs && remoteRefs.length > 200 ? '...' : ''
        }`
      )

      isRemoteEmpty = !remoteRefs || remoteRefs.trim() === ''
      console.log(`   远程仓库是否为空: ${isRemoteEmpty}`)

      if (isRemoteEmpty) {
        console.log(`✅ 确认远程仓库为空，这是首次推送场景`)
        return { isRemoteEmpty: true, remotePullSuccess: false, remoteHasData: false }
      }

      // 检查目标分支是否存在
      const targetBranchExists = remoteRefs.includes(`refs/heads/${targetBranch}`)
      console.log(`   目标分支 ${targetBranch} 是否存在: ${targetBranchExists}`)

      if (!targetBranchExists) {
        console.log(`⚠️ 目标分支 ${targetBranch} 不存在于远程，将作为新分支处理`)
        return { isRemoteEmpty: false, remotePullSuccess: false, remoteHasData: false }
      }

      // 【Git 标准】步骤2: 仅获取远程信息，不执行合并
      console.log(`🔄 远程分支存在，开始获取并验证内容...`)
      try {
        // 只执行 fetch，不执行 pull（避免自动合并）
        await this.gitFetch()
        remotePullSuccess = true
        console.log(`✅ 远程获取成功`)

        // 【新增】步骤3: 深度验证远程数据内容
        console.log(`🔍 开始验证远程数据文件内容...`)
        remoteHasData = await this.validateRemoteDataContent(git, targetBranch)
        console.log(`   远程数据验证结果: ${remoteHasData ? '有有效数据' : '无有效数据'}`)
      } catch (fetchError) {
        const errorMessage = fetchError instanceof Error ? fetchError.message : '未知错误'
        console.error(`❌ 远程获取失败: ${errorMessage}`)

        // Gitee特殊错误处理
        if (this.config.provider === 'gitee') {
          if (errorMessage.includes('could not read Username') || errorMessage.includes('Authentication failed')) {
            throw new Error(
              `Gitee认证失败！\n\n可能原因：\n• Token格式不正确或已过期\n• Gitee API限制\n\n建议：\n1. 重新生成并更新Token\n2. 如使用基于HTTPS的URL，尝试切换到SSH认证\n3. 检查Gitee仓库权限设置`
            )
          }
        }

        if (
          errorMessage.includes("couldn't find remote ref") ||
          errorMessage.includes('does not exist') ||
          errorMessage.includes('no upstream branch')
        ) {
          console.log('❌ 远程分支不存在，将执行首次推送')
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
          throw fetchError
        }
      }
    } catch (remoteCheckError) {
      console.warn('❌ 检查远程仓库状态失败:', remoteCheckError)
      // 【安全修复】如果无法检查远程状态，为了安全起见，假设远程不为空且有数据
      // 这样可以防止在网络错误时误判为空仓库而导致覆盖远程数据
      console.warn('⚠️ 出于安全考虑，默认假设远程仓库存在数据 (Fail-Safe)')
      isRemoteEmpty = false
      remoteHasData = true
      remotePullSuccess = false
    }

    console.log(`📊 远程仓库状态检查结果:`)
    console.log(`   isRemoteEmpty: ${isRemoteEmpty}`)
    console.log(`   remotePullSuccess: ${remotePullSuccess}`)
    console.log(`   remoteHasData: ${remoteHasData}`)

    return { isRemoteEmpty, remotePullSuccess, remoteHasData }
  }

  /**
   * 【新增】验证远程数据文件内容
   * 不仅检查文件是否存在，还验证文件内容是否包含有效数据
   */
  private async validateRemoteDataContent(git: SimpleGit, targetBranch: string): Promise<boolean> {
    try {
      console.log(`🔍 验证远程数据文件内容（真实文件存储模式）...`)

      // 优先检查极简真实文件存储格式（纯代码文件，无元数据）
      try {
        // 获取远程仓库所有文件列表
        const fileList = await git.raw(['ls-tree', '-r', '--name-only', `origin/${targetBranch}`])
        const files = fileList
          .trim()
          .split('\n')
          .filter((f) => f.trim())

        console.log(`   📁 远程仓库包含 ${files.length} 个文件`)

        if (files.length === 0) {
          console.log(`   📋 远程仓库为空`)
          return false
        }

        // 过滤出真正的代码文件（排除特殊文件）
        const codeFiles = files.filter((file) => {
          const fileName = file.split('/').pop() || ''

          // 排除系统文件、配置文件、文档文件
          if (
            fileName.startsWith('.') ||
            fileName === 'README.md' ||
            fileName === 'LICENSE' ||
            fileName.endsWith('.json')
          ) {
            return false
          }

          // 检查是否为代码文件（有扩展名或特定命名模式）
          return fileName.includes('.') || /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(fileName)
        })

        console.log(`   📄 检测到 ${codeFiles.length} 个代码文件`)

        // 统计目录数量
        const directories = new Set<string>()
        for (const file of codeFiles) {
          const dirPath = file.split('/').slice(0, -1).join('/')
          if (dirPath) {
            directories.add(dirPath)
          }
        }

        console.log(`   📊 实际统计: ${codeFiles.length} 个代码片段文件, ${directories.size} 个目录`)

        // 只要有代码文件，就认为是极简真实文件存储格式
        if (codeFiles.length > 0) {
          console.log(`   ✅ 远程极简真实文件存储数据验证通过`)
          return true
        } else {
          console.log(`   📋 远程仓库无有效代码文件`)
          return false
        }
      } catch (realFileError) {
        console.log(`   🔄 未检测到真实文件存储格式，尝试兼容旧JSON格式...`)

        // 兼容旧的JSON存储格式
        return await this.validateRemoteDataContentLegacy(git, targetBranch)
      }
    } catch (error) {
      console.error(`❌ 验证远程数据内容失败:`, error)
      // 【安全修复】验证失败时，默认假设有数据，避免误判导致数据丢失
      return true
    }
  }

  /**
   * 验证远程数据内容（兼容旧JSON格式）
   */
  private async validateRemoteDataContentLegacy(git: SimpleGit, targetBranch: string): Promise<boolean> {
    try {
      console.log(`🔍 验证远程数据文件内容（兼容JSON格式）...`)

      // 尝试读取远程分支的snippets.json文件
      let snippetsContent: string
      try {
        snippetsContent = await git.show([`origin/${targetBranch}:snippets.json`])
        console.log(`   📄 snippets.json 内容长度: ${snippetsContent.length} 字符`)
      } catch (snippetsError) {
        console.log(`   ❌ 无法读取远程 snippets.json:`, snippetsError)
        return false
      }

      // 验证JSON格式
      let snippetsData: any[]
      try {
        snippetsData = JSON.parse(snippetsContent)
        console.log(`   ✅ snippets.json JSON解析成功`)
      } catch (parseError) {
        console.error(`   ❌ snippets.json JSON解析失败:`, parseError)
        return false
      }

      // 验证是否为数组
      if (!Array.isArray(snippetsData)) {
        console.error(`   ❌ snippets.json 不是数组格式:`, typeof snippetsData)
        return false
      }

      console.log(`   📊 远程代码片段数量: ${snippetsData.length}`)

      if (snippetsData.length === 0) {
        console.log(`   📋 远程代码片段为空数组`)
        return false
      }

      console.log(`   ✅ 远程JSON数据验证通过: ${snippetsData.length} 个代码片段`)
      return true
    } catch (error) {
      console.error(`❌ 兼容模式验证失败:`, error)
      // 【安全修复】验证失败时，默认假设有数据
      return true
    }
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
            details: `远程有 ${logOutput.total} 个新提交需要拉取`,
          }
        }

        return {
          hasUpdates: false,
          details: '远程没有新的更新',
        }
      } catch (logError) {
        console.warn('检查远程更新时出现错误:', logError)
        return {
          hasUpdates: false,
          details: '远程分支可能不存在，将执行首次推送',
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
      const remoteHasBranch = remoteBranches.all.some((branch) => branch.includes(`origin/${targetBranch}`))

      if (!remoteHasBranch) {
        return {
          success: false,
          message: `远程分支 origin/${targetBranch} 不存在`,
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
        message: `成功重置到远程分支 origin/${targetBranch}`,
      }
    } catch (error) {
      return {
        success: false,
        message: `重置到远程分支失败: ${error}`,
      }
    }
  }
}
