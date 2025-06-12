import * as vscode from 'vscode'
import { SimpleGit } from 'simple-git'
import { CodeSnippet, Directory } from '../../types/types'
import { FileSystemManager } from './fileSystemManager'
import { GitStandardConflictDetector } from '../conflict/gitStandardConflictDetector'

/**
 * 三路合并管理器
 * 实现正确的Git三路合并逻辑：base vs local vs remote
 */
export class ThreeWayMergeManager {
  private git: SimpleGit
  private fileSystemManager: FileSystemManager
  private standardConflictDetector: GitStandardConflictDetector

  constructor(git: SimpleGit, fileSystemManager: FileSystemManager) {
    this.git = git
    this.fileSystemManager = fileSystemManager
    this.standardConflictDetector = new GitStandardConflictDetector()
  }

  /**
   * 【Git 标准】执行标准三路合并
   * 使用新的 GitStandardMerger 和 GitStandardConflictDetector
   * 完全遵循 Git 的合并逻辑和冲突检测
   */
  public async performStandardThreeWayMerge(
    localSnippets: CodeSnippet[],
    localDirectories: Directory[],
    remoteSnippets: CodeSnippet[],
    remoteDirectories: Directory[]
  ): Promise<{
    success: boolean
    message?: string
    hasChanges: boolean
    mergedSnippets: CodeSnippet[]
    mergedDirectories: Directory[]
    needsVSCodeUpdate: boolean
    needsGitUpdate: boolean
    conflictsDetected?: boolean
    conflictDetails?: string[]
  }> {
    try {
      console.log('🚀 执行Git标准三路合并...')
      
      // 1. 获取共同祖先（merge-base）
      const baseData = await this.getGitBaselineData()
      console.log(`📊 三方数据对比:`)
      console.log(`   共同祖先: ${baseData.snippets.length} 个代码片段, ${baseData.directories.length} 个目录`)
      console.log(`   本地工作区: ${localSnippets.length} 个代码片段, ${localDirectories.length} 个目录`)
      console.log(`   远程分支: ${remoteSnippets.length} 个代码片段, ${remoteDirectories.length} 个目录`)

      // 2. 检测冲突
      const conflicts: string[] = []
      const mergedSnippets: CodeSnippet[] = []
      const mergedDirectories: Directory[] = []

      // 处理所有可能存在的代码片段路径
      const allPaths = new Set<string>()
      baseData.snippets.forEach(s => allPaths.add(s.fullPath))
      localSnippets.forEach(s => allPaths.add(s.fullPath))
      remoteSnippets.forEach(s => allPaths.add(s.fullPath))

      // 逐一检查每个路径的冲突情况
      for (const path of allPaths) {
        const baseSnippet = baseData.snippets.find(s => s.fullPath === path) || null
        const localSnippet = localSnippets.find(s => s.fullPath === path) || null
        const remoteSnippet = remoteSnippets.find(s => s.fullPath === path) || null

        const conflictResult = this.standardConflictDetector.detectSnippetConflict(
          baseSnippet, localSnippet, remoteSnippet, path
        )

        if (conflictResult.hasConflict) {
          console.log(`⚡ 检测到冲突: ${conflictResult.details}`)
          conflicts.push(conflictResult.details)
        } else {
          // 没有冲突，执行标准合并逻辑
          const mergedSnippet = this.mergeSnippetWithoutConflict(baseSnippet, localSnippet, remoteSnippet)
          if (mergedSnippet) {
            mergedSnippets.push(mergedSnippet)
          }
        }
      }

      // 处理目录（同样的逻辑）
      const allDirPaths = new Set<string>()
      baseData.directories.forEach(d => allDirPaths.add(d.fullPath))
      localDirectories.forEach(d => allDirPaths.add(d.fullPath))
      remoteDirectories.forEach(d => allDirPaths.add(d.fullPath))

      for (const path of allDirPaths) {
        const baseDir = baseData.directories.find(d => d.fullPath === path) || null
        const localDir = localDirectories.find(d => d.fullPath === path) || null
        const remoteDir = remoteDirectories.find(d => d.fullPath === path) || null

        const conflictResult = this.standardConflictDetector.detectDirectoryConflict(
          baseDir, localDir, remoteDir, path
        )

        if (conflictResult.hasConflict) {
          console.log(`⚡ 检测到目录冲突: ${conflictResult.details}`)
          conflicts.push(conflictResult.details)
        } else {
          // 没有冲突，执行标准合并逻辑
          const mergedDir = this.mergeDirectoryWithoutConflict(baseDir, localDir, remoteDir)
          if (mergedDir) {
            mergedDirectories.push(mergedDir)
          }
        }
      }

      // 3. 如果有冲突，提供用户选择选项
      if (conflicts.length > 0) {
        console.log(`⚡ 检测到 ${conflicts.length} 个冲突，需要用户决定`)
        
        // 在VSCode环境中显示冲突解决选项
        const resolution = await this.showConflictResolutionDialog(conflicts)
        
        if (resolution === 'cancel') {
          console.log('用户取消了同步操作')
          return {
            success: false,
            message: '用户取消了同步操作',
            hasChanges: false,
            mergedSnippets: localSnippets,
            mergedDirectories: localDirectories,
            needsVSCodeUpdate: false,
            needsGitUpdate: false,
            conflictsDetected: true,
            conflictDetails: conflicts
          }
        }
        
        // 根据用户选择应用解决方案
        const resolvedData = this.applyConflictResolution(
          baseData.snippets, baseData.directories,
          localSnippets, localDirectories,
          remoteSnippets, remoteDirectories,
          conflicts, resolution
        )
        
        mergedSnippets.push(...resolvedData.mergedSnippets)
        mergedDirectories.push(...resolvedData.mergedDirectories)
        
        console.log(`✅ 冲突已解决（策略：${resolution}）: ${mergedSnippets.length} 个代码片段, ${mergedDirectories.length} 个目录`)
      }

      // 4. 计算是否有变更
      const hasChanges = this.hasDataChanges(baseData.snippets, mergedSnippets) ||
                        this.hasDataChanges(baseData.directories as any[], mergedDirectories as any[])
      
      const needsVSCodeUpdate = this.hasDataChanges(localSnippets, mergedSnippets) ||
                               this.hasDataChanges(localDirectories as any[], mergedDirectories as any[])
      
      const needsGitUpdate = hasChanges

      console.log(`✅ 合并完成: ${mergedSnippets.length} 个代码片段, ${mergedDirectories.length} 个目录`)
      console.log(`📊 变更情况: hasChanges=${hasChanges}, needsVSCodeUpdate=${needsVSCodeUpdate}, needsGitUpdate=${needsGitUpdate}`)

      return {
        success: true,
        message: '✅ Git 标准三路合并完成',
        hasChanges,
        mergedSnippets,
        mergedDirectories,
        needsVSCodeUpdate,
        needsGitUpdate,
        conflictsDetected: false,
        conflictDetails: []
      }

    } catch (error) {
      console.error('❌ Git标准三路合并失败:', error)
      return {
        success: false,
        message: `Git标准三路合并失败: ${error instanceof Error ? error.message : '未知错误'}`,
        hasChanges: false,
        mergedSnippets: localSnippets,
        mergedDirectories: localDirectories,
        needsVSCodeUpdate: false,
        needsGitUpdate: false
      }
    }
  }

