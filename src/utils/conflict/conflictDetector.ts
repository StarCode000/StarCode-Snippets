import * as crypto from 'crypto'
import { CodeSnippet, Directory } from '../../types/types'
import { ContentExtractionResult } from '../../types/syncTypes'

/**
 * 冲突检测器
 * 负责检测代码片段和目录之间的内容差异，以及从冲突文件中提取解决后的内容
 */
export class ConflictDetector {

  /**
   * 检查两个代码片段是否有内容差异
   */
  public hasSnippetContentDifference(local: CodeSnippet, remote: CodeSnippet): boolean {
    // 基于V2类型的直接字段比较
    return local.name !== remote.name ||
           local.code !== remote.code ||
           local.category !== remote.category ||
           local.language !== remote.language ||
           local.fileName !== remote.fileName ||
           local.filePath !== remote.filePath ||
           local.fullPath !== remote.fullPath
  }

  /**
   * 检查两个目录是否有内容差异
   */
  public hasDirectoryContentDifference(local: Directory, remote: Directory): boolean {
    // 基于V2类型的直接字段比较
    return local.name !== remote.name ||
           local.fullPath !== remote.fullPath ||
           local.order !== remote.order
  }

  /**
   * 从用户编辑后的冲突文件中提取解决后的代码内容
   * 支持多重冲突的复杂解析和验证
   */
  public extractResolvedContent(fileContent: string): ContentExtractionResult {
    const errors: string[] = []
    
    // 检查是否还有未解决的冲突标记
    const conflictMarkers = {
      start: /<<<<<<< /g,
      separator: /=======/g,
      end: />>>>>>> /g
    }
    
    const startMatches = Array.from(fileContent.matchAll(conflictMarkers.start))
    const separatorMatches = Array.from(fileContent.matchAll(conflictMarkers.separator))
    const endMatches = Array.from(fileContent.matchAll(conflictMarkers.end))
    
    // 验证冲突标记的完整性
    if (startMatches.length !== endMatches.length) {
      errors.push(`冲突标记不匹配：找到 ${startMatches.length} 个起始标记，但只有 ${endMatches.length} 个结束标记`)
    }
    
    if (separatorMatches.length !== startMatches.length) {
      errors.push(`分隔符数量不匹配：应该有 ${startMatches.length} 个分隔符，但只找到 ${separatorMatches.length} 个`)
    }
    
    // 如果还有冲突标记，说明用户没有完全解决冲突
    if (startMatches.length > 0) {
      errors.push(`发现 ${startMatches.length} 个未解决的冲突区域，请删除所有冲突标记并保留您想要的内容`)
      
      // 提供具体的冲突位置信息
      startMatches.forEach((match, index) => {
        const lineNumber = fileContent.substring(0, match.index).split('\n').length
        errors.push(`  - 冲突区域 ${index + 1} 在第 ${lineNumber} 行`)
      })
      
      return {
        success: false,
        content: '',
        errors
      }
    }
    
    // 检查是否有孤立的冲突标记
    const isolatedMarkers = [
      ...Array.from(fileContent.matchAll(/^=======\s*$/gm)),
      ...Array.from(fileContent.matchAll(/^<<<<<<< /gm)),
      ...Array.from(fileContent.matchAll(/^>>>>>>> /gm))
    ]
    
    if (isolatedMarkers.length > 0) {
      errors.push(`发现 ${isolatedMarkers.length} 个孤立的冲突标记，请检查并删除所有冲突相关的标记`)
      return {
        success: false,
        content: '',
        errors
      }
    }
    
    // 检查内容是否为空
    const content = fileContent.trim()
    if (content.length === 0) {
      errors.push('解决后的内容为空，这可能不是您期望的结果')
      return {
        success: false,
        content: '',
        errors
      }
    }
    
    return {
      success: true,
      content,
      errors: []
    }
  }

  /**
   * 检查文件是否包含冲突标记
   */
  public hasConflictMarkers(fileContent: string): boolean {
    const hasStart = fileContent.includes('<<<<<<< ')
    const hasSeparator = fileContent.includes('=======')
    const hasEnd = fileContent.includes('>>>>>>> ')
    
    return hasStart || hasSeparator || hasEnd
  }

