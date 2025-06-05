/**
 * 名称验证工具
 * 用于验证代码片段和目录名称的合法性
 */

/**
 * 文件系统不支持的字符列表
 * 这些字符在Windows、macOS和Linux中都可能引起问题
 */
const INVALID_CHARS = [
  '<', '>', ':', '"', '|', '?', '*', // Windows禁用
  '/', '\\', // 路径分隔符
  '\0', // 空字符
  '\n', '\r', '\t', // 换行和制表符
]

/**
 * 保留的文件名（主要针对Windows）
 */
const RESERVED_NAMES = [
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]

/**
 * 验证名称是否包含文件系统不支持的字符
 * @param name 要验证的名称
 * @returns 验证结果对象
 */
export function validateFileSystemSafety(name: string): { isValid: boolean; error?: string } {
  if (!name || name.trim().length === 0) {
    return { isValid: false, error: '名称不能为空' }
  }

  const trimmedName = name.trim()

  // 检查是否包含非法字符
  for (const char of INVALID_CHARS) {
    if (trimmedName.includes(char)) {
      return { 
        isValid: false, 
        error: `名称不能包含字符: ${char === '\n' ? '\\n' : char === '\r' ? '\\r' : char === '\t' ? '\\t' : char === '\0' ? '\\0' : char}` 
      }
    }
  }

  // 检查是否以点号开始或结束（在某些系统中可能有问题）
  if (trimmedName.startsWith('.') || trimmedName.endsWith('.')) {
    return { isValid: false, error: '名称不能以点号开始或结束' }
  }

  // 检查是否以空格开始或结束
  if (trimmedName !== name) {
    return { isValid: false, error: '名称不能以空格开始或结束' }
  }

  // 检查是否是保留名称（不区分大小写）
  if (RESERVED_NAMES.includes(trimmedName.toUpperCase())) {
    return { isValid: false, error: `"${trimmedName}" 是系统保留名称，不能使用` }
  }

  // 检查长度（大多数文件系统支持255字符）
  if (trimmedName.length > 255) {
    return { isValid: false, error: '名称长度不能超过255个字符' }
  }

  return { isValid: true }
}

/**
 * 验证代码片段名称是否与目录名称冲突
 * @param snippetName 代码片段名称
 * @param directories 当前所有目录
 * @param parentPath 父目录路径（V2格式）或parentId（V1格式）
 * @param storageVersion 存储版本
 * @returns 是否冲突
 */
export function checkSnippetDirectoryConflict(
  snippetName: string,
  directories: any[],
  parentPath: string | null,
  storageVersion: string
): boolean {
  if (storageVersion === 'v2') {
    // V2格式：基于路径检查
    const targetPath = parentPath === '/' || parentPath === null
      ? `/${snippetName}/`
      : `${parentPath}${snippetName}/`
    
    return directories.some(dir => dir.fullPath === targetPath)
  } else {
    // V1格式：基于parentId检查
    return directories.some(dir => 
      dir.name === snippetName && dir.parentId === parentPath
    )
  }
}

/**
 * 验证目录名称是否与代码片段名称冲突
 * @param directoryName 目录名称
 * @param snippets 当前所有代码片段
 * @param parentPath 父目录路径（V2格式）或parentId（V1格式）
 * @param storageVersion 存储版本
 * @returns 是否冲突
 */
export function checkDirectorySnippetConflict(
  directoryName: string,
  snippets: any[],
  parentPath: string | null,
  storageVersion: string
): boolean {
  if (storageVersion === 'v2') {
    // V2格式：基于路径检查
    const targetPath = parentPath === '/' || parentPath === null
      ? `/${directoryName}`
      : `${parentPath}${directoryName}`
    
    return snippets.some(snippet => snippet.fullPath === targetPath)
  } else {
    // V1格式：基于parentId检查
    return snippets.some(snippet => 
      snippet.name === directoryName && snippet.parentId === parentPath
    )
  }
}

/**
 * 获取清理后的名称（移除不安全字符）
 * @param name 原始名称
 * @returns 清理后的名称
 */
export function sanitizeName(name: string): string {
  let sanitized = name.trim()
  
  // 替换非法字符为下划线
  for (const char of INVALID_CHARS) {
    sanitized = sanitized.replaceAll(char, '_')
  }
  
  // 移除开始和结束的点号
  sanitized = sanitized.replace(/^\.+|\.+$/g, '')
  
  // 如果是保留名称，添加后缀
  if (RESERVED_NAMES.includes(sanitized.toUpperCase())) {
    sanitized += '_renamed'
  }
  
  // 限制长度
  if (sanitized.length > 255) {
    sanitized = sanitized.substring(0, 255)
  }
  
  // 如果清理后为空，提供默认名称
  if (sanitized.length === 0) {
    sanitized = 'unnamed'
  }
  
  return sanitized
} 