  /**
   * 【Git 标准】合并没有冲突的代码片段
   * 按照 Git 的逻辑进行合并
   * 
   * 注意：这个方法只应该在确认没有冲突的情况下调用
   * 冲突检测应该在调用此方法之前完成
   */
  private mergeSnippetWithoutConflict(
    base: CodeSnippet | null,
    local: CodeSnippet | null,
    remote: CodeSnippet | null
  ): CodeSnippet | null {
    // 三方都不存在
    if (!base && !local && !remote) {
      return null
    }

    // 只有一方存在（新增情况）
    if (!base && !local && remote) {
      return remote  // 远程新增
    }
    if (!base && local && !remote) {
      return local   // 本地新增
    }

    // 双方都删除了基线中的内容
    if (base && !local && !remote) {
      return null // 双方都删除了，确实应该删除
    }

    // ⚠️ 关键修复：以下情况都是冲突，不应该在这里处理
    // 这些情况应该在冲突检测阶段被识别并交给用户决定
    
    // 一方删除，一方修改/保留 → 应该是冲突
    if (base && local && !remote) {
      console.warn(`⚠️ 检测到修改-删除冲突被错误地标记为无冲突: ${base.fullPath}`)
      return local // 临时返回本地版本，但这应该是冲突
    }
    
    if (base && !local && remote) {
      console.warn(`⚠️ 检测到删除-修改冲突被错误地标记为无冲突: ${base.fullPath}`)
      return remote // 临时返回远程版本，但这应该是冲突
    }

    // 三方都存在且确认无冲突，优先选择远程版本
    if (base && local && remote) {
      return remote
    }

    // 双方都新增相同路径的内容（已确认无冲突）
    if (!base && local && remote) {
      return remote // 选择远程版本
    }

    return local // 默认情况
  }

  /**
   * 【Git 标准】合并没有冲突的目录
   * 按照 Git 的逻辑进行合并
   */
  private mergeDirectoryWithoutConflict(
    base: Directory | null,
    local: Directory | null,
    remote: Directory | null
  ): Directory | null {
    // 类似代码片段的逻辑
    if (!base && !local && !remote) {
      return null
    }
    if (!base && !local && remote) {
      return remote
    }
    if (!base && local && !remote) {
      return local
    }
    if (base && !local && !remote) {
      return null
    }
    if (base && local && !remote) {
      return null
    }
    if (base && !local && remote) {
      return null
    }
    if (base && local && remote) {
      return remote
    }
    if (!base && local && remote) {
      return remote
    }

    return local
  }

  /**
   * 检查数据是否有变更
   */
  private hasDataChanges(data1: any[], data2: any[]): boolean {
    if (data1.length !== data2.length) {
      return true
    }
    
    // 简单的内容比较
    const str1 = JSON.stringify(data1.sort((a, b) => a.fullPath?.localeCompare(b.fullPath)))
    const str2 = JSON.stringify(data2.sort((a, b) => a.fullPath?.localeCompare(b.fullPath)))
    
    return str1 !== str2
  }

  /**
   * 执行正确的三路合并（保留原有方法以向后兼容）
   * @param localVSCodeSnippets 本地VSCode当前状态
   * @param localVSCodeDirectories 本地VSCode当前目录
   * @param remoteSnippets 远程Git状态
   * @param remoteDirectories 远程Git目录
   */
  public async performThreeWayMerge(
    localVSCodeSnippets: CodeSnippet[],
    localVSCodeDirectories: Directory[],
    remoteSnippets: CodeSnippet[],
    remoteDirectories: Directory[]
  ): Promise<{
    success: boolean
    message?: string
    hasChanges: boolean
    mergedSnippets: CodeSnippet[]
    mergedDirectories: Directory[]
    needsVSCodeUpdate: boolean
    needsGitUpdate: boolean
    conflictsDetected?: boolean
    conflictDetails?: any[]
    analysis: {
      localChanges: string[]
      remoteChanges: string[]
      realConflicts: string[]
      autoResolved: string[]
    }
  }> {
    try {
      console.log('🔍 开始真正的三路合并分析...')
      
      // 步骤1: 获取Git历史基线（最后一次提交的状态）
      const baseData = await this.getGitBaselineData()
      
      console.log(`📋 数据对比:`)
      console.log(`   Git基线: ${baseData.snippets.length} 个代码片段, ${baseData.directories.length} 个目录`)
      console.log(`   VSCode本地: ${localVSCodeSnippets.length} 个代码片段, ${localVSCodeDirectories.length} 个目录`)
      console.log(`   远程Git: ${remoteSnippets.length} 个代码片段, ${remoteDirectories.length} 个目录`)

      // 【安全检查】检测本地数据清空情况
      const isLocalEmpty = localVSCodeSnippets.length === 0
      const isRemoteNotEmpty = remoteSnippets.length > 0
      const isBaseNotEmpty = baseData.snippets.length > 0

      // 【Git 标准】不做过度保护，忠实记录用户操作
      if (isLocalEmpty && (isRemoteNotEmpty || isBaseNotEmpty)) {
        console.log(`🔍 检测到本地数据为空，远程/基线有数据`)
        console.log(`   本地空数据: ${isLocalEmpty}`)
        console.log(`   远程有数据: ${isRemoteNotEmpty}`) 
        console.log(`   基线有数据: ${isBaseNotEmpty}`)
        console.log('📝 按 Git 标准：如实记录用户的删除操作')
      }

      // 步骤2: 分析本地变更（VSCode vs Git基线）
      const localChanges = this.analyzeChanges(baseData.snippets, localVSCodeSnippets, 'local')
      console.log(`🏠 本地变更分析: ${localChanges.modified.length} 修改, ${localChanges.added.length} 新增, ${localChanges.deleted.length} 删除`)

      // 步骤3: 分析远程变更（远程 vs Git基线）
      const remoteChanges = this.analyzeChanges(baseData.snippets, remoteSnippets, 'remote')
      console.log(`☁️ 远程变更分析: ${remoteChanges.modified.length} 修改, ${remoteChanges.added.length} 新增, ${remoteChanges.deleted.length} 删除`)

      // 步骤4: 识别真正的冲突（双方都修改了同一文件）
      const conflicts = this.identifyRealConflicts(localChanges, remoteChanges)
      console.log(`⚡ 真正冲突: ${conflicts.length} 个`)

      // 步骤5: 执行智能合并
      const mergeResult = await this.performSmartMerge(
        baseData.snippets,
        localVSCodeSnippets,
        remoteSnippets,
        localChanges,
        remoteChanges,
        conflicts
      )

      // 步骤6: 分析结果和建议
      const analysis = {
        localChanges: this.formatChangesList(localChanges),
        remoteChanges: this.formatChangesList(remoteChanges),
        realConflicts: conflicts.map(c => c.fullPath),
        autoResolved: mergeResult.autoResolved.map(r => `${r.fullPath}: ${r.resolution}`)
      }

      // 构建详细的合并消息
      let detailedMessage = this.buildDetailedMergeMessage(analysis, mergeResult)

      return {
        success: true,
        message: detailedMessage,
        hasChanges: mergeResult.hasChanges,
        mergedSnippets: mergeResult.mergedSnippets,
        mergedDirectories: mergeResult.mergedDirectories,
        needsVSCodeUpdate: mergeResult.needsVSCodeUpdate,
        needsGitUpdate: mergeResult.needsGitUpdate,
        conflictsDetected: conflicts.length > 0,
        conflictDetails: mergeResult.conflictDetails,
        analysis
      }

    } catch (error) {
      console.error('三路合并失败:', error)
      return {
        success: false,
        message: `三路合并失败: ${error instanceof Error ? error.message : '未知错误'}`,
        hasChanges: false,
        mergedSnippets: localVSCodeSnippets,
        mergedDirectories: localVSCodeDirectories,
        needsVSCodeUpdate: false,
        needsGitUpdate: false,
        analysis: {
          localChanges: [],
          remoteChanges: [],
          realConflicts: [],
          autoResolved: []
        }
      }
    }
  }

