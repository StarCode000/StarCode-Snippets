import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { CodeSnippet, Directory } from '../../types/types'
import { SettingsManager } from '../settingsManager'

/**
 * 文件系统操作管理器
 * 负责Git仓库的文件读写、数据序列化和临时文件管理
 */
export class FileSystemManager {

  /**
   * 将代码片段和目录数据写入Git仓库文件系统
   */
  public async writeDataToGitRepo(
    snippets: CodeSnippet[], 
    directories: Directory[], 
    updateTimestamp: boolean = true
  ): Promise<void> {
    const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
    
    // 确保仓库目录存在
    if (!fs.existsSync(effectiveLocalPath)) {
      fs.mkdirSync(effectiveLocalPath, { recursive: true })
    }

    // 【重要修复】在写入新数据前，确保Git仓库完全清理
    await this.cleanBeforeSync(effectiveLocalPath)

    // 准备新的文件内容
    const newSnippetsContent = JSON.stringify(snippets, null, 2)
    const newDirectoriesContent = JSON.stringify(directories, null, 2)

    const snippetsFile = path.join(effectiveLocalPath, 'snippets.json')
    const directoriesFile = path.join(effectiveLocalPath, 'directories.json')
    const metadataFile = path.join(effectiveLocalPath, '.starcode-meta.json')

    // 检查代码片段文件是否需要更新
    let needUpdateSnippets = true
    if (fs.existsSync(snippetsFile)) {
      try {
        const existingSnippetsContent = fs.readFileSync(snippetsFile, 'utf8')
        needUpdateSnippets = existingSnippetsContent !== newSnippetsContent
      } catch (error) {
        needUpdateSnippets = true
      }
    }

    // 检查目录文件是否需要更新
    let needUpdateDirectories = true
    if (fs.existsSync(directoriesFile)) {
      try {
        const existingDirectoriesContent = fs.readFileSync(directoriesFile, 'utf8')
        needUpdateDirectories = existingDirectoriesContent !== newDirectoriesContent
      } catch (error) {
        needUpdateDirectories = true
      }
    }

    // 准备元数据
    let metadata: any = {
      version: '2.0.0',
      totalSnippets: snippets.length,
      totalDirectories: directories.length,
      syncMethod: 'git'
    }

    // 处理时间戳
    if (updateTimestamp) {
      metadata.lastSync = new Date().toISOString()
    } else {
      // 尝试读取现有的时间戳
      try {
        if (fs.existsSync(metadataFile)) {
          const existingMetadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'))
          metadata.lastSync = existingMetadata.lastSync || new Date().toISOString()
        } else {
          metadata.lastSync = new Date().toISOString()
        }
      } catch (error) {
        metadata.lastSync = new Date().toISOString()
      }
    }

    // 检查元数据文件是否需要更新
    const newMetadataContent = JSON.stringify(metadata, null, 2)
    let needUpdateMetadata = true
    if (fs.existsSync(metadataFile)) {
      try {
        const existingMetadataContent = fs.readFileSync(metadataFile, 'utf8')
        needUpdateMetadata = existingMetadataContent !== newMetadataContent
      } catch (error) {
        needUpdateMetadata = true
      }
    }

    // 只有在内容真正发生变化时才写入文件
    if (needUpdateSnippets) {
      fs.writeFileSync(snippetsFile, newSnippetsContent, 'utf8')
    }

    if (needUpdateDirectories) {
      fs.writeFileSync(directoriesFile, newDirectoriesContent, 'utf8')
    }

    if (needUpdateMetadata) {
      fs.writeFileSync(metadataFile, newMetadataContent, 'utf8')
    }
  }

  /**
   * 【新增】同步前清理逻辑：清理Git仓库中不应该存在的文件
   * 确保Git仓库状态与VSCode存储完全一致
   */
  private async cleanBeforeSync(gitRepoPath: string): Promise<void> {
    try {
      // 不删除Git管理文件和元数据文件
      const protectedFiles = ['.git', '.starcode-meta.json', '.gitignore', 'README.md']
      
      // 清理可能的旧数据文件和临时文件
      const itemsToClean = [
        // 旧版本可能产生的文件
        'data.json',
        'backup.json',
        // 临时文件
        '.merge-conflicts',
        // 其他可能的临时文件
        'conflict-resolution.json'
      ]
      
      for (const item of itemsToClean) {
        const itemPath = path.join(gitRepoPath, item)
        try {
          if (fs.existsSync(itemPath)) {
            const stat = fs.statSync(itemPath)
            if (stat.isDirectory()) {
              await this.deleteDirectory(itemPath)
            } else {
              fs.unlinkSync(itemPath)
            }
            console.log(`已清理: ${item}`)
          }
        } catch (error) {
          console.warn(`清理 ${item} 失败:`, error)
        }
      }
      
    } catch (error) {
      console.warn('同步前清理失败:', error)
    }
  }