  /**
   * 分析冲突的复杂度
   */
  public analyzeConflictComplexity(localContent: string, remoteContent: string): {
    complexity: 'simple' | 'moderate' | 'complex'
    conflictType: 'content_only' | 'structure_only' | 'both'
    details: string
  } {
    // 检查内容长度差异
    const lengthDiff = Math.abs(localContent.length - remoteContent.length)
    const maxLength = Math.max(localContent.length, remoteContent.length)
    const lengthRatio = maxLength > 0 ? lengthDiff / maxLength : 0

    // 检查行数差异
    const localLines = localContent.split('\n').length
    const remoteLines = remoteContent.split('\n').length
    const lineDiff = Math.abs(localLines - remoteLines)

    // 检查相似性
    const similarity = this.calculateSimilarity(localContent, remoteContent)

    let complexity: 'simple' | 'moderate' | 'complex'
    let conflictType: 'content_only' | 'structure_only' | 'both'
    let details: string

    // 判断复杂度
    if (similarity > 0.8 && lengthRatio < 0.2 && lineDiff < 5) {
      complexity = 'simple'
      details = '内容差异较小，可以尝试自动合并'
    } else if (similarity > 0.5 && lengthRatio < 0.5 && lineDiff < 20) {
      complexity = 'moderate'
      details = '内容有中等差异，建议手动检查合并结果'
    } else {
      complexity = 'complex'
      details = '内容差异较大，需要仔细手动合并'
    }

    // 判断冲突类型
    if (lineDiff < 3 && lengthRatio < 0.1) {
      conflictType = 'content_only'
    } else if (similarity > 0.9 && lineDiff > 10) {
      conflictType = 'structure_only'
    } else {
      conflictType = 'both'
    }

    return { complexity, conflictType, details }
  }