  /**
   * 获取Git基线数据（最后一次提交的状态）
   * 【修复】实现多源基线数据获取策略，确保基线数据的可靠性
   */
  /**
   * 【Git 标准】获取基线数据 - 使用 merge-base 获取真正的共同祖先
   * 参考：https://git-scm.com/docs/git-merge-base
   */
  private async getGitBaselineData(): Promise<{ snippets: CodeSnippet[]; directories: Directory[] }> {
    try {
      console.log('🔍 获取Git基线数据（使用标准merge-base）...')
      
      // 获取当前分支
      const currentBranch = await this.git.revparse(['--abbrev-ref', 'HEAD']).catch(() => 'main')
      const remoteBranch = `origin/${currentBranch}`
      
      console.log(`   当前分支: ${currentBranch}`)
      console.log(`   远程分支: ${remoteBranch}`)
      
      try {
        // 【Git 标准】使用 merge-base 获取共同祖先
        const mergeBase = await this.git.raw(['merge-base', 'HEAD', remoteBranch])
        const baseCommit = mergeBase.trim()
        
        console.log(`✅ 找到共同祖先: ${baseCommit.substring(0, 8)}`)
        
        // 从共同祖先读取数据
        const baselineData = await this.readDataFromCommit(baseCommit)
        
        if (baselineData) {
          console.log(`📊 基线数据: ${baselineData.snippets.length} 个代码片段, ${baselineData.directories.length} 个目录`)
          return baselineData
        }
        
      } catch (mergeBaseError) {
        console.warn('⚠️ 无法获取共同祖先，可能是新仓库:', mergeBaseError)
      }
      
      // 如果没有共同祖先，按 Git 标准使用空基线（等同于初始合并）
      console.log('📋 使用空基线（初始合并）')
      return { snippets: [], directories: [] }
      
    } catch (error) {
      console.error('❌ 获取Git基线数据失败:', error)
      console.log('⚠️ 使用空基线作为回退方案')
      return { snippets: [], directories: [] }
    }
  }



  /**
   * 【Git 标准】简化的getLocalBaseline，直接使用标准基线
  ): Promise<{ isValid: boolean; reason?: string }> {
    try {
      console.log(`🔍 验证基线数据合理性 (策略: ${strategy})...`)
      
      // 检查1: 数据结构完整性
      if (!this.isValidBaselineData(baselineData)) {
        return { isValid: false, reason: '数据结构不完整' }
      }

      // 检查2: 对于HEAD提交，验证与工作目录的一致性
      if (strategy === 'HEAD提交' && baselineData.snippets.length === 0) {
        try {
      const workingDirData = await this.fileSystemManager.readFromGit()
      if (workingDirData.snippets.length > 0) {
            console.log(`   ⚠️ HEAD提交为空但工作目录有 ${workingDirData.snippets.length} 个代码片段`)
            console.log(`   💡 这可能表明最近的提交有问题`)
            return { isValid: false, reason: 'HEAD提交与工作目录不一致' }
          }
        } catch (workingDirError) {
          console.warn(`   无法读取工作目录进行验证:`, workingDirError)
        }
      }
      
      // 检查3: 验证数据的时间戳合理性
      const now = Date.now()
      let suspiciousTimestamps = 0
      
      for (const snippet of baselineData.snippets) {
        if (snippet.createTime && (snippet.createTime > now || snippet.createTime < 0)) {
          suspiciousTimestamps++
        }
      }
      
      if (suspiciousTimestamps > 0) {
        console.log(`   ⚠️ 发现 ${suspiciousTimestamps} 个可疑的时间戳`)
        return { isValid: false, reason: '数据时间戳异常' }
      }
      
      console.log(`   ✅ 基线数据验证通过`)
      return { isValid: true }

    } catch (error) {
      console.error(`   ❌ 基线数据验证失败:`, error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { isValid: false, reason: `验证过程出错: ${errorMessage}` }
    }
  }

  /**
   * 【新增】尝试安全恢复策略
   */
  private async attemptSafeRecovery(): Promise<{ snippets: CodeSnippet[]; directories: Directory[] } | null> {
    try {
      console.log(`🛡️ 开始安全恢复策略...`)
      
      // 策略1: 尝试从最近的有效提交恢复
      console.log(`   尝试从最近的有效提交恢复...`)
      try {
        const recentCommits = await this.git.log({ maxCount: 10 })
        
        for (const commit of recentCommits.all) {
          console.log(`   检查提交: ${commit.hash.substring(0, 8)} - ${commit.message}`)
          
          const commitData = await this.readDataFromCommit(commit.hash)
          if (commitData && commitData.snippets.length > 0) {
            console.log(`   ✅ 从提交 ${commit.hash.substring(0, 8)} 恢复数据`)
            return commitData
          }
        }
      } catch (historyError) {
        console.log(`   无法访问提交历史:`, historyError)
      }
      
      // 策略2: 尝试从备份文件恢复（如果存在）
      console.log(`   尝试从备份文件恢复...`)
      try {
        const backupData = await this.attemptBackupRecovery()
        if (backupData) {
          return backupData
        }
      } catch (backupError) {
        console.log(`   备份恢复失败:`, backupError)
      }
      
      console.log(`   ❌ 所有安全恢复策略都失败`)
      return null
      
    } catch (error) {
      console.error(`❌ 安全恢复过程失败:`, error)
      return null
    }
  }

  /**
   * 【新增】尝试从备份文件恢复
   */
  private async attemptBackupRecovery(): Promise<{ snippets: CodeSnippet[]; directories: Directory[] } | null> {
    // 这里可以实现从备份文件恢复的逻辑
    // 目前先返回null，表示没有可用的备份
    console.log(`   没有可用的备份文件`)
    return null
  }

