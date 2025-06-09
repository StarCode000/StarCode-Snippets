import * as vscode from 'vscode'
import { SimpleGit } from 'simple-git'
import { CodeSnippet, Directory } from '../../types/types'
import { FileSystemManager } from './fileSystemManager'

/**
 * 三路合并管理器
 * 实现正确的Git三路合并逻辑：base vs local vs remote
 */
export class ThreeWayMergeManager {
  private git: SimpleGit
  private fileSystemManager: FileSystemManager

  constructor(git: SimpleGit, fileSystemManager: FileSystemManager) {
    this.git = git
    this.fileSystemManager = fileSystemManager
  }

  /**
   * 执行正确的三路合并
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
   */
  private async getGitBaselineData(): Promise<{ snippets: CodeSnippet[]; directories: Directory[] }> {
    try {
      // 方法1: 尝试从HEAD获取（当前提交的状态）
      const headData = await this.readDataFromCommit('HEAD')
      if (headData) {
        console.log('✅ 成功获取HEAD基线数据')
        return headData
      }

      // 方法2: 如果HEAD没有数据，尝试从工作目录的Git仓库读取
      console.log('⚠️ HEAD无数据，尝试从工作目录读取...')
      return await this.fileSystemManager.readDataFromGitRepo()

    } catch (error) {
      console.warn('获取Git基线数据失败，使用空基线:', error)
      // 如果都失败了，使用空的基线（意味着所有数据都是新增的）
      return { snippets: [], directories: [] }
    }
  }

  /**
   * 从指定提交读取数据
   */
  private async readDataFromCommit(commit: string): Promise<{ snippets: CodeSnippet[]; directories: Directory[] } | null> {
    try {
      // 尝试获取snippets.json
      const snippetsContent = await this.git.show([`${commit}:snippets.json`])
      const directoriesContent = await this.git.show([`${commit}:directories.json`]).catch(() => '[]')

      const snippets: CodeSnippet[] = JSON.parse(snippetsContent)
      const directories: Directory[] = JSON.parse(directoriesContent)

      return { snippets, directories }
    } catch (error) {
      // 文件在该提交中不存在
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

    for (const modified of localChanges.modified) {
      if (!conflicts.find(c => c.fullPath === modified.fullPath)) {
        const existingIndex = mergedSnippets.findIndex(s => s.fullPath === modified.fullPath)
        if (existingIndex >= 0) {
          mergedSnippets[existingIndex] = modified.target
          autoResolved.push({ fullPath: modified.fullPath, resolution: 'local_modify' })
        }
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
} 