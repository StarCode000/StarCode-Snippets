import { SimpleGit } from 'simple-git'
import { SmartConflictDetector } from './smartConflictDetector'
import { CodeSnippet, Directory } from '../../types/types'

/**
 * Git历史集成示例
 * 展示如何在现有的数据同步管理器中使用智能冲突检测
 */
export class GitHistoryIntegrationExample {
  
  /**
   * 在DataSyncManager中集成智能冲突检测的示例
   * 这样可以避免将单方面修改误判为冲突
   */
  public static async enhancedMergeWithGitHistory(
    localSnippets: CodeSnippet[],
    remoteSnippets: CodeSnippet[],
    git: SimpleGit
  ): Promise<{
    realConflicts: any[]
    autoResolved: any[]
    mergedSnippets: CodeSnippet[]
    summary: string
  }> {
    // 使用智能冲突检测器
    const smartDetector = new SmartConflictDetector(git)
    const detectionResult = await smartDetector.detectSnippetConflicts(localSnippets, remoteSnippets)
    
    console.log(`🔍 智能冲突检测结果:`)
    console.log(`   真正冲突: ${detectionResult.conflicts.length} 个`)
    console.log(`   自动解决: ${detectionResult.autoResolvable.length} 个`)
    
    // 处理自动可解决的差异
    const mergedSnippets = [...localSnippets]
    const autoResolvedDetails: string[] = []
    
    for (const autoResolve of detectionResult.autoResolvable) {
      if (autoResolve.resolution === 'use_remote') {
        // 使用远程版本
        const remoteSnippet = remoteSnippets.find(s => s.fullPath === autoResolve.fullPath)
        if (remoteSnippet) {
          const localIndex = mergedSnippets.findIndex(s => s.fullPath === autoResolve.fullPath)
          if (localIndex >= 0) {
            mergedSnippets[localIndex] = remoteSnippet
          } else {
            mergedSnippets.push(remoteSnippet)
          }
          autoResolvedDetails.push(`✅ ${autoResolve.fullPath}: ${autoResolve.reason}`)
        }
      }
      // 'use_local' 不需要特别处理，因为本地版本已经在mergedSnippets中
      if (autoResolve.resolution === 'use_local') {
        autoResolvedDetails.push(`✅ ${autoResolve.fullPath}: ${autoResolve.reason}`)
      }
    }
    
    // 生成摘要
    let summary = `智能合并完成！\n`
    summary += `📋 处理结果:\n`
    summary += `   • 真正冲突: ${detectionResult.conflicts.length} 个\n`
    summary += `   • 自动解决: ${detectionResult.autoResolvable.length} 个\n`
    
    if (autoResolvedDetails.length > 0) {
      summary += `\n🔧 自动解决的变更:\n`
      autoResolvedDetails.forEach(detail => {
        summary += `   ${detail}\n`
      })
    }
    
    if (detectionResult.conflicts.length > 0) {
      summary += `\n⚠️  需要手动处理的冲突:\n`
      detectionResult.conflicts.forEach(conflict => {
        summary += `   • ${conflict.fullPath}: ${conflict.conflictType}\n`
      })
    }
    
    return {
      realConflicts: detectionResult.conflicts,
      autoResolved: detectionResult.autoResolvable,
      mergedSnippets,
      summary
    }
  }

  /**
   * 演示如何为用户显示详细的冲突信息
   * 包括Git历史信息，帮助用户做决策
   */
  public static async showConflictDetailsWithHistory(
    conflict: any,
    git: SimpleGit
  ): Promise<string> {
    const smartDetector = new SmartConflictDetector(git)
    
    // 获取文件的修改历史
    const history = await smartDetector.getFileModificationHistory(conflict.fullPath)
    
    let details = `📄 冲突详情: ${conflict.fullPath}\n\n`
    
    details += `🕐 修改历史:\n`
    details += `   ${history.modificationSummary}\n`
    if (history.lastCommitMessage) {
      details += `   最后提交: ${history.lastCommitMessage}\n`
    }
    details += `\n`
    
    details += `📝 冲突类型: ${conflict.conflictType}\n\n`
    
    if (conflict.baseVersion) {
      details += `🔄 三路比较:\n`
      details += `   基础版本 (Git历史): ${conflict.baseVersion.name}\n`
      details += `   本地版本: ${conflict.local.name}\n`
      details += `   远程版本: ${conflict.remote.name}\n\n`
    }
    
    details += `💭 建议:\n`
    if (conflict.conflictType === 'both_modified') {
      details += `   双方都进行了修改，建议仔细比较差异后手动合并\n`
    } else if (conflict.conflictType === 'new_vs_new') {
      details += `   双方都创建了新文件，建议检查内容后选择合适的版本\n`
    }
    
    return details
  }

  /**
   * 演示高级用法：查找共同祖先进行更精确的冲突检测
   */
  public static async advancedConflictDetection(
    localSnippets: CodeSnippet[],
    remoteSnippets: CodeSnippet[],
    git: SimpleGit,
    localBranch: string = 'HEAD',
    remoteBranch: string = 'origin/main'
  ): Promise<{
    commonAncestor: string | null
    conflictsFromAncestor: any[]
    recommendation: string
  }> {
    const smartDetector = new SmartConflictDetector(git)
    
    // 查找共同祖先
    const ancestor = await smartDetector.findCommonAncestor(localBranch, remoteBranch)
    
    let recommendation = ''
    
    if (ancestor) {
      console.log(`🌳 找到共同祖先提交: ${ancestor.substring(0, 8)}`)
      
      // 基于共同祖先的更精确检测
      // 这里可以进一步实现基于祖先的三路合并
      recommendation = `基于共同祖先 ${ancestor.substring(0, 8)} 进行三路合并可以更准确地识别真正的冲突`
    } else {
      console.log(`⚠️ 未找到共同祖先，可能是两个独立的分支`)
      recommendation = `由于没有共同历史，建议手动检查所有差异`
    }
    
    // 执行基本的冲突检测
    const result = await smartDetector.detectSnippetConflicts(localSnippets, remoteSnippets)
    
    return {
      commonAncestor: ancestor,
      conflictsFromAncestor: result.conflicts,
      recommendation
    }
  }
} 