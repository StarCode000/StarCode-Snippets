import { diffLines } from 'diff'
import { CodeSnippet, Directory } from '../../types/types'

/**
 * 冲突解决器
 * 负责实现各种冲突解决策略和智能合并算法
 */
export class ConflictResolver {

  /**
   * 解决代码片段冲突
   * 使用基于时间戳的智能合并策略，支持复杂冲突的三路合并
   */
  public resolveSnippetConflict(local: CodeSnippet, remote: CodeSnippet): {
    strategy: 'use_local' | 'use_remote' | 'use_newer' | 'auto_merge' | 'manual_merge_required'
    resolved: CodeSnippet
    needsManualMerge?: boolean
    conflictData?: {
      localContent: string
      remoteContent: string
      mergedContent?: string
    }
  } {
    const localTime = local.createTime || 0
    const remoteTime = remote.createTime || 0
    
    // 策略1: 优先使用有内容的版本（非空代码）
    const localHasCode = (local.code || '').trim().length > 0
    const remoteHasCode = (remote.code || '').trim().length > 0
    
    if (localHasCode && !remoteHasCode) {
      return { strategy: 'use_local', resolved: local }
    }
    
    if (!localHasCode && remoteHasCode) {
      // 使用远程内容（V2版本直接使用）
      return { strategy: 'use_remote', resolved: remote }
    }
    
    // 策略2: 如果都有代码内容，尝试智能合并
    if (localHasCode && remoteHasCode) {
      const localCode = local.code || ''
      const remoteCode = remote.code || ''
      
      // 如果代码完全相同，只是其他属性不同，使用较新的版本
      if (localCode === remoteCode) {
        if (remoteTime > localTime) {
          // 使用远程内容
          return { strategy: 'use_newer', resolved: remote }
        } else {
          return { strategy: 'use_newer', resolved: local }
        }
      }
      
      // 尝试自动合并代码内容
      const mergeResult = this.attemptCodeMerge(localCode, remoteCode, localTime, remoteTime)
      
      if (mergeResult.success && mergeResult.merged) {
        // 自动合并成功，创建合并后的代码片段
        const mergedSnippet: CodeSnippet = {
          ...remote, // 使用远程的其他属性
          code: mergeResult.merged,
          createTime: Math.max(localTime, remoteTime) // 使用较新的时间戳
        }
        
        return {
          strategy: 'auto_merge',
          resolved: mergedSnippet
        }
      } else {
        // 自动合并失败，需要手动合并
        const tempResolved = remoteTime > localTime ? remote : local
        
        return {
          strategy: 'manual_merge_required',
          resolved: tempResolved,
          needsManualMerge: true,
          conflictData: {
            localContent: localCode,
            remoteContent: remoteCode
          }
        }
      }
    }
    
    // 策略3: 如果都没有内容或其他情况，使用时间戳较新的版本
    if (remoteTime > localTime) {
      // 使用远程内容
      return { strategy: 'use_newer', resolved: remote }
    } else if (localTime > remoteTime) {
      return { strategy: 'use_newer', resolved: local }
    }
    
    // 策略4: 时间戳相同时，优先保留本地版本（保守策略）
    return { strategy: 'use_local', resolved: local }
  }

  /**
   * 解决目录冲突
   * 主要基于时间戳，但会保留有用的描述信息
   */
  public resolveDirectoryConflict(local: Directory, remote: Directory): {
    strategy: 'use_local' | 'use_remote' | 'use_newer'
    resolved: Directory
  } {
    // V2类型没有createTime，直接选择远程版本
    // 在V2中，fullPath是唯一标识，冲突通常意味着属性不同
    
    // 策略: 默认使用远程版本，保持与云端一致
    return { strategy: 'use_remote', resolved: remote }
  }