  /**
   * 从指定提交读取数据（真实文件存储版本）
   */
  private async readDataFromCommit(commit: string): Promise<{ snippets: CodeSnippet[]; directories: Directory[] } | null> {
    try {
      console.log(`📖 正在从提交 ${commit} 读取数据（真实文件存储模式）...`)
      
      // 检查提交是否存在根目录元数据文件
      let metadataContent: string
      try {
        metadataContent = await this.git.show([`${commit}:.snippet-meta.json`])
        console.log(`   ✅ 成功读取 ${commit}:.snippet-meta.json (${metadataContent.length} 字符)`)
        
        // 解析根目录元数据
        const metadata = JSON.parse(metadataContent)
        console.log(`   📊 提交中包含 ${metadata.totalSnippets || 0} 个代码片段, ${metadata.totalDirectories || 0} 个目录`)
        
        // 从提交中重建真实文件结构数据
        const fileList = await this.git.raw(['ls-tree', '-r', '--name-only', commit])
        const files = fileList.trim().split('\n').filter(f => f.trim())
        
        console.log(`   📁 提交中包含 ${files.length} 个文件`)
        
        // 扫描代码片段文件
        const snippets: CodeSnippet[] = []
        const directories: Directory[] = []
        const processedDirs = new Set<string>()
        
        for (const file of files) {
          if (file.endsWith('.meta.json') && !file.startsWith('.snippet-meta.json')) {
            // 代码片段元数据文件
            try {
              const metaContent = await this.git.show([`${commit}:${file}`])
              const snippetMeta = JSON.parse(metaContent)
              
              // 获取对应的代码文件
              const codeFile = file.replace('.meta.json', '')
              const codeContent = await this.git.show([`${commit}:${codeFile}`])
          
              // 构建代码片段对象
              const snippet: CodeSnippet = {
                ...snippetMeta,
                code: codeContent,
                fileName: codeFile.split('/').pop() || codeFile,
                filePath: codeFile.includes('/') ? codeFile.substring(0, codeFile.lastIndexOf('/')) : ''
              }
              
              snippets.push(snippet)
              
              console.log(`   📄 解析代码片段: ${snippet.fullPath} (${snippet.language})`)
              
            } catch (snippetError) {
              console.warn(`   ⚠️ 跳过无效代码片段: ${file}`, snippetError)
          }
          } else if (file.endsWith('/.snippet-meta.json')) {
            // 目录元数据文件
            const dirPath = file.replace('/.snippet-meta.json', '')
            if (!processedDirs.has(dirPath)) {
              try {
                const dirMetaContent = await this.git.show([`${commit}:${file}`])
                const dirMeta = JSON.parse(dirMetaContent)
                
                directories.push(dirMeta)
                processedDirs.add(dirPath)
                
                console.log(`   📁 解析目录: ${dirMeta.fullPath}`)
                
              } catch (dirError) {
                console.warn(`   ⚠️ 跳过无效目录: ${file}`, dirError)
              }
            }
          }
        }
        
        console.log(`   🗂️ 解析结果: ${snippets.length} 个代码片段, ${directories.length} 个目录`)
        return { snippets, directories }
        
      } catch (metaError) {
        console.log(`   ❌ 无法读取 ${commit}:.snippet-meta.json，尝试兼容旧格式...`)
        
        // 兼容旧的JSON存储格式
        return await this.readDataFromCommitLegacy(commit)
      }
      
    } catch (error) {
      console.log(`   ❌ 从提交 ${commit} 读取数据失败:`, error)
      return null
    }
      }

  /**
   * 从指定提交读取数据（兼容旧JSON格式）
   */
  private async readDataFromCommitLegacy(commit: string): Promise<{ snippets: CodeSnippet[]; directories: Directory[] } | null> {
    try {
      console.log(`📖 使用兼容模式从提交 ${commit} 读取旧JSON格式数据...`)
      
      // 尝试获取snippets.json
      let snippets: CodeSnippet[] = []
      try {
        const snippetsContent = await this.git.show([`${commit}:snippets.json`])
        snippets = JSON.parse(snippetsContent)
        console.log(`   ✅ 成功读取 snippets.json: ${snippets.length} 个代码片段`)
      } catch (snippetsError) {
        console.log(`   ❌ 无法读取 ${commit}:snippets.json:`, snippetsError)
        return null
      }
      
      // 尝试获取directories.json
      let directories: Directory[] = []
      try {
        const directoriesContent = await this.git.show([`${commit}:directories.json`])
        directories = JSON.parse(directoriesContent)
        console.log(`   ✅ 成功读取 directories.json: ${directories.length} 个目录`)
      } catch (directoriesError) {
        console.log(`   ⚠️ 无法读取 ${commit}:directories.json，使用空数组`)
        directories = []
      }

      return { snippets, directories }
    } catch (error) {
      console.log(`   ❌ 兼容模式读取失败:`, error)
      return null
    }
  }

  /**
   * 分析变更（比较基线和目标状态）
   */
  private analyzeChanges(
    baseline: CodeSnippet[],
    target: CodeSnippet[],
    source: 'local' | 'remote'
  ): {
    added: CodeSnippet[]
    modified: { baseline: CodeSnippet; target: CodeSnippet; fullPath: string }[]
    deleted: CodeSnippet[]
    unchanged: CodeSnippet[]
  } {
    const added: CodeSnippet[] = []
    const modified: { baseline: CodeSnippet; target: CodeSnippet; fullPath: string }[] = []
    const deleted: CodeSnippet[] = []
    const unchanged: CodeSnippet[] = []

    // 找到新增和修改的项目
    for (const targetItem of target) {
      const baselineItem = baseline.find(b => b.fullPath === targetItem.fullPath)
      
      if (!baselineItem) {
        // 新增项目
        added.push(targetItem)
      } else if (this.hasContentDifference(baselineItem, targetItem)) {
        // 修改项目
        console.log(`📝 检测到${source}修改: ${targetItem.fullPath}`)
        console.log(`   基线版本: ${baselineItem.code?.substring(0, 30) || 'N/A'}...`)
        console.log(`   ${source}版本: ${targetItem.code?.substring(0, 30) || 'N/A'}...`)
        modified.push({ baseline: baselineItem, target: targetItem, fullPath: targetItem.fullPath })
      } else {
        // 未变更项目
        unchanged.push(targetItem)
      }
    }

    // 找到删除的项目
    for (const baselineItem of baseline) {
      const targetItem = target.find(t => t.fullPath === baselineItem.fullPath)
      if (!targetItem) {
        deleted.push(baselineItem)
      }
    }

    console.log(`${source === 'local' ? '🏠' : '☁️'} ${source}变更详情:`)
    console.log(`   新增: ${added.map(a => a.fullPath).join(', ') || '无'}`)
    console.log(`   修改: ${modified.map(m => m.fullPath).join(', ') || '无'}`)
    console.log(`   删除: ${deleted.map(d => d.fullPath).join(', ') || '无'}`)

    return { added, modified, deleted, unchanged }
  }

