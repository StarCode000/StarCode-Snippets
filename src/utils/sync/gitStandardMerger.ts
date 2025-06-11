import { SimpleGit } from 'simple-git'
import { CodeSnippet, Directory } from '../../types/types'

/**
 * Git 标准三路合并器
 * 
 * 严格遵循 Git 的三路合并标准：
 * 1. 使用 git merge-base 获取真正的共同祖先
 * 2. 比较 base vs local, base vs remote 的变更
 * 3. 只在真正冲突时报告冲突
 * 4. 忠实记录用户操作，不做过度保护
 * 
 * 参考：https://git-scm.com/docs/git-merge-base
 */
export class GitStandardMerger {
  private git: SimpleGit

  constructor(git: SimpleGit) {
    this.git = git
  }

  /**
   * 获取真正的共同祖先（merge-base）
   * 
   * Git 标准：使用 git merge-base 找到最好的公共祖先
   * 这是 Git 三路合并的基础
   */
  public async getMergeBase(localRef: string = 'HEAD', remoteRef: string = 'origin/main'): Promise<string> {
    try {
      console.log(`🔍 获取共同祖先: ${localRef} 与 ${remoteRef}`)
      
      // 使用 Git 标准命令获取 merge-base
      const mergeBase = await this.git.raw(['merge-base', localRef, remoteRef])
      const baseCommit = mergeBase.trim()
      
      console.log(`✅ 找到共同祖先: ${baseCommit.substring(0, 8)}`)
      
      // 获取基线提交的详细信息
      try {
        const logResult = await this.git.log({ from: baseCommit, maxCount: 1 })
        if (logResult.latest) {
          console.log(`   提交信息: ${logResult.latest.message}`)
          console.log(`   提交时间: ${logResult.latest.date}`)
        }
      } catch (logError) {
        console.warn(`   无法获取基线提交信息:`, logError)
      }
      
      return baseCommit
      
    } catch (error) {
      console.warn('⚠️ 无法获取共同祖先，可能是新仓库或无远程历史:', error)
      
      // 按 Git 标准处理：如果没有共同祖先，返回空树
      // 这等同于 Git 的行为：从无到有的合并
      return '4b825dc642cb6eb9a060e54bf8d69288fbee4904' // Git 的空树哈希
    }
  }

  /**
   * 执行标准 Git 三路合并
   * 
   * Git 算法：
   * 1. 对于每个文件/代码片段，比较 base->local 和 base->remote 的变更
   * 2. 如果只有一方有变更，采用有变更的一方
   * 3. 如果双方都有变更且不同，报告冲突
   * 4. 如果双方变更相同，采用共同的变更
   */
  public async performThreeWayMerge(
    baseSnippets: CodeSnippet[],
    baseDirectories: Directory[],
    localSnippets: CodeSnippet[],
    localDirectories: Directory[],
    remoteSnippets: CodeSnippet[],
    remoteDirectories: Directory[]
  ): Promise<GitMergeResult> {
    console.log('🔄 开始标准 Git 三路合并...')
    console.log(`   基线: ${baseSnippets.length} 个代码片段, ${baseDirectories.length} 个目录`)
    console.log(`   本地: ${localSnippets.length} 个代码片段, ${localDirectories.length} 个目录`)
    console.log(`   远程: ${remoteSnippets.length} 个代码片段, ${remoteDirectories.length} 个目录`)

    // 分析变更
    const localChanges = this.analyzeChanges(baseSnippets, localSnippets, 'local')
    const remoteChanges = this.analyzeChanges(baseSnippets, remoteSnippets, 'remote')

    console.log(`🏠 本地变更: ${localChanges.added.length} 新增, ${localChanges.modified.length} 修改, ${localChanges.deleted.length} 删除`)
    console.log(`☁️ 远程变更: ${remoteChanges.added.length} 新增, ${remoteChanges.modified.length} 修改, ${remoteChanges.deleted.length} 删除`)

    // 检测真正的冲突
    const conflicts = this.detectConflicts(localChanges, remoteChanges)
    
    if (conflicts.length > 0) {
      console.log(`⚡ 检测到 ${conflicts.length} 个真正的冲突`)
      return {
        success: false,
        hasConflicts: true,
        conflicts,
        mergedSnippets: [],
        mergedDirectories: [],
        message: `检测到 ${conflicts.length} 个冲突，需要手动解决`
      }
    }

    // 执行合并
    const mergeResult = this.executeMerge(baseSnippets, baseDirectories, localChanges, remoteChanges)
    
    console.log(`✅ 合并完成: ${mergeResult.mergedSnippets.length} 个代码片段, ${mergeResult.mergedDirectories.length} 个目录`)
    
    return {
      success: true,
      hasConflicts: false,
      conflicts: [],
      mergedSnippets: mergeResult.mergedSnippets,
      mergedDirectories: mergeResult.mergedDirectories,
      message: this.buildMergeMessage(localChanges, remoteChanges)
    }
  }