  /**
   * 从Git仓库文件系统读取代码片段和目录数据
   */
  public async readDataFromGitRepo(): Promise<{ snippets: CodeSnippet[]; directories: Directory[] }> {
    const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
    
    const snippetsFile = path.join(effectiveLocalPath, 'snippets.json')
    const directoriesFile = path.join(effectiveLocalPath, 'directories.json')

    let snippets: CodeSnippet[] = []
    let directories: Directory[] = []

    try {
      if (fs.existsSync(snippetsFile)) {
        const snippetsData = fs.readFileSync(snippetsFile, 'utf8')
        snippets = JSON.parse(snippetsData)
      }
    } catch (error) {
      console.warn('读取代码片段文件失败:', error)
    }

    try {
      if (fs.existsSync(directoriesFile)) {
        const directoriesData = fs.readFileSync(directoriesFile, 'utf8')
        directories = JSON.parse(directoriesData)
      }
    } catch (error) {
      console.warn('读取目录文件失败:', error)
    }

    return { snippets, directories }
  }

  /**
   * 清理临时冲突文件
   */
  public async cleanupTempConflictFiles(tempDir: string): Promise<void> {
    try {
      if (fs.existsSync(tempDir)) {
        await this.deleteDirectory(tempDir)
      }
    } catch (error) {
      console.warn('清理临时冲突文件失败:', error)
    }
  }

  /**
   * 清理所有旧的临时冲突文件（在同步开始前调用）
   * 与原始代码完全一致：直接删除整个临时目录
   */
  public async cleanupOldConflictFiles(): Promise<void> {
    try {
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      const tempDir = path.join(effectiveLocalPath, '.merge-conflicts')
      
      if (fs.existsSync(tempDir)) {
        // 删除整个临时目录，确保没有残留的冲突文件
        await this.deleteDirectory(tempDir)
      }
    } catch (error) {
      console.warn('清理旧临时冲突文件失败:', error)
    }
  }

  /**
   * 创建冲突文件内容
   * 与原始代码完全一致：包含唯一标识符和详细说明
   */
  public createConflictFileContent(localContent: string, remoteContent: string, filePath: string): string {
    // 为了支持多重冲突检测，我们需要添加唯一标识符
    const conflictId = crypto.randomBytes(4).toString('hex')
    
    return `<<<<<<< LOCAL (当前设备的版本) [${conflictId}]
${localContent}
=======
${remoteContent}
>>>>>>> REMOTE (远程设备的版本) [${conflictId}]`
  }

  /**
   * 检查元数据文件是否需要更新（忽略时间戳）
   */
  public isMetadataUpdateNeeded(
    currentSnippets: CodeSnippet[], 
    currentDirectories: Directory[]
  ): boolean {
    try {
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      const metadataFile = path.join(effectiveLocalPath, '.starcode-meta.json')
      
      if (!fs.existsSync(metadataFile)) {
        return true
      }

      const existingMetadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'))
      
      // 比较数量
      if (existingMetadata.totalSnippets !== currentSnippets.length || 
          existingMetadata.totalDirectories !== currentDirectories.length) {
        return true
      }

      return false
    } catch (error) {
      return true
    }
  }