  /**
   * 尝试自动合并代码内容
   * 使用智能合并算法处理代码冲突，重点解决简单的增量修改
   */
  public attemptCodeMerge(localCode: string, remoteCode: string, localTime?: number, remoteTime?: number): {
    success: boolean
    merged?: string
    hasConflicts?: boolean
  } {
    try {
      // 处理空内容情况
      if (!localCode.trim()) {
        return { success: true, merged: remoteCode }
      }
      
      if (!remoteCode.trim()) {
        return { success: true, merged: localCode }
      }
      
      // 如果内容完全相同，直接返回
      if (localCode === remoteCode) {
        return { success: true, merged: localCode }
      }
      
      // 标准化行尾符，确保比较的准确性
      const normalizedLocal = localCode.replace(/\r\n/g, '\n').trim()
      const normalizedRemote = remoteCode.replace(/\r\n/g, '\n').trim()
      
      // 简单情况：如果一方包含另一方的内容，可以安全合并
      if (normalizedLocal === normalizedRemote) {
        return { success: true, merged: normalizedRemote }
      }
      
      // 智能检测包含关系，结合时间戳判断是增量还是删除
      // 如果没有时间戳信息，默认认为远程更新（保守策略）
      const effectiveLocalTime = localTime || 0
      const effectiveRemoteTime = remoteTime || 0
      
      if (normalizedRemote.includes(normalizedLocal)) {
        // 远程包含本地，可能是本地删除了内容，也可能是远程添加了内容
        if (effectiveLocalTime > effectiveRemoteTime) {
          // 本地更新，说明用户删除了内容，使用本地版本
          console.log('检测到本地版本更新且内容较少，判定为用户删除内容，使用本地版本')
          return { success: true, merged: normalizedLocal }
        } else {
          // 远程更新，说明远程添加了内容，使用远程版本
          console.log('检测到远程版本更新且内容较多，判定为远程增量添加，使用远程版本')
          return { success: true, merged: normalizedRemote }
        }
      }
      
      if (normalizedLocal.includes(normalizedRemote)) {
        // 本地包含远程，可能是远程删除了内容，也可能是本地添加了内容
        if (effectiveRemoteTime > effectiveLocalTime) {
          // 远程更新，说明远程删除了内容，使用远程版本
          console.log('检测到远程版本更新且内容较少，判定为远程删除内容，使用远程版本')
          return { success: true, merged: normalizedRemote }
        } else {
          // 本地更新，说明本地添加了内容，使用本地版本
          console.log('检测到本地版本更新且内容较多，判定为本地增量添加，使用本地版本')
          return { success: true, merged: normalizedLocal }
        }
      }
      
      // 使用行级diff进行更精确的分析
      const lineDiff = diffLines(normalizedLocal, normalizedRemote)
      console.log('进行行级diff分析:', lineDiff)
      
      // 分析变更类型
      const addedLines: string[] = []
      const removedLines: string[] = []
      let unchangedLines: string[] = []
      
      for (const change of lineDiff) {
        if (change.added) {
          addedLines.push(...change.value.split('\n').filter(line => line.trim()))
        } else if (change.removed) {
          removedLines.push(...change.value.split('\n').filter(line => line.trim()))
        } else {
          unchangedLines.push(...change.value.split('\n'))
        }
      }
      
      // 如果只有添加操作，没有删除，这是安全的增量修改
      if (removedLines.length === 0 && addedLines.length > 0) {
        console.log(`检测到纯增量添加：添加了 ${addedLines.length} 行`)
        // 智能合并：取较长的版本（包含更多内容的版本）
        const merged = normalizedLocal.length > normalizedRemote.length ? normalizedLocal : normalizedRemote
        return { success: true, merged }
      }
      
      // 如果只有少量简单修改，尝试自动解决
      const totalChanges = addedLines.length + removedLines.length
      if (totalChanges <= 10) {
        // 检查是否为非冲突的修改（例如在不同位置的修改）
        if (this.isNonConflictingChange(lineDiff)) {
          console.log('检测到非冲突修改，执行智能合并')
          const merged = this.performIntelligentMerge(normalizedLocal, normalizedRemote, lineDiff)
          if (merged) {
            return { success: true, merged }
          }
        }
      }
      
      console.log(`检测到复杂冲突：添加 ${addedLines.length} 行，删除 ${removedLines.length} 行，需要手动处理`)
      // 复杂冲突，需要手动处理
      return { success: false, hasConflicts: true }
      
    } catch (error) {
      console.warn('自动合并失败:', error)
      return { success: false }
    }
  }

  /**
   * 检查是否为非冲突的修改（例如在不同位置的添加/删除）
   */
  private isNonConflictingChange(lineDiff: any[]): boolean {
    // 如果diff中没有同时出现添加和删除在相邻位置，则认为是非冲突的
    for (let i = 0; i < lineDiff.length - 1; i++) {
      const current = lineDiff[i]
      const next = lineDiff[i + 1]
      
      // 如果相邻的操作是删除后立即添加，可能是冲突修改
      if (current.removed && next.added) {
        return false
      }
    }
    
    return true
  }

