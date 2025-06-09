import * as vscode from 'vscode'
import { SimpleGit } from 'simple-git'
import { CodeSnippet, Directory } from '../../types/types'

/**
 * 智能冲突检测器
 * 利用Git历史记录进行三路合并检测，避免将单方面修改误判为冲突
 */
export class SmartConflictDetector {
  private git: SimpleGit
  
  constructor(git: SimpleGit) {
    this.git = git
  }

  /**
   * 智能检测代码片段冲突
   * 使用三路合并策略：比较本地、远程和共同祖先版本
   */
  public async detectSnippetConflicts(
    localSnippets: CodeSnippet[],
    remoteSnippets: CodeSnippet[]
  ): Promise<{
    conflicts: Array<{
      id: string
      fullPath: string
      local: CodeSnippet
      remote: CodeSnippet
      baseVersion?: CodeSnippet
      conflictType: 'both_modified' | 'simple_change' | 'new_vs_new'
      isRealConflict: boolean
    }>
    autoResolvable: Array<{
      id: string
      fullPath: string
      resolution: 'use_local' | 'use_remote'
      reason: string
    }>
  }> {
    const conflicts: any[] = []
    const autoResolvable: any[] = []

    // 找到所有存在差异的代码片段
    const allPaths = new Set([
      ...localSnippets.map(s => s.fullPath),
      ...remoteSnippets.map(s => s.fullPath)
    ])

    for (const fullPath of allPaths) {
      const localSnippet = localSnippets.find(s => s.fullPath === fullPath)
      const remoteSnippet = remoteSnippets.find(s => s.fullPath === fullPath)

      // 如果只有一方存在，不是冲突
      if (!localSnippet || !remoteSnippet) {
        continue
      }

      // 如果内容完全相同，跳过
      if (this.isSnippetIdentical(localSnippet, remoteSnippet)) {
        continue
      }

      try {
        // 获取Git历史中的基础版本
        const baseVersion = await this.getSnippetFromHistory(fullPath)
        
        if (baseVersion) {
          // 三路比较：检查是否真的是冲突
          const localChanged = !this.isSnippetIdentical(localSnippet, baseVersion)
          const remoteChanged = !this.isSnippetIdentical(remoteSnippet, baseVersion)

                     if (localChanged && remoteChanged) {
             // 双方都修改了，这是真正的冲突
             conflicts.push({
               id: fullPath, // 使用fullPath作为唯一标识
               fullPath,
               local: localSnippet,
               remote: remoteSnippet,
               baseVersion,
               conflictType: 'both_modified',
               isRealConflict: true
             })
           } else if (localChanged && !remoteChanged) {
             // 只有本地修改，使用本地版本
             autoResolvable.push({
               id: fullPath, // 使用fullPath作为唯一标识
               fullPath,
               resolution: 'use_local',
               reason: '只有本地修改了此代码片段'
             })
           } else if (!localChanged && remoteChanged) {
             // 只有远程修改，使用远程版本
             autoResolvable.push({
               id: fullPath, // 使用fullPath作为唯一标识
               fullPath,
               resolution: 'use_remote',
               reason: '只有远程修改了此代码片段'
             })
          }
        } else {
          // 无法获取基础版本（可能是新文件），需要比较创建时间
          const conflictInfo = this.analyzeNewFileConflict(localSnippet, remoteSnippet)
          
                     if (conflictInfo.isConflict) {
             conflicts.push({
               id: fullPath, // 使用fullPath作为唯一标识
               fullPath,
               local: localSnippet,
               remote: remoteSnippet,
               baseVersion: undefined,
               conflictType: 'new_vs_new',
               isRealConflict: true
             })
           } else {
             autoResolvable.push({
               id: fullPath, // 使用fullPath作为唯一标识
               fullPath,
               resolution: conflictInfo.preferLocal ? 'use_local' : 'use_remote',
               reason: conflictInfo.reason
             })
           }
        }
      } catch (error) {
        console.warn(`获取 ${fullPath} 的Git历史失败，使用传统冲突检测:`, error)
        
                 // 回退到传统的冲突检测
         conflicts.push({
           id: fullPath, // 使用fullPath作为唯一标识
           fullPath,
           local: localSnippet,
           remote: remoteSnippet,
           baseVersion: undefined,
           conflictType: 'simple_change',
           isRealConflict: true
         })
      }
    }

    return { conflicts, autoResolvable }
  }