  /**
   * 分析变更（Git 标准：比较两个状态的差异）
   */
  private analyzeChanges(
    baseSnippets: CodeSnippet[],
    targetSnippets: CodeSnippet[],
    side: 'local' | 'remote'
  ): GitChangeSet {
    const added: CodeSnippet[] = []
    const modified: GitModification[] = []
    const deleted: CodeSnippet[] = []
    const unchanged: CodeSnippet[] = []

    // 创建映射便于查找
    const baseMap = new Map(baseSnippets.map(s => [s.fullPath, s]))
    const targetMap = new Map(targetSnippets.map(s => [s.fullPath, s]))

    // 分析目标中的每个代码片段
    for (const targetSnippet of targetSnippets) {
      const baseSnippet = baseMap.get(targetSnippet.fullPath)
      
      if (!baseSnippet) {
        // 新增的代码片段
        added.push(targetSnippet)
      } else if (this.hasContentDifference(baseSnippet, targetSnippet)) {
        // 修改的代码片段
        modified.push({
          fullPath: targetSnippet.fullPath,
          baseVersion: baseSnippet,
          targetVersion: targetSnippet,
          side
        })
      } else {
        // 未变更的代码片段
        unchanged.push(targetSnippet)
      }
    }

    // 查找删除的代码片段
    for (const baseSnippet of baseSnippets) {
      if (!targetMap.has(baseSnippet.fullPath)) {
        deleted.push(baseSnippet)
      }
    }

    // 输出详细的变更信息
    if (added.length > 0) {
      console.log(`🏠 ${side}变更详情:`)
      console.log(`   新增: ${added.map(s => s.fullPath).join(', ') || '无'}`)
    }
    if (modified.length > 0) {
      console.log(`   修改: ${modified.map(m => m.fullPath).join(', ') || '无'}`)
    }
    if (deleted.length > 0) {
      console.log(`   删除: ${deleted.map(s => s.fullPath).join(', ') || '无'}`)
    }

    return { added, modified, deleted, unchanged }
  }

  /**
   * 检测真正的冲突（Git 标准：只有双方都修改了同一文件才算冲突）
   */
  public detectConflicts(localChanges: GitChangeSet, remoteChanges: GitChangeSet): GitConflict[] {
    const conflicts: GitConflict[] = []

    // 创建本地变更的映射
    const localModifiedMap = new Map(localChanges.modified.map(m => [m.fullPath, m]))
    const localAddedSet = new Set(localChanges.added.map(s => s.fullPath))
    const localDeletedSet = new Set(localChanges.deleted.map(s => s.fullPath))

    // 检测修改-修改冲突
    for (const remoteModification of remoteChanges.modified) {
      const localModification = localModifiedMap.get(remoteModification.fullPath)
      
      if (localModification) {
        // 双方都修改了同一文件
        if (!this.isSameChange(localModification.targetVersion, remoteModification.targetVersion)) {
          conflicts.push({
            type: 'modify-modify',
            fullPath: remoteModification.fullPath,
            localVersion: localModification.targetVersion,
            remoteVersion: remoteModification.targetVersion,
            baseVersion: localModification.baseVersion
          })
        }
      }
    }

    // 检测添加-添加冲突
    for (const remoteAdded of remoteChanges.added) {
      if (localAddedSet.has(remoteAdded.fullPath)) {
        const localAdded = localChanges.added.find(s => s.fullPath === remoteAdded.fullPath)!
        
        if (!this.isSameChange(localAdded, remoteAdded)) {
          conflicts.push({
            type: 'add-add',
            fullPath: remoteAdded.fullPath,
            localVersion: localAdded,
            remoteVersion: remoteAdded,
            baseVersion: null
          })
        }
      }
    }

    // 检测修改-删除冲突
    for (const remoteModification of remoteChanges.modified) {
      if (localDeletedSet.has(remoteModification.fullPath)) {
        conflicts.push({
          type: 'modify-delete',
          fullPath: remoteModification.fullPath,
          localVersion: null, // 本地删除
          remoteVersion: remoteModification.targetVersion,
          baseVersion: remoteModification.baseVersion
        })
      }
    }

    // 检测删除-修改冲突
    for (const localModification of localChanges.modified) {
      const remoteDeletedSet = new Set(remoteChanges.deleted.map(s => s.fullPath))
      if (remoteDeletedSet.has(localModification.fullPath)) {
        conflicts.push({
          type: 'delete-modify',
          fullPath: localModification.fullPath,
          localVersion: localModification.targetVersion,
          remoteVersion: null, // 远程删除
          baseVersion: localModification.baseVersion
        })
      }
    }

    return conflicts
  }