  /**
   * 执行智能合并
   */
  private performIntelligentMerge(localCode: string, remoteCode: string, lineDiff: any[]): string | null {
    try {
      let merged = ''
      
      for (const change of lineDiff) {
        if (!change.added && !change.removed) {
          // 未变更的内容，直接添加
          merged += change.value
        } else if (change.added) {
          // 添加的内容，包含进来
          merged += change.value
        }
        // 删除的内容被忽略
      }
      
      return merged.trim()
    } catch (error) {
      console.warn('智能合并失败:', error)
      return null
    }
  }

  /**
   * 高级代码合并算法
   * 支持更复杂的合并策略
   */
  public attemptAdvancedCodeMerge(localCode: string, remoteCode: string, baseCode?: string): {
    success: boolean
    merged?: string
    hasConflicts?: boolean
  } {
    try {
      // 如果有基础版本，使用三路合并
      if (baseCode) {
        return this.performThreeWayMerge(baseCode, localCode, remoteCode)
      }
      
      // 分析代码结构
      const localLines = localCode.split('\n')
      const remoteLines = remoteCode.split('\n')
      
      // 检查是否有明显的结构相似性
      if (this.hasSimilarStructure(localLines, remoteLines)) {
        return this.performStructuralMerge(localLines, remoteLines)
      }
      
      // 回退到基本合并
      return this.attemptCodeMerge(localCode, remoteCode)
      
    } catch (error) {
      console.warn('高级合并失败:', error)
      return { success: false }
    }
  }

  /**
   * 三路合并算法
   * 基于基础版本进行智能合并
   */
  private performThreeWayMerge(base: string, local: string, remote: string): {
    success: boolean
    merged?: string
    hasConflicts?: boolean
  } {
    try {
      // 计算本地和远程相对于基础版本的差异
      const localDiff = diffLines(base, local)
      const remoteDiff = diffLines(base, remote)
      
      // 检查是否有冲突的修改
      const hasConflicts = this.hasConflictingChanges(localDiff, remoteDiff)
      
      if (!hasConflicts) {
        // 无冲突，可以安全合并
        const merged = this.mergeNonConflictingChanges(base, localDiff, remoteDiff)
        return { success: true, merged }
      }
      
      return { success: false, hasConflicts: true }
      
    } catch (error) {
      console.warn('三路合并失败:', error)
      return { success: false }
    }
  }

  /**
   * 结构化合并
   * 尝试基于代码结构进行合并
   */
  private performStructuralMerge(localLines: string[], remoteLines: string[]): {
    success: boolean
    merged?: string
    hasConflicts?: boolean
  } {
    try {
      const mergedLines: string[] = []
      const maxLength = Math.max(localLines.length, remoteLines.length)
      
      for (let i = 0; i < maxLength; i++) {
        const localLine = localLines[i] || ''
        const remoteLine = remoteLines[i] || ''
        
        if (localLine === remoteLine) {
          // 相同行，直接使用
          mergedLines.push(localLine)
        } else if (localLine && !remoteLine) {
          // 只有本地有内容
          mergedLines.push(localLine)
        } else if (!localLine && remoteLine) {
          // 只有远程有内容
          mergedLines.push(remoteLine)
        } else {
          // 都有内容但不同，选择非空且更长的版本
          const chosenLine = localLine.trim().length > remoteLine.trim().length ? localLine : remoteLine
          mergedLines.push(chosenLine)
        }
      }
      
      return { success: true, merged: mergedLines.join('\n') }
      
    } catch (error) {
      console.warn('结构化合并失败:', error)
      return { success: false }
    }
  }

  /**
   * 检查是否有相似的代码结构
   */
  private hasSimilarStructure(localLines: string[], remoteLines: string[]): boolean {
    if (Math.abs(localLines.length - remoteLines.length) > localLines.length * 0.5) {
      return false // 长度差异太大
    }
    
    // 检查缩进模式的相似性
    const localIndents = localLines.map(line => this.getIndentLevel(line))
    const remoteIndents = remoteLines.map(line => this.getIndentLevel(line))
    
    const similarityThreshold = 0.7
    const similarity = this.calculateArraySimilarity(localIndents, remoteIndents)
    
    return similarity > similarityThreshold
  }