  /**
   * 从Git历史中获取代码片段的基础版本
   * 通过查找最近一次成功同步的提交来获取
   */
  private async getSnippetFromHistory(fullPath: string): Promise<CodeSnippet | null> {
    try {
      // 方法1：尝试从HEAD~1获取（上一次提交）
      const headContent = await this.getFileContentFromCommit('HEAD~1', fullPath)
      if (headContent) {
        return JSON.parse(headContent)
      }

      // 方法2：查找包含此文件的最近提交
      const log = await this.git.log({
        file: fullPath,
        maxCount: 5, // 最多查看5次提交
        '--': null,
        [fullPath]: null
      })

      if (log.all.length > 0) {
        // 取最近的一次提交
        const recentCommit = log.all[0]
        const content = await this.getFileContentFromCommit(recentCommit.hash, fullPath)
        if (content) {
          return JSON.parse(content)
        }
      }

      return null
    } catch (error) {
      console.warn(`获取 ${fullPath} 历史版本失败:`, error)
      return null
    }
  }

  /**
   * 从指定提交获取文件内容
   */
  private async getFileContentFromCommit(commit: string, filePath: string): Promise<string | null> {
    try {
      // 使用 git show commit:file 获取文件内容
      const content = await this.git.show([`${commit}:${filePath}`])
      return content
    } catch (error) {
      // 文件在该提交中不存在
      return null
    }
  }

  /**
   * 检查两个代码片段是否完全相同
   */
  private isSnippetIdentical(snippet1: CodeSnippet, snippet2: CodeSnippet): boolean {
    return snippet1.name === snippet2.name &&
           snippet1.code === snippet2.code &&
           snippet1.category === snippet2.category &&
           snippet1.language === snippet2.language &&
           snippet1.fileName === snippet2.fileName
  }

  /**
   * 分析新文件冲突
   * 当两个版本都是新创建的文件时，通过时间戳等信息判断
   */
  private analyzeNewFileConflict(local: CodeSnippet, remote: CodeSnippet): {
    isConflict: boolean
    preferLocal: boolean
    reason: string
  } {
         // 如果代码完全相同，优先使用更新的版本
     if (local.code === remote.code) {
       const localTime = local.createTime
       const remoteTime = remote.createTime
       
       return {
         isConflict: false,
         preferLocal: localTime > remoteTime,
         reason: localTime > remoteTime ? '本地版本更新' : '远程版本更新'
       }
     }

     // 如果内容不同，检查是否只是时间戳差异
     const localCopy = {
       name: local.name,
       code: local.code,
       filePath: local.filePath,
       fileName: local.fileName,
       category: local.category,
       fullPath: local.fullPath,
       order: local.order,
       language: local.language
     }
     const remoteCopy = {
       name: remote.name,
       code: remote.code,
       filePath: remote.filePath,
       fileName: remote.fileName,
       category: remote.category,
       fullPath: remote.fullPath,
       order: remote.order,
       language: remote.language
     }

     if (JSON.stringify(localCopy) === JSON.stringify(remoteCopy)) {
       // 只有时间戳不同，使用更新的版本
       const localTime = local.createTime
       const remoteTime = remote.createTime
      
      return {
        isConflict: false,
        preferLocal: localTime > remoteTime,
        reason: '仅时间戳不同，使用更新版本'
      }
    }

    // 真正的内容冲突
    return {
      isConflict: true,
      preferLocal: false,
      reason: '两个版本内容存在实质差异'
    }
  }

  /**
   * 获取文件的修改历史摘要
   */
  public async getFileModificationHistory(fullPath: string): Promise<{
    totalCommits: number
    lastModified: Date | null
    lastCommitMessage: string | null
    modificationSummary: string
  }> {
    try {
      const log = await this.git.log({
        file: fullPath,
        maxCount: 10,
        '--': null,
        [fullPath]: null
      })

      if (log.all.length === 0) {
        return {
          totalCommits: 0,
          lastModified: null,
          lastCommitMessage: null,
          modificationSummary: '文件未找到修改历史'
        }
      }

      const latest = log.all[0]
      const summary = `文件共有 ${log.all.length} 次修改，最近修改于 ${latest.date}`

      return {
        totalCommits: log.all.length,
        lastModified: new Date(latest.date),
        lastCommitMessage: latest.message,
        modificationSummary: summary
      }
    } catch (error) {
      return {
        totalCommits: 0,
        lastModified: null,
        lastCommitMessage: null,
        modificationSummary: `获取历史失败: ${error}`
      }
    }
  }

  /**
   * 查找两个版本的共同祖先提交
   */
  public async findCommonAncestor(branch1: string = 'HEAD', branch2: string = 'origin/main'): Promise<string | null> {
    try {
      const mergeBase = await this.git.raw(['merge-base', branch1, branch2])
      return mergeBase.trim()
    } catch (error) {
      console.warn('查找共同祖先失败:', error)
      return null
    }
  }
} 