  /**
   * 识别真正的冲突（双方都修改了同一文件）
   */
  private identifyRealConflicts(
    localChanges: any,
    remoteChanges: any
  ): Array<{
    fullPath: string
    type: 'both_modified' | 'add_add_conflict' | 'modify_delete_conflict'
    local: any
    remote: any
  }> {
    const conflicts: any[] = []

    // 类型1: 双方都修改了同一文件
    for (const localMod of localChanges.modified) {
      const remoteMod = remoteChanges.modified.find((r: any) => r.fullPath === localMod.fullPath)
      if (remoteMod) {
        conflicts.push({
          fullPath: localMod.fullPath,
          type: 'both_modified',
          local: localMod,
          remote: remoteMod
        })
      }
    }

    // 类型2: 双方都新增了同一路径的文件
    for (const localAdd of localChanges.added) {
      const remoteAdd = remoteChanges.added.find((r: CodeSnippet) => r.fullPath === localAdd.fullPath)
      if (remoteAdd && this.hasContentDifference(localAdd, remoteAdd)) {
        conflicts.push({
          fullPath: localAdd.fullPath,
          type: 'add_add_conflict',
          local: localAdd,
          remote: remoteAdd
        })
      }
    }

    // 类型3: 一方修改，另一方删除
    for (const localMod of localChanges.modified) {
      const remoteDeleted = remoteChanges.deleted.find((r: CodeSnippet) => r.fullPath === localMod.fullPath)
      if (remoteDeleted) {
        conflicts.push({
          fullPath: localMod.fullPath,
          type: 'modify_delete_conflict',
          local: localMod,
          remote: { action: 'delete', item: remoteDeleted }
        })
      }
    }

    for (const remoteMod of remoteChanges.modified) {
      const localDeleted = localChanges.deleted.find((l: CodeSnippet) => l.fullPath === remoteMod.fullPath)
      if (localDeleted) {
        conflicts.push({
          fullPath: remoteMod.fullPath,
          type: 'modify_delete_conflict',
          local: { action: 'delete', item: localDeleted },
          remote: remoteMod
        })
      }
    }

    return conflicts
  }

  /**
   * 执行智能合并
   */
  private async performSmartMerge(
    baseline: CodeSnippet[],
    local: CodeSnippet[],
    remote: CodeSnippet[],
    localChanges: any,
    remoteChanges: any,
    conflicts: any[]
  ): Promise<{
    mergedSnippets: CodeSnippet[]
    mergedDirectories: Directory[]
    hasChanges: boolean
    needsVSCodeUpdate: boolean
    needsGitUpdate: boolean
    autoResolved: any[]
    conflictDetails: any[]
  }> {
    const mergedSnippets: CodeSnippet[] = [...baseline] // 从基线开始
    const autoResolved: any[] = []
    const conflictDetails: any[] = []

    console.log(`🔧 开始合并处理:`)
    console.log(`   baseline: ${baseline.length} 个代码片段`)
    console.log(`   localChanges.modified: ${localChanges.modified.length} 个`)
    console.log(`   remoteChanges.modified: ${remoteChanges.modified.length} 个`)
    console.log(`   conflicts: ${conflicts.length} 个`)

    // 1. 应用无冲突的本地变更
    for (const added of localChanges.added) {
      if (!conflicts.find(c => c.fullPath === added.fullPath)) {
        const existingIndex = mergedSnippets.findIndex(s => s.fullPath === added.fullPath)
        if (existingIndex >= 0) {
          mergedSnippets[existingIndex] = added
        } else {
          mergedSnippets.push(added)
        }
        autoResolved.push({ fullPath: added.fullPath, resolution: 'local_add' })
      }
    }

    console.log(`🔍 遍历本地修改项: ${localChanges.modified.length} 个`)
    for (const modified of localChanges.modified) {
      console.log(`  检查本地修改: ${modified.fullPath}`)
      
      const hasConflict = conflicts.find(c => c.fullPath === modified.fullPath)
      console.log(`    是否有冲突: ${hasConflict ? 'YES' : 'NO'}`)
      
      if (!hasConflict) {
        const existingIndex = mergedSnippets.findIndex(s => s.fullPath === modified.fullPath)
        console.log(`    在合并结果中的索引: ${existingIndex}`)
        
        if (existingIndex >= 0) {
          console.log(`🔄 应用本地修改到合并结果: ${modified.fullPath}`)
          console.log(`   基线内容: ${modified.baseline?.code?.substring(0, 50) || 'N/A'}...`)
          console.log(`   本地修改后: ${modified.target?.code?.substring(0, 50) || 'N/A'}...`)
          console.log(`   修改前合并结果: ${mergedSnippets[existingIndex]?.code?.substring(0, 50) || 'N/A'}...`)
          
          mergedSnippets[existingIndex] = modified.target
          
          console.log(`   修改后合并结果: ${mergedSnippets[existingIndex]?.code?.substring(0, 50) || 'N/A'}...`)
          autoResolved.push({ fullPath: modified.fullPath, resolution: 'local_modify' })
        } else {
          console.log(`⚠️ 在合并结果中未找到: ${modified.fullPath}`)
        }
      } else {
        console.log(`⚠️ 跳过冲突项: ${modified.fullPath}`)
      }
    }

    for (const deleted of localChanges.deleted) {
      if (!conflicts.find(c => c.fullPath === deleted.fullPath)) {
        const existingIndex = mergedSnippets.findIndex(s => s.fullPath === deleted.fullPath)
        if (existingIndex >= 0) {
          mergedSnippets.splice(existingIndex, 1)
          autoResolved.push({ fullPath: deleted.fullPath, resolution: 'local_delete' })
        }
      }
    }

    // 2. 应用无冲突的远程变更
    for (const added of remoteChanges.added) {
      if (!conflicts.find(c => c.fullPath === added.fullPath)) {
        const existingIndex = mergedSnippets.findIndex(s => s.fullPath === added.fullPath)
        if (existingIndex >= 0) {
          mergedSnippets[existingIndex] = added
        } else {
          mergedSnippets.push(added)
        }
        autoResolved.push({ fullPath: added.fullPath, resolution: 'remote_add' })
      }
    }

    for (const modified of remoteChanges.modified) {
      if (!conflicts.find(c => c.fullPath === modified.fullPath)) {
        const existingIndex = mergedSnippets.findIndex(s => s.fullPath === modified.fullPath)
        if (existingIndex >= 0) {
          mergedSnippets[existingIndex] = modified.target
          autoResolved.push({ fullPath: modified.fullPath, resolution: 'remote_modify' })
        }
      }
    }

    for (const deleted of remoteChanges.deleted) {
      if (!conflicts.find(c => c.fullPath === deleted.fullPath)) {
        const existingIndex = mergedSnippets.findIndex(s => s.fullPath === deleted.fullPath)
        if (existingIndex >= 0) {
          mergedSnippets.splice(existingIndex, 1)
          autoResolved.push({ fullPath: deleted.fullPath, resolution: 'remote_delete' })
        }
      }
    }

    // 3. 处理冲突（目前标记为需要手动处理）
    for (const conflict of conflicts) {
      conflictDetails.push({
        fullPath: conflict.fullPath,
        type: conflict.type,
        needsManualMerge: true,
        local: conflict.local,
        remote: conflict.remote
      })
    }

    // 判断是否需要更新
    const hasLocalChanges = localChanges.added.length > 0 || localChanges.modified.length > 0 || localChanges.deleted.length > 0
    const hasRemoteChanges = remoteChanges.added.length > 0 || remoteChanges.modified.length > 0 || remoteChanges.deleted.length > 0

    console.log(`📊 合并完成统计:`)
    console.log(`   最终合并结果: ${mergedSnippets.length} 个代码片段`)
    console.log(`   hasLocalChanges: ${hasLocalChanges}`)
    console.log(`   hasRemoteChanges: ${hasRemoteChanges}`)
    console.log(`   needsVSCodeUpdate: ${hasRemoteChanges}`)
    console.log(`   needsGitUpdate: ${hasLocalChanges}`)
    
    // 输出合并结果中的代码片段摘要
    mergedSnippets.forEach(snippet => {
      console.log(`   合并结果片段: ${snippet.fullPath} - ${snippet.code?.substring(0, 30) || 'N/A'}...`)
    })

    // 【新增】合并结果验证
    console.log(`🔍 开始合并结果验证...`)
    const validationResult = await this.validateMergeResult(
      baseline,
      local,
      remote,
      mergedSnippets,
      autoResolved,
      conflicts
    )
    
    if (!validationResult.isValid) {
      console.error(`❌ 合并结果验证失败: ${validationResult.reason}`)
      
      // 如果验证失败，根据严重程度决定处理方式
      if (validationResult.severity === 'CRITICAL') {
        console.log(`🛡️ 关键错误，拒绝合并结果`)
        return {
          mergedSnippets: baseline, // 回退到基线
          mergedDirectories: [], // 目前专注于代码片段
          hasChanges: false,
          needsVSCodeUpdate: false,
          needsGitUpdate: false,
          autoResolved: [],
          conflictDetails: [{
            fullPath: 'merge-validation',
            type: 'validation_failed',
            needsManualMerge: true,
            local: { validation: validationResult },
            remote: { validation: validationResult }
          }]
        }
      } else if (validationResult.severity === 'WARNING') {
        console.log(`⚠️ 发现警告，但继续合并`)
        // 记录警告但继续
      }
    } else {
      console.log(`✅ 合并结果验证通过`)
    }

    return {
      mergedSnippets,
      mergedDirectories: [], // 目前专注于代码片段
      hasChanges: hasLocalChanges || hasRemoteChanges,
      needsVSCodeUpdate: hasRemoteChanges,
      needsGitUpdate: hasLocalChanges,
      autoResolved,
      conflictDetails
    }
  }