  /**
   * 获取行的缩进级别
   */
  private getIndentLevel(line: string): number {
    const match = line.match(/^(\s*)/)
    return match ? match[1].length : 0
  }

  /**
   * 计算两个数组的相似性
   */
  private calculateArraySimilarity(arr1: number[], arr2: number[]): number {
    const maxLength = Math.max(arr1.length, arr2.length)
    if (maxLength === 0) {
      return 1
    }
    
    let matches = 0
    for (let i = 0; i < maxLength; i++) {
      if ((arr1[i] || 0) === (arr2[i] || 0)) {
        matches++
      }
    }
    
    return matches / maxLength
  }

  /**
   * 检查是否有冲突的修改
   */
  private hasConflictingChanges(localDiff: any[], remoteDiff: any[]): boolean {
    // 简化的冲突检测逻辑
    // 如果同一位置同时有添加和删除操作，认为有冲突
    
    const localChanges = new Set<number>()
    const remoteChanges = new Set<number>()
    
    let localLineIndex = 0
    for (const change of localDiff) {
      if (change.added || change.removed) {
        localChanges.add(localLineIndex)
      }
      if (!change.removed) {
        localLineIndex += change.count || 1
      }
    }
    
    let remoteLineIndex = 0
    for (const change of remoteDiff) {
      if (change.added || change.removed) {
        remoteChanges.add(remoteLineIndex)
      }
      if (!change.removed) {
        remoteLineIndex += change.count || 1
      }
    }
    
    // 检查是否有重叠的修改位置
    for (const pos of localChanges) {
      if (remoteChanges.has(pos)) {
        return true
      }
    }
    
    return false
  }

  /**
   * 合并非冲突的修改
   */
  private mergeNonConflictingChanges(base: string, localDiff: any[], remoteDiff: any[]): string {
    // 这里需要实现复杂的合并逻辑
    // 目前简化处理，返回远程版本
    const remoteResult = this.applyDiff(base, remoteDiff)
    return remoteResult
  }

  /**
   * 应用差异到基础文本
   */
  private applyDiff(base: string, diff: any[]): string {
    const lines = base.split('\n')
    const result: string[] = []
    
    let baseIndex = 0
    for (const change of diff) {
      if (change.removed) {
        // 跳过被删除的行
        baseIndex += change.count || 1
      } else if (change.added) {
        // 添加新行
        const addedLines = change.value.split('\n').filter((line: string) => line !== '')
        result.push(...addedLines)
      } else {
        // 保持不变的行
        const unchangedCount = change.count || 1
        for (let i = 0; i < unchangedCount && baseIndex < lines.length; i++) {
          result.push(lines[baseIndex++])
        }
      }
    }
    
    return result.join('\n')
  }

  /**
   * 评估合并的安全性
   */
  public evaluateMergeSafety(local: CodeSnippet, remote: CodeSnippet): {
    safe: boolean
    risk: 'low' | 'medium' | 'high'
    reasons: string[]
  } {
    const reasons: string[] = []
    let risk: 'low' | 'medium' | 'high' = 'low'
    
    // 检查代码长度差异
    const localCode = local.code || ''
    const remoteCode = remote.code || ''
    const lengthDiff = Math.abs(localCode.length - remoteCode.length)
    const maxLength = Math.max(localCode.length, remoteCode.length)
    
    if (maxLength > 0 && lengthDiff / maxLength > 0.5) {
      risk = 'high'
      reasons.push('代码长度差异超过50%')
    }
    
    // 检查语言一致性
    if (local.language !== remote.language) {
      risk = 'medium'
      reasons.push('编程语言不一致')
    }
    
    // 检查特殊语法
    const hasSpecialSyntax = (code: string) => {
      return /import\s+|require\s*\(|function\s+|class\s+|def\s+|async\s+/.test(code)
    }
    
    if (hasSpecialSyntax(localCode) || hasSpecialSyntax(remoteCode)) {
      if (risk === 'low') {
        risk = 'medium'
      }
      reasons.push('包含函数、类或导入语句等复杂语法')
    }
    
    const safe = risk === 'low'
    
    if (reasons.length === 0) {
      reasons.push('代码结构相似，合并风险较低')
    }
    
    return { safe, risk, reasons }
  }
} 