  /**
   * 计算两个字符串的相似性（0-1之间）
   */
  private calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) {return 1}
    if (str1.length === 0 || str2.length === 0) {return 0}

    // 使用简单的字符级相似性算法
    const longer = str1.length > str2.length ? str1 : str2
    const shorter = str1.length > str2.length ? str2 : str1

    if (longer.length === 0) {return 1}

    const editDistance = this.calculateEditDistance(longer, shorter)
    return (longer.length - editDistance) / longer.length
  }

  /**
   * 计算编辑距离（Levenshtein distance）
   */
  private calculateEditDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null))

    for (let i = 0; i <= str1.length; i++) {
      matrix[0][i] = i
    }

    for (let j = 0; j <= str2.length; j++) {
      matrix[j][0] = j
    }

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,     // deletion
          matrix[j - 1][i] + 1,     // insertion
          matrix[j - 1][i - 1] + indicator  // substitution
        )
      }
    }

    return matrix[str2.length][str1.length]
  }

  /**
   * 创建智能冲突文件内容
   * 只在真正有差异的地方添加冲突标记，保持代码的可读性
   */
  public createConflictFileContent(localContent: string, remoteContent: string, filePath: string): string {
    // 为了支持多重冲突检测，我们需要添加唯一标识符
    const conflictId = crypto.randomBytes(4).toString('hex')
    
    return this.createSmartConflictContent(localContent, remoteContent, conflictId)
  }

  /**
   * 创建智能冲突内容
   * 进行行级别的差异检测，只在有差异的地方添加冲突标记
   */
  private createSmartConflictContent(localContent: string, remoteContent: string, conflictId: string): string {
    const localLines = localContent.split('\n')
    const remoteLines = remoteContent.split('\n')
    
    // 使用简单的行级差异算法
    const diffResult = this.computeLineDiff(localLines, remoteLines)
    
    if (diffResult.hasConflicts) {
      return this.generateConflictFileFromDiff(diffResult, conflictId)
    } else {
      // 如果没有行级冲突，可能是整体内容不同，回退到原有方式
    return `<<<<<<< LOCAL (当前设备的版本) [${conflictId}]
${localContent}
=======
${remoteContent}
>>>>>>> REMOTE (远程设备的版本) [${conflictId}]`
    }
  }

  /**
   * 计算两组行之间的差异
   */
  private computeLineDiff(localLines: string[], remoteLines: string[]): {
    hasConflicts: boolean
    commonPrefix: string[]
    commonSuffix: string[]
    localDiffLines: string[]
    remoteDiffLines: string[]
    conflictStartIndex: number
    conflictEndIndex: number
  } {
    // 找出公共前缀
    let commonPrefixLength = 0
    const minLength = Math.min(localLines.length, remoteLines.length)
    
    for (let i = 0; i < minLength; i++) {
      if (localLines[i] === remoteLines[i]) {
        commonPrefixLength++
      } else {
        break
      }
    }
    
    // 找出公共后缀
    let commonSuffixLength = 0
    const localRemainingLength = localLines.length - commonPrefixLength
    const remoteRemainingLength = remoteLines.length - commonPrefixLength
    const maxSuffixLength = Math.min(localRemainingLength, remoteRemainingLength)
    
    for (let i = 0; i < maxSuffixLength; i++) {
      const localIndex = localLines.length - 1 - i
      const remoteIndex = remoteLines.length - 1 - i
      
      if (localLines[localIndex] === remoteLines[remoteIndex]) {
        commonSuffixLength++
      } else {
        break
      }
    }
    
    // 提取差异部分
    const localDiffStart = commonPrefixLength
    const localDiffEnd = localLines.length - commonSuffixLength
    const remoteDiffStart = commonPrefixLength
    const remoteDiffEnd = remoteLines.length - commonSuffixLength
    
    const commonPrefix = localLines.slice(0, commonPrefixLength)
    const commonSuffix = localLines.slice(localLines.length - commonSuffixLength)
    const localDiffLines = localLines.slice(localDiffStart, localDiffEnd)
    const remoteDiffLines = remoteLines.slice(remoteDiffStart, remoteDiffEnd)
    
    // 检查是否确实存在冲突
    const hasConflicts = localDiffLines.length > 0 || remoteDiffLines.length > 0
    
    return {
      hasConflicts,
      commonPrefix,
      commonSuffix,
      localDiffLines,
      remoteDiffLines,
      conflictStartIndex: commonPrefixLength,
      conflictEndIndex: localLines.length - commonSuffixLength
    }
  }

  /**
   * 根据差异信息生成冲突文件内容
   */
  private generateConflictFileFromDiff(diffResult: any, conflictId: string): string {
    const result: string[] = []
    
    // 添加公共前缀
    result.push(...diffResult.commonPrefix)
    
    // 添加冲突标记和差异内容
    result.push(`<<<<<<< LOCAL (当前设备的版本) [${conflictId}]`)
    result.push(...diffResult.localDiffLines)
    result.push('=======')
    result.push(...diffResult.remoteDiffLines)
    result.push(`>>>>>>> REMOTE (远程设备的版本) [${conflictId}]`)
    
    // 添加公共后缀
    result.push(...diffResult.commonSuffix)
    
    return result.join('\n')
  }

  /**
   * 验证冲突标记的完整性
   */
  public validateConflictMarkers(fileContent: string): {
    isValid: boolean
    errors: string[]
    conflictCount: number
  } {
    const errors: string[] = []
    
    const startMatches = Array.from(fileContent.matchAll(/<<<<<<< /g))
    const separatorMatches = Array.from(fileContent.matchAll(/=======/g))
    const endMatches = Array.from(fileContent.matchAll(/>>>>>>> /g))
    
    const conflictCount = startMatches.length
    
    if (startMatches.length !== endMatches.length) {
      errors.push(`起始标记 (${startMatches.length}) 与结束标记 (${endMatches.length}) 数量不匹配`)
    }
    
    if (separatorMatches.length !== startMatches.length) {
      errors.push(`分隔符 (${separatorMatches.length}) 与冲突区域 (${startMatches.length}) 数量不匹配`)
    }
    
    // 检查标记的顺序是否正确
    for (let i = 0; i < Math.min(startMatches.length, separatorMatches.length, endMatches.length); i++) {
      const startPos = startMatches[i].index!
      const sepPos = separatorMatches[i].index!
      const endPos = endMatches[i].index!
      
      if (!(startPos < sepPos && sepPos < endPos)) {
        errors.push(`第 ${i + 1} 个冲突区域的标记顺序不正确`)
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      conflictCount
    }
  }

  /**
   * 计算内容的哈希值，用于快速比较
   */
  public calculateHash(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
  }

  /**
   * 测试智能冲突文件生成功能
   * 用于开发和调试阶段验证功能是否正常工作
   */
  public testSmartConflictGeneration(): void {
    console.log('=== 测试智能冲突文件生成 ===')
    
    // 测试用例1：只有最后一行不同（用户的场景）
    const local1 = `test1
test1
test1
test2
cursor`
    
    const remote1 = `test1
test1
test1
test2
vscode`
    
    const result1 = this.createConflictFileContent(local1, remote1, 'test.txt')
    console.log('测试用例1 - 只有最后一行不同:')
    console.log(result1)
    console.log('---')
    
    // 测试用例2：中间有不同
    const local2 = `function test() {
  console.log('hello')
  return 42
}`
    
    const remote2 = `function test() {
  console.log('world')
  return 42
}`
    
    const result2 = this.createConflictFileContent(local2, remote2, 'test2.txt')
    console.log('测试用例2 - 中间行不同:')
    console.log(result2)
    console.log('---')
    
    // 测试用例3：多行差异
    const local3 = `header
line1
local_change1
local_change2
footer`
    
    const remote3 = `header
line1
remote_change1
remote_change2
remote_change3
footer`
    
    const result3 = this.createConflictFileContent(local3, remote3, 'test3.txt')
    console.log('测试用例3 - 多行差异:')
    console.log(result3)
    console.log('=== 测试完成 ===')
  }
} 