  /**
   * 检查内容差异
   */
  private hasContentDifference(snippet1: CodeSnippet, snippet2: CodeSnippet): boolean {
    return snippet1.name !== snippet2.name ||
           snippet1.code !== snippet2.code ||
           snippet1.category !== snippet2.category ||
           snippet1.language !== snippet2.language ||
           snippet1.fileName !== snippet2.fileName
  }

  /**
   * 格式化变更列表
   */
  private formatChangesList(changes: any): string[] {
    const result: string[] = []
    
    changes.added.forEach((item: any) => {
      result.push(`+ ${item.fullPath}`)
    })
    
    changes.modified.forEach((item: any) => {
      result.push(`~ ${item.fullPath}`)
    })
    
    changes.deleted.forEach((item: any) => {
      result.push(`- ${item.fullPath}`)
    })
    
    return result
  }

  /**
   * 构建详细的合并消息
   */
  private buildDetailedMergeMessage(analysis: any, mergeResult: any): string {
    let message = '🔄 三路合并完成\n\n'
    
    message += '📊 变更分析:\n'
    
    if (analysis.localChanges.length > 0) {
      message += `   🏠 本地变更 (${analysis.localChanges.length}):\n`
      analysis.localChanges.forEach((change: string) => {
        message += `      ${change}\n`
      })
    } else {
      message += '   🏠 本地无变更\n'
    }
    
    if (analysis.remoteChanges.length > 0) {
      message += `   ☁️ 远程变更 (${analysis.remoteChanges.length}):\n`
      analysis.remoteChanges.forEach((change: string) => {
        message += `      ${change}\n`
      })
    } else {
      message += '   ☁️ 远程无变更\n'
    }
    
    if (analysis.autoResolved.length > 0) {
      message += `\n✅ 自动解决 (${analysis.autoResolved.length}):\n`
      analysis.autoResolved.forEach((resolved: string) => {
        message += `   ${resolved}\n`
      })
    }
    
    if (analysis.realConflicts.length > 0) {
      message += `\n⚠️ 需要手动处理的冲突 (${analysis.realConflicts.length}):\n`
      analysis.realConflicts.forEach((conflict: string) => {
        message += `   ${conflict}\n`
      })
    }
    
    return message
  }

  /**
   * 获取本地基线数据（当前HEAD状态，在远程拉取之前）
   * 这是真正的三路合并基线
   */
  public async getLocalBaseline(): Promise<{ snippets: CodeSnippet[]; directories: Directory[] }> {
    console.log('🔍 获取本地基线数据（拉取前的HEAD状态）...')
    return await this.getGitBaselineData()
  }