  /**
   * 清除本地代码库文件
   */
  public async clearLocalCodebase(): Promise<void> {
    const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
    
    const filesToClear = [
      path.join(effectiveLocalPath, 'snippets.json'),
      path.join(effectiveLocalPath, 'directories.json'),
      path.join(effectiveLocalPath, '.starcode-meta.json')
    ]
    
    for (const filePath of filesToClear) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
      } catch (error) {
        console.warn(`删除文件失败 ${filePath}:`, error)
      }
    }
  }

  /**
   * 创建备份目录并备份现有文件
   */
  public async createBackup(): Promise<{ success: boolean; backupDir?: string }> {
    try {
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      const backupDir = path.join(effectiveLocalPath, '.backup-' + Date.now())
      
      const snippetsFile = path.join(effectiveLocalPath, 'snippets.json')
      const directoriesFile = path.join(effectiveLocalPath, 'directories.json')
      const metadataFile = path.join(effectiveLocalPath, '.starcode-meta.json')
      
      // 检查是否有文件需要备份
      const hasFiles = fs.existsSync(snippetsFile) || 
                      fs.existsSync(directoriesFile) || 
                      fs.existsSync(metadataFile)
      
      if (!hasFiles) {
        return { success: true }
      }
      
      // 创建备份目录
      fs.mkdirSync(backupDir, { recursive: true })
      
      // 备份文件
      if (fs.existsSync(snippetsFile)) {
        fs.copyFileSync(snippetsFile, path.join(backupDir, 'snippets.json'))
      }
      
      if (fs.existsSync(directoriesFile)) {
        fs.copyFileSync(directoriesFile, path.join(backupDir, 'directories.json'))
      }
      
      if (fs.existsSync(metadataFile)) {
        fs.copyFileSync(metadataFile, path.join(backupDir, '.starcode-meta.json'))
      }
      
      return { success: true, backupDir }
      
    } catch (error) {
      console.warn('创建备份失败:', error)
      return { success: false }
    }
  }

  /**
   * 恢复备份
   */
  public async restoreBackup(backupDir: string): Promise<{ success: boolean }> {
    try {
      if (!fs.existsSync(backupDir)) {
        return { success: false }
      }
      
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      
      const backupFiles = [
        { backup: path.join(backupDir, 'snippets.json'), target: path.join(effectiveLocalPath, 'snippets.json') },
        { backup: path.join(backupDir, 'directories.json'), target: path.join(effectiveLocalPath, 'directories.json') },
        { backup: path.join(backupDir, '.starcode-meta.json'), target: path.join(effectiveLocalPath, '.starcode-meta.json') }
      ]
      
      for (const { backup, target } of backupFiles) {
        if (fs.existsSync(backup)) {
          fs.copyFileSync(backup, target)
        }
      }
      
      // 清理备份目录
      await this.deleteDirectory(backupDir)
      
      return { success: true }
      
    } catch (error) {
      console.warn('恢复备份失败:', error)
      return { success: false }
    }
  }

  /**
   * 清理备份目录
   */
  public async cleanupBackup(backupDir: string): Promise<void> {
    try {
      if (fs.existsSync(backupDir)) {
        await this.deleteDirectory(backupDir)
      }
    } catch (error) {
      console.warn('清理备份失败:', error)
    }
  }

  /**
   * 递归删除目录
   * 与原始代码完全一致：包含Windows权限处理
   */
  private async deleteDirectory(dirPath: string): Promise<void> {
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath)
      
      for (const file of files) {
        const filePath = path.join(dirPath, file)
        const stat = fs.statSync(filePath)
        
        if (stat.isDirectory()) {
          await this.deleteDirectory(filePath)
        } else {
          // 在Windows上，可能需要移除只读属性
          try {
            fs.chmodSync(filePath, 0o666)
          } catch (chmodError) {
            // 忽略权限错误
          }
          fs.unlinkSync(filePath)
        }
      }
      
      fs.rmdirSync(dirPath)
    }
  }

  /**
   * 检查文件是否存在
   */
  public fileExists(filePath: string): boolean {
    return fs.existsSync(filePath)
  }

  /**
   * 获取文件修改时间
   */
  public getFileModifiedTime(filePath: string): number {
    try {
      const stats = fs.statSync(filePath)
      return stats.mtime.getTime()
    } catch (error) {
      return 0
    }
  }

  /**
   * 确保目录存在
   */
  public ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
  }

  /**
   * 代码片段转JSON字符串
   */
  public snippetToJson(snippet: CodeSnippet): string {
    return JSON.stringify(snippet, null, 2)
  }

  /**
   * 将JSON字符串转换为代码片段
   */
  public jsonToSnippet(json: string): CodeSnippet {
    return JSON.parse(json)
  }

  /**
   * 计算字符串的哈希值
   * 与原始代码完全一致
   */
  public calculateHash(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
  }

  /**
   * 检查两个代码片段是否有内容差异
   */
  public hasSnippetContentDifference(local: CodeSnippet, remote: CodeSnippet): boolean {
    // 比较核心内容字段
    if (local.fullPath !== remote.fullPath) {
      return true
    }

    if (local.name !== remote.name) {
      return true
    }

    if (local.code !== remote.code) {
      return true
    }

    if (local.language !== remote.language) {
      return true
    }

    if (local.category !== remote.category) {
      return true
    }

    if (local.filePath !== remote.filePath) {
      return true
    }

    if (local.fileName !== remote.fileName) {
      return true
    }

    return false
  }

  /**
   * 检查目录是否有内容差异
   */
  public hasDirectoryContentDifference(local: Directory, remote: Directory): boolean {
    // 比较核心内容字段
    if (local.fullPath !== remote.fullPath) {
      return true
    }

    if (local.name !== remote.name) {
      return true
    }

    if (local.order !== remote.order) {
      return true
    }

    return false
  }

  /**
   * 清理旧文件（包括冲突文件和临时凭据文件）
   */
  public async cleanupOldFiles(): Promise<void> {
    try {
      // 清理旧的冲突文件
      await this.cleanupOldConflictFiles()
      
      // 清理临时凭据文件
      const { TempFilesCleaner } = await import('../cleanupTempFiles')
      const tempFilesCheck = await TempFilesCleaner.checkNeedCleanup()
      if (tempFilesCheck.needCleanup) {
        const cleanupResult = await TempFilesCleaner.cleanupGiteeCredFiles()
        if (cleanupResult.success && cleanupResult.deletedFiles.length > 0) {
          console.log(`已自动清理 ${cleanupResult.deletedFiles.length} 个临时凭据文件`)
        }
      }
    } catch (cleanupError) {
      console.warn('清理临时文件时出错（不影响同步）:', cleanupError)
    }
  }
}