  /**
   * 执行合并（应用所有非冲突的变更）
   */
  private executeMerge(
    baseSnippets: CodeSnippet[],
    baseDirectories: Directory[],
    localChanges: GitChangeSet,
    remoteChanges: GitChangeSet
  ): { mergedSnippets: CodeSnippet[]; mergedDirectories: Directory[] } {
    // 从基线开始
    const mergedSnippets = [...baseSnippets]
    const mergedDirectories = [...baseDirectories]

    // 应用本地变更
    this.applyChanges(mergedSnippets, localChanges, 'local')
    
    // 应用远程变更
    this.applyChanges(mergedSnippets, remoteChanges, 'remote')

    return { mergedSnippets, mergedDirectories }
  }

  /**
   * 应用变更到合并结果
   */
  private applyChanges(mergedSnippets: CodeSnippet[], changes: GitChangeSet, side: 'local' | 'remote'): void {
    // 应用新增
    for (const added of changes.added) {
      if (!mergedSnippets.find(s => s.fullPath === added.fullPath)) {
        mergedSnippets.push(added)
        console.log(`   ✅ 应用${side}新增: ${added.fullPath}`)
      }
    }

    // 应用修改
    for (const modification of changes.modified) {
      const index = mergedSnippets.findIndex(s => s.fullPath === modification.fullPath)
      if (index !== -1) {
        mergedSnippets[index] = modification.targetVersion
        console.log(`   ✅ 应用${side}修改: ${modification.fullPath}`)
      }
    }

    // 应用删除
    for (const deleted of changes.deleted) {
      const index = mergedSnippets.findIndex(s => s.fullPath === deleted.fullPath)
      if (index !== -1) {
        mergedSnippets.splice(index, 1)
        console.log(`   ✅ 应用${side}删除: ${deleted.fullPath}`)
      }
    }
  }

  /**
   * 判断两个代码片段内容是否有差异
   */
  private hasContentDifference(snippet1: CodeSnippet, snippet2: CodeSnippet): boolean {
    return snippet1.code !== snippet2.code ||
           snippet1.name !== snippet2.name ||
           snippet1.language !== snippet2.language ||
           snippet1.fileName !== snippet2.fileName
  }

  /**
   * 判断两个变更是否相同
   */
  private isSameChange(snippet1: CodeSnippet, snippet2: CodeSnippet): boolean {
    return !this.hasContentDifference(snippet1, snippet2)
  }

  /**
   * 构建合并消息
   */
  private buildMergeMessage(localChanges: GitChangeSet, remoteChanges: GitChangeSet): string {
    const localTotal = localChanges.added.length + localChanges.modified.length + localChanges.deleted.length
    const remoteTotal = remoteChanges.added.length + remoteChanges.modified.length + remoteChanges.deleted.length
    
    if (localTotal === 0 && remoteTotal === 0) {
      return '无变更，已同步'
    }
    
    let message = '合并完成: '
    
    if (localTotal > 0) {
      message += `本地 ${localTotal} 项变更`
    }
    
    if (remoteTotal > 0) {
      if (localTotal > 0) {
        message += ', '
      }
      message += `远程 ${remoteTotal} 项变更`
    }
    
    return message
  }
}

/**
 * Git 变更集合
 */
export interface GitChangeSet {
  added: CodeSnippet[]
  modified: GitModification[]
  deleted: CodeSnippet[]
  unchanged: CodeSnippet[]
}

/**
 * Git 修改记录
 */
export interface GitModification {
  fullPath: string
  baseVersion: CodeSnippet
  targetVersion: CodeSnippet
  side: 'local' | 'remote'
}

/**
 * Git 冲突记录
 */
export interface GitConflict {
  type: 'modify-modify' | 'add-add' | 'modify-delete' | 'delete-modify'
  fullPath: string
  localVersion: CodeSnippet | null
  remoteVersion: CodeSnippet | null
  baseVersion: CodeSnippet | null
}

/**
 * Git 合并结果
 */
export interface GitMergeResult {
  success: boolean
  hasConflicts: boolean
  conflicts: GitConflict[]
  mergedSnippets: CodeSnippet[]
  mergedDirectories: Directory[]
  message: string
} 