  /**
   * 使用外部提供的基线进行三路合并
   * 这是修复后的正确三路合并方法
   */
  public async performThreeWayMergeWithBaseline(
    baselineSnippets: CodeSnippet[],
    baselineDirectories: Directory[],
    localVSCodeSnippets: CodeSnippet[],
    localVSCodeDirectories: Directory[],
    remoteSnippets: CodeSnippet[],
    remoteDirectories: Directory[]
  ): Promise<{
    success: boolean
    message?: string
    hasChanges: boolean
    mergedSnippets: CodeSnippet[]
    mergedDirectories: Directory[]
    needsVSCodeUpdate: boolean
    needsGitUpdate: boolean
    conflictsDetected?: boolean
    conflictDetails?: any[]
    analysis: {
      localChanges: string[]
      remoteChanges: string[]
      realConflicts: string[]
      autoResolved: string[]
    }
  }> {
    try {
      console.log('🔍 开始真正的三路合并分析（使用正确基线）...')
      
      console.log(`📋 数据对比:`)
      console.log(`   真实基线: ${baselineSnippets.length} 个代码片段, ${baselineDirectories.length} 个目录`)
      console.log(`   VSCode本地: ${localVSCodeSnippets.length} 个代码片段, ${localVSCodeDirectories.length} 个目录`)
      console.log(`   远程Git: ${remoteSnippets.length} 个代码片段, ${remoteDirectories.length} 个目录`)

      // 【安全检查】检测本地数据清空情况
      const isLocalEmpty = localVSCodeSnippets.length === 0
      const isRemoteNotEmpty = remoteSnippets.length > 0
      const isBaseNotEmpty = baselineSnippets.length > 0

      // 【改进】更精确的安全检查：区分正常删除和意外数据丢失
      if (isLocalEmpty && (isRemoteNotEmpty || isBaseNotEmpty)) {
        console.log(`🔍 检测到本地数据为空的情况，开始详细分析...`)
        console.log(`   本地空数据: ${isLocalEmpty}`)
        console.log(`   远程有数据: ${isRemoteNotEmpty}`) 
        console.log(`   基线有数据: ${isBaseNotEmpty}`)
        
        // 【Git 标准】按照 Git 的哲学，忠实记录用户操作
        console.log('📝 按 Git 标准：忠实记录用户的操作，不做过度保护')
      }

      // 步骤1: 分析本地变更（VSCode vs 真实基线）
      const localChanges = this.analyzeChanges(baselineSnippets, localVSCodeSnippets, 'local')
      console.log(`🏠 本地变更分析: ${localChanges.modified.length} 修改, ${localChanges.added.length} 新增, ${localChanges.deleted.length} 删除`)

      // 步骤2: 分析远程变更（远程 vs 真实基线）
      const remoteChanges = this.analyzeChanges(baselineSnippets, remoteSnippets, 'remote')
      console.log(`☁️ 远程变更分析: ${remoteChanges.modified.length} 修改, ${remoteChanges.added.length} 新增, ${remoteChanges.deleted.length} 删除`)

      // 步骤3: 识别真正的冲突（双方都修改了同一文件）
      const conflicts = this.identifyRealConflicts(localChanges, remoteChanges)
      console.log(`⚡ 真正冲突: ${conflicts.length} 个`)

      // 步骤4: 执行智能合并
      const mergeResult = await this.performSmartMerge(
        baselineSnippets,   // 使用真实基线
        localVSCodeSnippets,
        remoteSnippets,
        localChanges,
        remoteChanges,
        conflicts
      )

      // 步骤5: 分析结果和建议
      const analysis = {
        localChanges: this.formatChangesList(localChanges),
        remoteChanges: this.formatChangesList(remoteChanges),
        realConflicts: conflicts.map(c => c.fullPath),
        autoResolved: mergeResult.autoResolved.map(r => `${r.fullPath}: ${r.resolution}`)
      }

      // 构建详细的合并消息
      let detailedMessage = this.buildDetailedMergeMessage(analysis, mergeResult)

      return {
        success: true,
        message: detailedMessage,
        hasChanges: mergeResult.hasChanges,
        mergedSnippets: mergeResult.mergedSnippets,
        mergedDirectories: mergeResult.mergedDirectories,
        needsVSCodeUpdate: mergeResult.needsVSCodeUpdate,
        needsGitUpdate: mergeResult.needsGitUpdate,
        conflictsDetected: conflicts.length > 0,
        conflictDetails: mergeResult.conflictDetails,
        analysis
      }

    } catch (error) {
      console.error('三路合并失败:', error)
      return {
        success: false,
        message: `三路合并失败: ${error instanceof Error ? error.message : '未知错误'}`,
        hasChanges: false,
        mergedSnippets: localVSCodeSnippets,
        mergedDirectories: localVSCodeDirectories,
        needsVSCodeUpdate: false,
        needsGitUpdate: false,
        analysis: {
          localChanges: [],
          remoteChanges: [],
          realConflicts: [],
          autoResolved: []
        }
      }
    }
  }



  /**
   * 显示冲突解决对话框
   */
  private async showConflictResolutionDialog(conflicts: string[]): Promise<'use_remote' | 'use_local' | 'cancel'> {
    try {
      // 在VSCode环境中显示对话框
      if (typeof vscode !== 'undefined' && vscode.window) {
        const conflictSummary = conflicts.slice(0, 3).join('\n• ')
        const moreConflicts = conflicts.length > 3 ? `\n• ... 还有 ${conflicts.length - 3} 个冲突` : ''
        
        const choice = await vscode.window.showWarningMessage(
          `🔄 同步冲突需要解决\n\n检测到 ${conflicts.length} 个冲突：\n• ${conflictSummary}${moreConflicts}\n\n请选择解决策略：`,
          { modal: true },
          '使用远程版本（覆盖本地修改）',
          '使用本地版本（忽略远程修改）',
          '取消同步'
        )
        
        if (choice === '使用远程版本（覆盖本地修改）') {
          return 'use_remote'
        } else if (choice === '使用本地版本（忽略远程修改）') {
          return 'use_local'
        } else {
          return 'cancel'
        }
      }
    } catch (error) {
      console.warn('显示冲突对话框失败:', error)
    }
    
    // 非VSCode环境或对话框失败时的默认策略
    console.log('⚠️ 无法显示用户对话框，使用默认策略：保留远程版本')
    return 'use_remote'
  }

  /**
   * 应用冲突解决策略
   */
  private applyConflictResolution(
    baseSnippets: CodeSnippet[],
    baseDirectories: Directory[],
    localSnippets: CodeSnippet[],
    localDirectories: Directory[],
    remoteSnippets: CodeSnippet[],
    remoteDirectories: Directory[],
    conflicts: string[],
    resolution: 'use_remote' | 'use_local' | 'cancel'
  ): {
    mergedSnippets: CodeSnippet[]
    mergedDirectories: Directory[]
  } {
    const mergedSnippets: CodeSnippet[] = []
    const mergedDirectories: Directory[] = []
    
    console.log(`📋 应用冲突解决策略: ${resolution}`)
    
    if (resolution === 'use_remote') {
      // 使用远程版本解决所有冲突
      console.log('📡 采用远程版本解决冲突')
      mergedSnippets.push(...remoteSnippets)
      mergedDirectories.push(...remoteDirectories)
    } else if (resolution === 'use_local') {
      // 使用本地版本解决所有冲突
      console.log('🏠 采用本地版本解决冲突')
      mergedSnippets.push(...localSnippets)
      mergedDirectories.push(...localDirectories)
    }
    
    console.log(`✅ 冲突解决完成: ${mergedSnippets.length} 个代码片段, ${mergedDirectories.length} 个目录`)
    
    return {
      mergedSnippets,
      mergedDirectories
    }
  }

