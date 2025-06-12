import { CodeSnippet, Directory } from '../../types/types'

/**
 * 【Git 标准】冲突检测器
 * 
 * 按照 Git 标准检测真正的冲突：
 * - modify-modify: 本地和远程都修改了同一项目
 * - add-add: 本地和远程都添加了同路径的不同内容
 * - modify-delete: 一方修改一方删除
 * - delete-modify: 一方删除一方修改
 * 
 * 参考：https://git-scm.com/docs/git-merge
 */
export class GitStandardConflictDetector {

  /**
   * 【Git 标准】检测代码片段冲突
   * 只检测真正的冲突，不做任何智能猜测
   */
  public detectSnippetConflict(
    baseSnippet: CodeSnippet | null,
    localSnippet: CodeSnippet | null, 
    remoteSnippet: CodeSnippet | null,
    path: string
  ): {
    hasConflict: boolean
    conflictType: 'modify-modify' | 'add-add' | 'modify-delete' | 'delete-modify' | 'none'
    details: string
  } {
    // 1. 三方都存在 - 检查 modify-modify 冲突
    if (baseSnippet && localSnippet && remoteSnippet) {
      const localChanged = !this.isSnippetEqual(baseSnippet, localSnippet)
      const remoteChanged = !this.isSnippetEqual(baseSnippet, remoteSnippet)
      
      if (localChanged && remoteChanged) {
        // 双方都修改了
        if (!this.isSnippetEqual(localSnippet, remoteSnippet)) {
          return {
            hasConflict: true,
            conflictType: 'modify-modify',
            details: `本地和远程都修改了代码片段 "${path}"，且修改内容不同`
          }
        }
        // 修改内容相同，不是冲突
        return { hasConflict: false, conflictType: 'none', details: '' }
      }
      
      // 只有一方修改，或双方都没修改，不是冲突
      return { hasConflict: false, conflictType: 'none', details: '' }
    }
    
    // 2. 检查 add-add 冲突
    if (!baseSnippet && localSnippet && remoteSnippet) {
      if (!this.isSnippetEqual(localSnippet, remoteSnippet)) {
        return {
          hasConflict: true,
          conflictType: 'add-add',
          details: `本地和远程都添加了路径 "${path}" 的代码片段，但内容不同`
        }
      }
      // 添加相同内容，不是冲突
      return { hasConflict: false, conflictType: 'none', details: '' }
    }
    
    // 3. 检查 modify-delete 冲突
    if (baseSnippet && localSnippet && !remoteSnippet) {
      // 📝 Git标准：只要本地有修改就是冲突，不管是否真的修改了内容
      return {
        hasConflict: true,
        conflictType: 'modify-delete',
        details: `本地保留/修改了代码片段 "${path}"，但远程删除了它`
      }
    }
    
    // 4. 检查 delete-modify 冲突  
    if (baseSnippet && !localSnippet && remoteSnippet) {
      // 📝 Git标准：只要远程还存在就是冲突，不管是否真的修改了内容
      return {
        hasConflict: true,
        conflictType: 'delete-modify',
        details: `本地删除了代码片段 "${path}"，但远程保留/修改了它`
      }
    }
    
    // 其他情况都不是冲突
    return { hasConflict: false, conflictType: 'none', details: '' }
  }

  /**
   * 【Git 标准】检测目录冲突
   * 只检测真正的冲突，不做任何智能猜测
   */
  public detectDirectoryConflict(
    baseDirectory: Directory | null,
    localDirectory: Directory | null,
    remoteDirectory: Directory | null, 
    path: string
  ): {
    hasConflict: boolean
    conflictType: 'modify-modify' | 'add-add' | 'modify-delete' | 'delete-modify' | 'none'
    details: string
  } {
    // 1. 三方都存在 - 检查 modify-modify 冲突
    if (baseDirectory && localDirectory && remoteDirectory) {
      const localChanged = !this.isDirectoryEqual(baseDirectory, localDirectory)
      const remoteChanged = !this.isDirectoryEqual(baseDirectory, remoteDirectory)
      
      if (localChanged && remoteChanged) {
        // 双方都修改了
        if (!this.isDirectoryEqual(localDirectory, remoteDirectory)) {
          return {
            hasConflict: true,
            conflictType: 'modify-modify',
            details: `本地和远程都修改了目录 "${path}"，且修改内容不同`
          }
        }
        // 修改内容相同，不是冲突
        return { hasConflict: false, conflictType: 'none', details: '' }
      }
      
      // 只有一方修改，或双方都没修改，不是冲突
      return { hasConflict: false, conflictType: 'none', details: '' }
    }
    
    // 2. 检查 add-add 冲突
    if (!baseDirectory && localDirectory && remoteDirectory) {
      if (!this.isDirectoryEqual(localDirectory, remoteDirectory)) {
        return {
          hasConflict: true,
          conflictType: 'add-add',
          details: `本地和远程都添加了路径 "${path}" 的目录，但属性不同`
        }
      }
      // 添加相同内容，不是冲突
      return { hasConflict: false, conflictType: 'none', details: '' }
    }
    
    // 3. 检查 modify-delete 冲突
    if (baseDirectory && localDirectory && !remoteDirectory) {
      // 📝 Git标准：只要本地还存在就是冲突
      return {
        hasConflict: true,
        conflictType: 'modify-delete',
        details: `本地保留/修改了目录 "${path}"，但远程删除了它`
      }
    }
    
    // 4. 检查 delete-modify 冲突
    if (baseDirectory && !localDirectory && remoteDirectory) {
      // 📝 Git标准：只要远程还存在就是冲突
      return {
        hasConflict: true,
        conflictType: 'delete-modify',
        details: `本地删除了目录 "${path}"，但远程保留/修改了它`
      }
    }
    
    // 其他情况都不是冲突
    return { hasConflict: false, conflictType: 'none', details: '' }
  }

  /**
   * 【Git 标准】检查两个代码片段是否相等
   * 完全按内容比较，不做任何智能判断
   */
  private isSnippetEqual(snippet1: CodeSnippet, snippet2: CodeSnippet): boolean {
    return snippet1.name === snippet2.name &&
           snippet1.code === snippet2.code &&
           snippet1.category === snippet2.category &&
           snippet1.language === snippet2.language &&
           snippet1.fileName === snippet2.fileName &&
           snippet1.filePath === snippet2.filePath &&
           snippet1.fullPath === snippet2.fullPath
  }

  /**
   * 【Git 标准】检查两个目录是否相等
   * 完全按内容比较，不做任何智能判断
   */
  private isDirectoryEqual(dir1: Directory, dir2: Directory): boolean {
    return dir1.name === dir2.name &&
           dir1.fullPath === dir2.fullPath &&
           dir1.order === dir2.order
  }

  /**
   * 【Git 标准】验证冲突标记格式
   * 用于手动冲突解决后的验证
   */
  public validateConflictResolution(content: string): {
    isResolved: boolean
    errors: string[]
  } {
    const errors: string[] = []
    
    // 检查是否还有冲突标记
    const conflictMarkers = [
      /<<<<<<< /g,
      /=======/g,
      />>>>>>> /g
    ]
    
    for (const marker of conflictMarkers) {
      const matches = content.match(marker)
      if (matches && matches.length > 0) {
        errors.push(`发现未解决的冲突标记: ${matches[0]}`)
      }
    }
    
    return {
      isResolved: errors.length === 0,
      errors
    }
  }
} 