  /**
   * 【新增】合并结果验证
   */
  private async validateMergeResult(
    baseline: CodeSnippet[],
    local: CodeSnippet[],
    remote: CodeSnippet[],
    mergedSnippets: CodeSnippet[],
    autoResolved: any[],
    conflicts: any[]
  ): Promise<{ isValid: boolean; reason: string; severity: 'CRITICAL' | 'WARNING' }> {
    try {
      console.log(`   验证输入数据: baseline=${baseline.length}, local=${local.length}, remote=${remote.length}, merged=${mergedSnippets.length}`)
      
      // 【检查1】基本数据完整性验证
      if (!Array.isArray(mergedSnippets)) {
        return {
          isValid: false,
          reason: '合并结果不是有效的数组',
          severity: 'CRITICAL'
        }
      }
      
      // 【检查2】验证合并结果的数据结构
      for (let i = 0; i < mergedSnippets.length; i++) {
        const snippet = mergedSnippets[i]
        if (!snippet.fullPath || !snippet.name || typeof snippet.code !== 'string') {
          return {
            isValid: false,
            reason: `合并结果中第 ${i + 1} 个代码片段数据结构不完整: ${snippet.fullPath}`,
            severity: 'CRITICAL'
          }
        }
      }
      
      // 【检查3】数量合理性验证
      const maxExpectedCount = Math.max(baseline.length, local.length, remote.length)
      const totalInputs = baseline.length + local.length + remote.length
      
      if (mergedSnippets.length > totalInputs) {
        return {
          isValid: false,
          reason: `合并结果数量异常：${mergedSnippets.length} > 预期最大值 ${totalInputs}`,
          severity: 'CRITICAL'
        }
      }
      
      // 【检查4】检查是否有重复的代码片段
      const duplicates = this.findDuplicateSnippets(mergedSnippets)
      if (duplicates.length > 0) {
        return {
          isValid: false,
          reason: `合并结果包含重复的代码片段: ${duplicates.join(', ')}`,
          severity: 'CRITICAL'
        }
      }
      
      // 【检查5】验证关键代码片段是否丢失
      const lostSnippets = this.findLostSnippets(baseline, local, remote, mergedSnippets)
      if (lostSnippets.length > 0) {
        console.log(`   🔍 检测到可能丢失的代码片段: ${lostSnippets.map(s => s.fullPath).join(', ')}`)
        
        // 进一步分析是否为合理的删除
        const areReasonableDeletions = await this.validateDeletions(lostSnippets, baseline, local, remote)
        
        if (!areReasonableDeletions) {
          return {
            isValid: false,
            reason: `检测到异常的代码片段丢失: ${lostSnippets.map(s => s.fullPath).join(', ')}`,
            severity: 'CRITICAL'
          }
        } else {
          console.log(`   ✅ 确认为合理的删除操作`)
        }
      }
      
      // 【检查6】验证自动解决的冲突是否正确
      for (const resolved of autoResolved) {
        if (!resolved.fullPath || !resolved.resolution) {
          return {
            isValid: false,
            reason: `自动解决的冲突信息不完整: ${JSON.stringify(resolved)}`,
            severity: 'WARNING'
          }
        }
        
        // 检查解决的代码片段是否在合并结果中存在
        const existsInMerged = mergedSnippets.some(s => s.fullPath === resolved.fullPath)
        if (resolved.resolution !== 'local_delete' && resolved.resolution !== 'remote_delete' && !existsInMerged) {
          return {
            isValid: false,
            reason: `自动解决的代码片段 ${resolved.fullPath} 不在合并结果中`,
            severity: 'CRITICAL'
          }
        }
      }
      
      // 【检查7】验证未解决的冲突
      if (conflicts.length > 0) {
        console.log(`   ⚠️ 存在 ${conflicts.length} 个未解决的冲突`)
        return {
          isValid: false,
          reason: `存在 ${conflicts.length} 个未解决的冲突需要手动处理`,
          severity: 'WARNING' // 冲突不是错误，但需要用户关注
        }
      }
      
      // 【检查8】验证合并结果的一致性
      const consistencyCheck = await this.checkMergeConsistency(baseline, local, remote, mergedSnippets)
      if (!consistencyCheck.isConsistent) {
        return {
          isValid: false,
          reason: `合并结果一致性检查失败: ${consistencyCheck.reason}`,
          severity: 'CRITICAL'
        }
      }
      
      console.log(`   ✅ 所有验证检查通过`)
      return {
        isValid: true,
        reason: '合并结果验证通过',
        severity: 'CRITICAL' // 这里severity不重要，因为isValid为true
      }
      
    } catch (error) {
      console.error(`❌ 合并结果验证过程出错:`, error)
      return {
        isValid: false,
        reason: `验证过程出错: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'CRITICAL'
      }
    }
  }

  /**
   * 【新增】查找重复的代码片段
   */
  private findDuplicateSnippets(snippets: CodeSnippet[]): string[] {
    const seen = new Set<string>()
    const duplicates: string[] = []
    
    for (const snippet of snippets) {
      if (seen.has(snippet.fullPath)) {
        duplicates.push(snippet.fullPath)
      } else {
        seen.add(snippet.fullPath)
      }
    }
    
    return duplicates
  }

  /**
   * 【新增】查找可能丢失的代码片段
   */
  private findLostSnippets(
    baseline: CodeSnippet[],
    local: CodeSnippet[],
    remote: CodeSnippet[],
    merged: CodeSnippet[]
  ): CodeSnippet[] {
    const mergedPaths = new Set(merged.map(s => s.fullPath))
    const lostSnippets: CodeSnippet[] = []
    
    // 检查基线中的代码片段是否在合并结果中
    for (const baselineSnippet of baseline) {
      if (!mergedPaths.has(baselineSnippet.fullPath)) {
        // 检查是否在本地或远程中被删除
        const inLocal = local.some(s => s.fullPath === baselineSnippet.fullPath)
        const inRemote = remote.some(s => s.fullPath === baselineSnippet.fullPath)
        
        if (inLocal || inRemote) {
          // 如果在本地或远程中还存在，但在合并结果中不存在，这可能是问题
          lostSnippets.push(baselineSnippet)
        }
      }
    }
    
    return lostSnippets
  }

  /**
   * 【新增】验证删除操作的合理性
   */
  private async validateDeletions(
    lostSnippets: CodeSnippet[],
    baseline: CodeSnippet[],
    local: CodeSnippet[],
    remote: CodeSnippet[]
  ): Promise<boolean> {
    // 检查删除是否是一致的（本地和远程都删除了）
    for (const lost of lostSnippets) {
      const inLocal = local.some(s => s.fullPath === lost.fullPath)
      const inRemote = remote.some(s => s.fullPath === lost.fullPath)
      
      if (inLocal && inRemote) {
        // 如果在本地和远程都存在，但在合并结果中不存在，这是异常的
        console.log(`   ⚠️ 代码片段 ${lost.fullPath} 在本地和远程都存在，但在合并结果中丢失`)
        return false
      }
    }
    
    return true
  }

  /**
   * 【新增】检查合并一致性
   */
  private async checkMergeConsistency(
    baseline: CodeSnippet[],
    local: CodeSnippet[],
    remote: CodeSnippet[],
    merged: CodeSnippet[]
  ): Promise<{ isConsistent: boolean; reason: string }> {
    try {
      // 检查1: 合并结果应该包含所有非冲突的变更
      const localChanges = this.analyzeChanges(baseline, local, 'local')
      const remoteChanges = this.analyzeChanges(baseline, remote, 'remote')
      
      // 验证本地新增的代码片段是否在合并结果中
      for (const added of localChanges.added) {
        const inMerged = merged.some(s => s.fullPath === added.fullPath)
        if (!inMerged) {
          return {
            isConsistent: false,
            reason: `本地新增的代码片段 ${added.fullPath} 未出现在合并结果中`
          }
        }
      }
      
      // 验证远程新增的代码片段是否在合并结果中
      for (const added of remoteChanges.added) {
        const inMerged = merged.some(s => s.fullPath === added.fullPath)
        if (!inMerged) {
          return {
            isConsistent: false,
            reason: `远程新增的代码片段 ${added.fullPath} 未出现在合并结果中`
          }
        }
      }
      
      return {
        isConsistent: true,
        reason: '合并一致性检查通过'
      }
      
    } catch (error) {
      return {
        isConsistent: false,
        reason: `一致性检查过程出错: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }
} 