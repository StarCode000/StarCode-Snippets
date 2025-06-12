import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { CodeSnippet, Directory } from '../../types/types'
import { SettingsManager } from '../settingsManager'

/**
 * 极简文件系统管理器 - 纯代码文件存储版本
 * 负责Git仓库的纯代码文件操作，不存储任何元数据
 * 
 * 设计原则：
 * - Git仓库只存储纯代码文件
 * - 所有元数据（名称、分类、时间戳等）保存在VSCode本地存储
 * - 通过gitPath字段建立映射关系
 * - 目录结构从文件系统直接推导
 */
export class FileSystemManager {

  /**
   * 语言到文件扩展名的映射
   */
  private readonly languageExtensionMap: { [key: string]: string } = {
    typescript: '.ts',
    javascript: '.js',
    html: '.html',
    css: '.css',
    json: '.json',
    vue: '.vue',
    python: '.py',
    java: '.java',
    csharp: '.cs',
    cpp: '.cpp',
    go: '.go',
    php: '.php',
    ruby: '.rb',
    rust: '.rs',
    sql: '.sql',
    markdown: '.md',
    yaml: '.yml',
    shell: '.sh',
    powershell: '.ps1',
    xml: '.xml',
    dockerfile: '.dockerfile',
    makefile: '',
    plaintext: '.txt'
  }

  /**
   * 将VSCode数据写入Git仓库作为纯代码文件
   */
  public async writeToGit(snippets: CodeSnippet[], directories: Directory[]): Promise<void> {
    try {
    const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      console.log(`🔍 写入Git仓库数据开始...`)
      console.log(`   准备写入: ${snippets.length} 个代码片段, ${directories.length} 个目录`)

      // 验证输入数据
      await this.validateInputData(snippets, directories)

      // 【修复】智能文件更新：只更新有变更的文件，而不是删除重建
      await this.smartUpdateCodeFiles(effectiveLocalPath, snippets)

      console.log(`✅ Git仓库数据写入完成`)

    } catch (error) {
      console.error('❌ 写入Git仓库失败:', error)
      throw error
    }
  }

  /**
   * 从Git仓库读取纯代码文件，重建VSCode数据结构
   */
  public async readFromGit(): Promise<{ snippets: CodeSnippet[]; directories: Directory[] }> {
    try {
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      console.log(`🔍 从Git仓库读取数据开始...`)

    if (!fs.existsSync(effectiveLocalPath)) {
        console.log(`📁 Git仓库目录不存在: ${effectiveLocalPath}`)
        return { snippets: [], directories: [] }
      }

      // 扫描代码文件
      const snippets = await this.scanCodeFiles(effectiveLocalPath)
      
      // 从文件结构推导目录
      const directories = this.deriveDirectoriesFromFiles(snippets)

      console.log(`✅ Git仓库数据读取完成: ${snippets.length} 个代码片段, ${directories.length} 个目录`)
      return { snippets, directories }

    } catch (error) {
      console.error('❌ 读取Git仓库失败:', error)
      throw error
    }
  }

  /**
   * 验证输入数据的完整性
   */
  private async validateInputData(snippets: CodeSnippet[], directories: Directory[]): Promise<void> {
    for (const snippet of snippets) {
      if (!snippet.name) {
        throw new Error(`代码片段名称不能为空`)
      }
      if (snippet.code === undefined || snippet.code === null) {
        console.warn(`⚠️ 代码片段 ${snippet.name} 的代码内容为空`)
      }
      if (!snippet.language) {
        console.warn(`⚠️ 代码片段 ${snippet.name} 没有指定语言，将使用 plaintext`)
        snippet.language = 'plaintext'
      }
    }
  }

  /**
   * 清理现有的代码文件（保留Git相关文件）
   */
  private async cleanExistingCodeFiles(repoPath: string): Promise<void> {
    const protectedFiles = [
      '.git', 
      '.gitignore', 
      'README.md', 
      'LICENSE',
      '.github',
      '.vscode'
    ]
    
    if (!fs.existsSync(repoPath)) {
      return
    }
    
    const entries = fs.readdirSync(repoPath, { withFileTypes: true })
    
    for (const entry of entries) {
      const entryPath = path.join(repoPath, entry.name)
      
      // 跳过受保护的文件和目录
      if (protectedFiles.includes(entry.name)) {
        continue
      }
      
      try {
        if (entry.isDirectory()) {
          await this.deleteDirectory(entryPath)
        } else {
          fs.unlinkSync(entryPath)
        }
      } catch (error) {
        console.warn(`⚠️ 删除 ${entryPath} 失败:`, error)
      }
    }
  }

  /**
   * 创建目录结构（基于代码片段的路径）
   */
  private async createDirectoryStructure(repoPath: string, snippets: CodeSnippet[]): Promise<void> {
    const dirsToCreate = new Set<string>()
    
    // 从代码片段路径中提取需要创建的目录
    for (const snippet of snippets) {
      const gitPath = this.generateGitPath(snippet)
      const dirPath = path.dirname(gitPath)
      
      if (dirPath && dirPath !== '.') {
        // 确保所有父级目录都被创建
        let currentPath = ''
        const pathParts = dirPath.split('/').filter(p => p)
        
        for (const part of pathParts) {
          currentPath = currentPath ? `${currentPath}/${part}` : part
          dirsToCreate.add(currentPath)
        }
      }
    }
    
    // 按路径深度排序，确保父目录在子目录之前创建
    const sortedDirs = Array.from(dirsToCreate).sort((a, b) => {
      return a.split('/').length - b.split('/').length
    })
    
    for (const dirPath of sortedDirs) {
      const fullDirPath = path.join(repoPath, dirPath)
      
      try {
        if (!fs.existsSync(fullDirPath)) {
          fs.mkdirSync(fullDirPath, { recursive: true })
          console.log(`📁 创建目录: ${dirPath}`)
        }
      } catch (error) {
        console.error(`❌ 创建目录失败 ${dirPath}:`, error)
        throw error
      }
    }
  }

  /**
   * 写入纯代码文件
   */
  private async writeCodeFiles(repoPath: string, snippets: CodeSnippet[]): Promise<void> {
    // 使用基础名称（不含扩展名）作为唯一性判断依据
    const processedSnippets = new Map<string, CodeSnippet>()
    
    for (const snippet of snippets) {
      try {
        const gitPath = this.generateGitPath(snippet)
        const baseKey = this.getSnippetBaseKey(gitPath)
        
        // 检查是否已有同名片段（基于基础名称）
        if (processedSnippets.has(baseKey)) {
          const existingSnippet = processedSnippets.get(baseKey)!
          console.log(`⚠️ 发现同名代码片段: ${snippet.name}，将合并内容`)
          
          // 合并逻辑：保留更新的内容，或合并两者
          const mergedSnippet = this.mergeSnippets(existingSnippet, snippet)
          processedSnippets.set(baseKey, mergedSnippet)
        } else {
          processedSnippets.set(baseKey, snippet)
        }
        
      } catch (error) {
        console.error(`❌ 处理代码片段失败 ${snippet.name}:`, error)
        throw error
      }
    }
    
    // 写入合并后的代码片段
    for (const [baseKey, snippet] of processedSnippets) {
      try {
        const gitPath = this.generateGitPath(snippet)
        const fullFilePath = path.join(repoPath, gitPath)
        const dirPath = path.dirname(fullFilePath)
        
        // 确保目录存在
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true })
        }
        
        // 写入纯代码内容
        fs.writeFileSync(fullFilePath, snippet.code || '', 'utf8')
        
        console.log(`📄 写入代码文件: ${snippet.name} -> ${gitPath}`)
        
      } catch (error) {
        console.error(`❌ 写入代码文件失败 ${snippet.name}:`, error)
        throw error
      }
    }
  }

  /**
   * 【新增】智能文件更新：检测变更并只更新必要的文件
   * 这样可以确保Git能够正确检测到语言变更（文件扩展名变更）
   */
  private async smartUpdateCodeFiles(repoPath: string, snippets: CodeSnippet[]): Promise<void> {
    // 确保仓库目录存在
    if (!fs.existsSync(repoPath)) {
      fs.mkdirSync(repoPath, { recursive: true })
    }

    // 第一步：扫描现有文件
    const existingFiles = this.scanExistingCodeFiles(repoPath)
    console.log(`📋 扫描到现有文件: ${existingFiles.size} 个`)

    // 第二步：处理同名片段合并
    const processedSnippets = new Map<string, CodeSnippet>()
    
    for (const snippet of snippets) {
      try {
        const gitPath = this.generateGitPath(snippet)
        const baseKey = this.getSnippetBaseKey(gitPath)
        
        // 检查是否已有同名片段（基于基础名称）
        if (processedSnippets.has(baseKey)) {
          const existingSnippet = processedSnippets.get(baseKey)!
          console.log(`⚠️ 发现同名代码片段: ${snippet.name}，将合并内容`)
          
          // 合并逻辑：保留更新的内容，或合并两者
          const mergedSnippet = this.mergeSnippets(existingSnippet, snippet)
          processedSnippets.set(baseKey, mergedSnippet)
        } else {
          processedSnippets.set(baseKey, snippet)
        }
        
      } catch (error) {
        console.error(`❌ 处理代码片段失败 ${snippet.name}:`, error)
        throw error
      }
    }

    // 第三步：分析变更需求
    const requiredFiles = new Set<string>()
    const changedFiles: string[] = []
    const newFiles: string[] = []

    for (const [baseKey, snippet] of processedSnippets) {
      const gitPath = this.generateGitPath(snippet)
      const fullFilePath = path.join(repoPath, gitPath)
      
      requiredFiles.add(gitPath)

      // 检查文件是否需要更新（统一扩展名后简化逻辑）
      const needsUpdate = this.needsFileUpdate(fullFilePath, snippet, existingFiles)

      if (needsUpdate) {
        if (fs.existsSync(fullFilePath)) {
          changedFiles.push(gitPath)
        } else {
          newFiles.push(gitPath)
        }

        // 确保目录存在
        const dirPath = path.dirname(fullFilePath)
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true })
          console.log(`📁 创建目录: ${path.dirname(gitPath)}`)
        }

        // 写入文件（Markdown代码块格式）
        const markdownContent = this.generateMarkdownContent(snippet)
        fs.writeFileSync(fullFilePath, markdownContent, 'utf8')
        console.log(`📄 ${fs.existsSync(fullFilePath) ? '更新' : '创建'}代码文件: ${snippet.name} -> ${gitPath}`)
      }
    }

    // 第四步：删除不再需要的文件
    const filesToDelete: string[] = []
    for (const existingFile of existingFiles.keys()) {
      if (!requiredFiles.has(existingFile)) {
        filesToDelete.push(existingFile)
      }
    }

    for (const fileToDelete of filesToDelete) {
      const fullFilePath = path.join(repoPath, fileToDelete)
      try {
        fs.unlinkSync(fullFilePath)
        console.log(`🗑️ 删除不需要的文件: ${fileToDelete}`)
      } catch (error) {
        console.warn(`⚠️ 删除文件失败 ${fileToDelete}:`, error)
      }
    }

    console.log(`📊 文件变更统计: ${newFiles.length} 个新增, ${changedFiles.length} 个修改, ${filesToDelete.length} 个删除`)
  }

  /**
   * 扫描现有的代码文件
   */
  private scanExistingCodeFiles(repoPath: string): Map<string, { mtime: number; size: number }> {
    const existingFiles = new Map<string, { mtime: number; size: number }>()
    
    if (!fs.existsSync(repoPath)) {
      return existingFiles
    }

    const scanDir = (currentPath: string, relativePath: string = '') => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true })
      
      for (const entry of entries) {
        const fullEntryPath = path.join(currentPath, entry.name)
        const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name
        
        if (entry.isDirectory()) {
          // 跳过受保护的目录
          if (entry.name.startsWith('.') && entry.name !== '.vscode') {
            continue
          }
          scanDir(fullEntryPath, entryRelativePath)
        } else {
          // 跳过受保护的文件
          if (entry.name.startsWith('.') || 
              entry.name === 'README.md' || 
              entry.name === 'LICENSE') {
            continue
          }
          
          try {
            const stats = fs.statSync(fullEntryPath)
            existingFiles.set(entryRelativePath, {
              mtime: stats.mtime.getTime(),
              size: stats.size
            })
          } catch (error) {
            console.warn(`获取文件信息失败 ${entryRelativePath}:`, error)
          }
        }
      }
    }

    scanDir(repoPath)
    return existingFiles
  }

  /**
   * 检查文件是否需要更新（Markdown格式）
   */
  private needsFileUpdate(
    fullFilePath: string, 
    snippet: CodeSnippet,
    existingFiles: Map<string, { mtime: number; size: number }>
  ): boolean {
    if (!fs.existsSync(fullFilePath)) {
      return true // 文件不存在，需要创建
    }

    try {
      // 读取现有文件内容并解析
      const existingContent = fs.readFileSync(fullFilePath, 'utf8')
      const existingData = this.parseMarkdownContent(existingContent)
      
      // 比较内容和语言
      const newContent = snippet.code || ''
      const newLanguage = snippet.language || 'plaintext'
      const newMarkdownContent = this.generateMarkdownContent(snippet)

      // 【优化】更精确的内容比较
      if (existingData.code !== newContent || existingData.language !== newLanguage) {
        console.log(`📄 检测到内容差异: ${path.basename(fullFilePath)}`)
        console.log(`   语言: ${existingData.language} -> ${newLanguage}`)
        console.log(`   内容长度: ${existingData.code.length} -> ${newContent.length}`)
        return true
      }
      
      // 【新增】检查生成的Markdown格式是否完全一致
      if (existingContent.trim() !== newMarkdownContent.trim()) {
        console.log(`📄 检测到格式差异: ${path.basename(fullFilePath)}`)
        return true
      }
      
      console.log(`✅ 文件内容一致，无需更新: ${path.basename(fullFilePath)}`)
      return false // 内容相同，不需要更新
    } catch (error) {
      console.warn(`检查文件更新需求失败 ${fullFilePath}:`, error)
      return true // 出错时保守更新
    }
  }

  /**
   * 处理语言变更（扩展名变更）
   * 检测基于相同基础名称但扩展名不同的文件
   */
  private async handleLanguageChanges(
    repoPath: string,
    processedSnippets: Map<string, CodeSnippet>,
    existingFiles: Map<string, { mtime: number; size: number }>
  ): Promise<void> {
    // 构建基础名称到新文件路径的映射
    const baseNameToNewPath = new Map<string, string>()
    
    for (const [baseKey, snippet] of processedSnippets) {
      const gitPath = this.generateGitPath(snippet)
      baseNameToNewPath.set(baseKey, gitPath)
    }

    // 检查现有文件是否存在基础名称相同但扩展名不同的情况
    for (const existingFilePath of existingFiles.keys()) {
      const existingBaseKey = this.getSnippetBaseKey(existingFilePath)
      const expectedNewPath = baseNameToNewPath.get(existingBaseKey)

      if (expectedNewPath && expectedNewPath !== existingFilePath) {
        // 发现语言变更：基础名称相同但路径/扩展名不同
        const oldFullPath = path.join(repoPath, existingFilePath)
        const newFullPath = path.join(repoPath, expectedNewPath)

        console.log(`🔄 检测到语言变更: ${existingFilePath} -> ${expectedNewPath}`)

        try {
          // 删除旧文件
          if (fs.existsSync(oldFullPath)) {
            fs.unlinkSync(oldFullPath)
            console.log(`🗑️ 删除旧语言文件: ${existingFilePath}`)
          }

          // 新文件应该已经在前面的步骤中创建了
          if (fs.existsSync(newFullPath)) {
            console.log(`✅ 新语言文件已创建: ${expectedNewPath}`)
          }
        } catch (error) {
          console.error(`❌ 处理语言变更失败 ${existingFilePath} -> ${expectedNewPath}:`, error)
        }
      }
    }
  }

  /**
   * 获取代码片段的基础键值（用于唯一性判断）
   * 基于目录路径 + 基础文件名（不含扩展名）
   */
  private getSnippetBaseKey(gitPath: string): string {
    const dirPath = path.dirname(gitPath)
    const baseName = path.basename(gitPath, path.extname(gitPath))
    return dirPath === '.' ? baseName : `${dirPath}/${baseName}`
  }

  /**
   * 合并两个同名代码片段
   * 保留更新的内容和更完整的信息
   */
  private mergeSnippets(existing: CodeSnippet, incoming: CodeSnippet): CodeSnippet {
    // 根据创建时间判断哪个更新
    const existingTime = existing.createTime || 0
    const incomingTime = incoming.createTime || 0
    
    // 保留更新的代码内容，但合并其他信息
    const merged: CodeSnippet = {
      name: incomingTime > existingTime ? incoming.name : existing.name,
      code: incomingTime > existingTime ? incoming.code : existing.code,
      language: incoming.language || existing.language || 'plaintext',
      fullPath: incoming.fullPath || existing.fullPath,
      fileName: incoming.fileName || existing.fileName,
      filePath: incoming.filePath || existing.filePath,
      category: incoming.category || existing.category,
      order: Math.max(existing.order || 0, incoming.order || 0),
      createTime: Math.max(existingTime, incomingTime)
    }
    
    console.log(`🔀 合并代码片段: ${existing.name} + ${incoming.name} -> ${merged.name}`)
    return merged
  }

  /**
   * 扫描Git仓库中的代码文件
   */
  private async scanCodeFiles(repoPath: string): Promise<CodeSnippet[]> {
    const snippetMap = new Map<string, CodeSnippet>()
    
    const scanDir = (currentPath: string, relativePath: string = '') => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true })
      
      for (const entry of entries) {
        const fullEntryPath = path.join(currentPath, entry.name)
        const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name
        
        if (entry.isDirectory()) {
          // 跳过特殊目录
          if (entry.name.startsWith('.') && entry.name !== '.vscode') {
            continue
          }
          
          // 递归扫描子目录
          scanDir(fullEntryPath, entryRelativePath)
        } else {
          // 跳过特殊文件
          if (entry.name.startsWith('.') || 
              entry.name === 'README.md' || 
              entry.name === 'LICENSE') {
            continue
          }
          
          // 创建代码片段对象
          const snippet = this.createSnippetFromFile(fullEntryPath, entryRelativePath)
          if (snippet) {
            const baseKey = this.getSnippetBaseKey(entryRelativePath)
            
            // 检查是否已有同名片段（读取时的合并逻辑）
            if (snippetMap.has(baseKey)) {
              const existingSnippet = snippetMap.get(baseKey)!
              console.log(`⚠️ 读取时发现同名代码片段: ${snippet.name}，将合并`)
              
              // 合并时选择更完整或更新的版本
              const mergedSnippet = this.mergeSnippetsOnRead(existingSnippet, snippet)
              snippetMap.set(baseKey, mergedSnippet)
            } else {
              snippetMap.set(baseKey, snippet)
            }
          }
        }
      }
    }
    
    scanDir(repoPath)
    return Array.from(snippetMap.values())
  }

  /**
   * 读取时合并同名代码片段
   * 优先选择内容更丰富或文件更新的版本
   */
  private mergeSnippetsOnRead(existing: CodeSnippet, incoming: CodeSnippet): CodeSnippet {
    // 基于文件修改时间和内容长度选择更好的版本
    const existingContentLength = (existing.code || '').length
    const incomingContentLength = (incoming.code || '').length
    
    // 优先选择内容更多的版本，或者更新的版本
    const shouldUseIncoming = incomingContentLength > existingContentLength ||
                              (incomingContentLength === existingContentLength && 
                               (incoming.createTime || 0) > (existing.createTime || 0))
    
    const merged: CodeSnippet = shouldUseIncoming ? {
      ...incoming,
      // 合并一些可能有用的信息
      category: incoming.category || existing.category,
      order: Math.max(existing.order || 0, incoming.order || 0)
    } : {
      ...existing,
      // 合并一些可能有用的信息
      category: existing.category || incoming.category,
      order: Math.max(existing.order || 0, incoming.order || 0)
    }
    
    console.log(`🔀 读取合并: ${existing.name} + ${incoming.name} -> ${merged.name} (选择${shouldUseIncoming ? '新' : '旧'}版本)`)
    return merged
  }

  /**
   * 从代码文件创建代码片段对象（解析Markdown代码块格式）
   */
  private createSnippetFromFile(filePath: string, gitPath: string): CodeSnippet | null {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8')
      const fileName = path.basename(gitPath)
      
      // 解析Markdown代码块格式
      const { language, code } = this.parseMarkdownContent(fileContent)
      
      // 从文件名推导用户友好名称（移除.code扩展名）
      const name = this.generateNameFromFileName(fileName)
      
      // 【修复】从Git路径推导VSCode fullPath，确保与原有片段路径一致
      const fullPath = this.gitPathToVSCodePath(gitPath)
      
      console.log(`🔧 createSnippetFromFile: ${gitPath} -> ${fullPath}`)
      console.log(`   文件名: ${fileName} -> 名称: ${name}`)
      
      // 【修复】使用文件的修改时间作为createTime，保持一致性
      // 而不是生成新的时间戳，这样可以避免时间差异导致的重复问题
      const stats = fs.statSync(filePath)
      const createTime = stats.mtime.getTime()
      
      console.log(`   使用文件修改时间: ${createTime}`)
      
      return {
        name,
        code,
        language,
        fullPath,
        fileName,
        filePath: path.dirname(gitPath),
        category: '',
        order: 0,
        createTime
      }
    } catch (error) {
      console.error(`解析代码文件失败: ${filePath}`, error)
      return null
    }
  }

  /**
   * 从文件结构推导目录列表
   */
  private deriveDirectoriesFromFiles(snippets: CodeSnippet[]): Directory[] {
    const directories: Directory[] = []
    const processedPaths = new Set<string>()
    
    for (const snippet of snippets) {
      // 从VSCode fullPath中提取所有父级路径
      const pathParts = snippet.fullPath.split('/').filter(p => p)
      
      for (let i = 1; i < pathParts.length; i++) {
        const dirPath = '/' + pathParts.slice(0, i).join('/')
        
        if (!processedPaths.has(dirPath)) {
          processedPaths.add(dirPath)
          
          directories.push({
            name: pathParts[i - 1],
            fullPath: dirPath,
            order: 0
          })
        }
      }
    }
    
    return directories
  }

  /**
   * 生成Git仓库中的文件路径
   */
  private generateGitPath(snippet: CodeSnippet): string {
    // 如果已经有gitPath，直接使用
    if ('gitPath' in snippet && snippet.gitPath) {
      return snippet.gitPath as string
    }
    
    // 从VSCode fullPath生成Git路径
    const pathParts = snippet.fullPath.split('/').filter(p => p)
    const fileName = this.generateFileName(snippet)
    
    if (pathParts.length <= 1) {
      // 根目录文件
      return fileName
    } else {
      // 子目录文件
      const dirPath = pathParts.slice(0, -1).map(p => this.sanitizeFileName(p)).join('/')
      return `${dirPath}/${fileName}`
    }
  }

  /**
   * 生成文件名（无扩展名）
   */
  private generateFileName(snippet: CodeSnippet): string {
    return this.sanitizeFileName(snippet.name)
  }

  /**
   * 生成Markdown代码块格式内容
   */
  private generateMarkdownContent(snippet: CodeSnippet): string {
    // 【修复】在写入时就规范化语言ID，避免写入无效的语言ID到Git文件
    const normalizedLanguage = this.normalizeLanguageId(snippet.language || 'plaintext')
    const code = snippet.code || ''
    return `\`\`\`${normalizedLanguage}\n${code}\n\`\`\``
  }

  /**
   * 解析Markdown代码块格式内容
   */
  private parseMarkdownContent(content: string): { language: string; code: string } {
    // 匹配markdown代码块格式: ```language\ncode\n```
    const match = content.match(/^```(\w*)\n([\s\S]*)\n```$/m)
    
    if (match) {
      const rawLanguage = match[1] || 'plaintext'
      // 【兼容性修复】处理现有Git文件中可能包含的无效语言ID
      // 只对明显无效的ID进行映射，避免过度处理
      const language = this.isInvalidLanguageId(rawLanguage) ? this.normalizeLanguageId(rawLanguage) : rawLanguage
      return {
        language,
        code: match[2] || ''
      }
    }
    
    // 如果不是标准格式，尝试提取内容
    const fallbackMatch = content.match(/^```(\w*)\n?([\s\S]*?)```?$/m)
    if (fallbackMatch) {
      const rawLanguage = fallbackMatch[1] || 'plaintext'
      const language = this.isInvalidLanguageId(rawLanguage) ? this.normalizeLanguageId(rawLanguage) : rawLanguage
      return {
        language, 
        code: fallbackMatch[2] || ''
      }
    }
    
    // 如果完全不匹配，当作纯文本处理
    return {
      language: 'plaintext',
      code: content
    }
  }

  /**
   * 【新增】检查是否为明显无效的语言ID（需要映射的简写形式）
   */
  private isInvalidLanguageId(languageId: string): boolean {
    if (!languageId || typeof languageId !== 'string') {
      return false
    }

    const normalized = languageId.toLowerCase().trim()
    
    // 只对常见的简写形式进行映射，避免过度处理
    const commonShortcuts = [
      'ts', 'js', 'py', 'cs', 'rb', 'rs', 'go', 'sh', 'yml', 'md', 'cpp', 'cc', 'h', 'hpp'
    ]
    
    return commonShortcuts.includes(normalized)
  }

  /**
   * 【新增】规范化语言ID，将无效或非标准的语言ID转换为VSCode识别的有效ID
   */
  private normalizeLanguageId(languageId: string): string {
    if (!languageId || typeof languageId !== 'string') {
      return 'plaintext'
    }

    const normalized = languageId.toLowerCase().trim()
    
    // 语言ID映射表：将常见的非标准ID转换为VSCode标准ID
    const languageIdMap: { [key: string]: string } = {
      // TypeScript相关
      'ts': 'typescript',
      'tsx': 'typescriptreact',
      
      // JavaScript相关
      'js': 'javascript',
      'jsx': 'javascriptreact',
      'node': 'javascript',
      'nodejs': 'javascript',
      
      // Web相关
      'htm': 'html',
      'xml': 'xml',
      'svg': 'xml',
      
      // 样式相关
      'scss': 'scss',
      'sass': 'sass',
      'less': 'less',
      'stylus': 'stylus',
      
      // 配置文件
      'yml': 'yaml',
      'yaml': 'yaml',
      'toml': 'toml',
      'ini': 'ini',
      
      // 编程语言
      'py': 'python',
      'rb': 'ruby',
      'cs': 'csharp',
      'c++': 'cpp',
      'cc': 'cpp',
      'cxx': 'cpp',
      'hpp': 'cpp',
      'h': 'c',
      'kt': 'kotlin',
      'kts': 'kotlin',
      'swift': 'swift',
      'rs': 'rust',
      'go': 'go',
      'dart': 'dart',
      'scala': 'scala',
      'r': 'r',
      
      // Shell相关
      'sh': 'shell',
      'bash': 'shell',
      'zsh': 'shell',
      'fish': 'shell',
      'ps1': 'powershell',
      'pwsh': 'powershell',
      'cmd': 'bat',
      'batch': 'bat',
      
      // 数据格式
      'json': 'json',
      'jsonc': 'jsonc',
      'csv': 'csv',
      
      // 文档格式
      'md': 'markdown',
      'markdown': 'markdown',
      'tex': 'latex',
      'latex': 'latex',
      
      // 其他
      'text': 'plaintext',
      'txt': 'plaintext',
      '': 'plaintext'
    }
    
    // 如果在映射表中找到，使用映射值
    if (languageIdMap.hasOwnProperty(normalized)) {
      const mappedLanguage = languageIdMap[normalized]
      console.log(`🔧 语言ID映射: "${languageId}" -> "${mappedLanguage}"`)
      return mappedLanguage
    }
    
    // 如果在我们的扩展名映射表中有对应的语言，直接使用
    if (this.languageExtensionMap.hasOwnProperty(normalized)) {
      return normalized
    }
    
    // 检查是否是VSCode支持的常见语言ID（不做映射，直接使用）
    const commonVSCodeLanguages = [
      'typescript', 'javascript', 'html', 'css', 'json', 'python', 'java', 
      'csharp', 'cpp', 'c', 'go', 'rust', 'php', 'ruby', 'sql', 'shell',
      'powershell', 'dockerfile', 'yaml', 'xml', 'markdown', 'plaintext',
      'vue', 'react', 'angular', 'svelte', 'sass', 'scss', 'less',
      'kotlin', 'swift', 'dart', 'scala', 'r', 'matlab', 'perl', 'lua'
    ]
    
    if (commonVSCodeLanguages.includes(normalized)) {
      return normalized
    }
    
    // 如果都不匹配，给出警告并使用plaintext
    console.warn(`⚠️ 未知的语言ID: "${languageId}"，将使用 plaintext`)
    return 'plaintext'
  }

  /**
   * 清理文件名中的非法字符
   */
  private sanitizeFileName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '_')  // 只保留字母数字中文
      .replace(/_+/g, '_')                      // 合并连续下划线
      .replace(/^_|_$/g, '')                    // 去除首尾下划线
      || 'unnamed'                              // 如果清理后为空，使用默认名称
  }

  /**
   * 根据语言获取文件扩展名
   */
  private getExtensionByLanguage(language: string): string {
    return this.languageExtensionMap[language] || '.txt'
  }

  /**
   * 从文件扩展名检测语言
   */
  private detectLanguageFromExtension(fileName: string): string | null {
    const ext = path.extname(fileName).toLowerCase()
    
    for (const [language, extension] of Object.entries(this.languageExtensionMap)) {
      if (extension === ext) {
        return language
      }
    }
    
    return null
  }

  /**
   * 从文件名生成用户友好名称
   */
  private generateNameFromFileName(fileName: string): string {
    // 【修复】与gitPathToVSCodePath保持一致的命名逻辑
    // 移除文件扩展名，然后替换下划线为空格
    const baseName = fileName.replace(/\.[^.]*$/, '') // 移除扩展名
    
    // 替换下划线为空格，保持原始大小写
    return baseName.replace(/_/g, ' ')
  }

  /**
   * Git路径转换为VSCode fullPath
   * 【修复】确保与原有片段的fullPath生成逻辑一致
   */
  private gitPathToVSCodePath(gitPath: string): string {
    const pathParts = gitPath.split('/').filter(p => p)
    const fileName = pathParts[pathParts.length - 1]
    
    // 【修复】从文件名提取代码片段名称，保持与原有逻辑一致
    // 移除任何文件扩展名，直接使用文件名作为代码片段名称
    const snippetName = fileName.replace(/\.[^.]*$/, '') // 移除扩展名
    
    // 构建VSCode路径，最后一部分是代码片段名称
    if (pathParts.length === 1) {
      // 根目录文件：/snippetName
      return `/${snippetName}`
    } else {
      // 子目录文件：/dir1/dir2/snippetName
      const dirParts = pathParts.slice(0, -1)
      return `/${dirParts.join('/')}/${snippetName}`
    }
  }

  /**
   * 删除目录及其内容
   */
  private async deleteDirectory(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      return
    }

    const stats = fs.statSync(dirPath)
    if (!stats.isDirectory()) {
      fs.unlinkSync(dirPath)
      return
    }

    const entries = fs.readdirSync(dirPath)
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry)
      const entryStats = fs.statSync(entryPath)
      
      if (entryStats.isDirectory()) {
        await this.deleteDirectory(entryPath)
      } else {
        fs.unlinkSync(entryPath)
      }
    }
    
    fs.rmdirSync(dirPath)
  }

  // ==================== 备份相关方法 ====================

  /**
   * 创建备份目录并备份现有文件
   */
  public async createBackup(): Promise<{ success: boolean; backupDir?: string }> {
    try {
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      const backupDir = path.join(effectiveLocalPath, '.backup-' + Date.now())
      
      // 检查是否有内容需要备份
      if (!fs.existsSync(effectiveLocalPath)) {
        return { success: true }
      }
      
      const entries = fs.readdirSync(effectiveLocalPath, { withFileTypes: true })
      const hasContent = entries.some(entry => {
        if (entry.name.startsWith('.git')) {
          return false
        }
        if (entry.name.startsWith('.backup-')) {
          return false
        }
        if (entry.name === 'README.md' || entry.name === 'LICENSE') {
          return false
        }
        return true
      })
      
      if (!hasContent) {
        return { success: true }
      }
      
      // 创建备份目录
      fs.mkdirSync(backupDir, { recursive: true })
      
      // 复制所有非Git和非备份文件
      await this.copyDirectoryContents(effectiveLocalPath, backupDir, ['.git', '.backup-'])
      
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
      
      // 清理现有内容（保留.git）
      await this.cleanExistingCodeFiles(effectiveLocalPath)
      
      // 恢复备份内容
      await this.copyDirectoryContents(backupDir, effectiveLocalPath)
      
      return { success: true }
      
    } catch (error) {
      console.error('恢复备份失败:', error)
      return { success: false }
    }
  }

  /**
   * 清理备份
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
   * 复制目录内容
   */
  private async copyDirectoryContents(
    srcDir: string, 
    destDir: string, 
    excludes: string[] = []
  ): Promise<void> {
    if (!fs.existsSync(srcDir)) {
      return
    }
    
    const entries = fs.readdirSync(srcDir, { withFileTypes: true })
    
    for (const entry of entries) {
      // 检查是否应该排除此项
      const shouldExclude = excludes.some(exclude => {
        if (exclude.endsWith('-')) {
          return entry.name.startsWith(exclude)
        }
        return entry.name === exclude
      })
      
      if (shouldExclude) {
        continue
      }
      
      const srcPath = path.join(srcDir, entry.name)
      const destPath = path.join(destDir, entry.name)
      
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true })
        await this.copyDirectoryContents(srcPath, destPath, excludes)
      } else {
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }

  // ==================== 工具方法 ====================

  public fileExists(filePath: string): boolean {
    return fs.existsSync(filePath)
  }

  public getFileModifiedTime(filePath: string): number {
    try {
      const stats = fs.statSync(filePath)
      return stats.mtime.getTime()
    } catch (error) {
      return Date.now()
    }
  }

  public ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
  }

  public calculateHash(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex')
  }

  public hasSnippetContentDifference(local: CodeSnippet, remote: CodeSnippet): boolean {
    return (
      local.name !== remote.name ||
      local.code !== remote.code ||
      local.language !== remote.language
    )
  }

  public hasDirectoryContentDifference(local: Directory, remote: Directory): boolean {
    return local.name !== remote.name || local.fullPath !== remote.fullPath
  }

  public async cleanupOldFiles(): Promise<void> {
    console.log('✅ 极简文件存储模式无需清理旧文件')
  }

  // ==================== 向后兼容的遗留方法 ====================

  public snippetToJson(snippet: CodeSnippet): string {
    return JSON.stringify(snippet, null, 2)
  }

  public jsonToSnippet(json: string): CodeSnippet {
    return JSON.parse(json)
  }

  /**
   * 【测试方法】验证极简文件存储系统是否正常工作
   */
  public async testPureFileStorage(): Promise<{ success: boolean; message: string }> {
    try {
      console.log('🧪 开始测试极简文件存储系统...')
      
      // 创建测试数据，包含同名代码片段测试
      const testSnippets: CodeSnippet[] = [
        {
          name: 'Hello World',
          code: 'console.log("Hello, World!");',
          language: 'javascript',
          fullPath: '/test/hello_world',
          fileName: 'hello_world.js',
          filePath: 'test',
          category: 'test',
          order: 1,
          createTime: Date.now()
        },
        {
          name: 'Hello World',  // 同名但不同语言
          code: 'print("Hello, World!")',
          language: 'python',
          fullPath: '/test/hello_world',  // 相同的VSCode路径
          fileName: 'hello_world.py',
          filePath: 'test',
          category: 'test',
          order: 2,
          createTime: Date.now() + 1000  // 更新的时间戳
        },
        {
          name: 'Test Function',
          code: 'function test() { return true; }',
          language: 'javascript',
          fullPath: '/utils/test_function',
          fileName: 'test_function.js',
          filePath: 'utils',
          category: 'utility',
          order: 3,
          createTime: Date.now()
        }
      ]
      
      const testDirectories: Directory[] = [
        {
          name: 'test',
          fullPath: '/test',
          order: 1
        },
        {
          name: 'utils',
          fullPath: '/utils',
          order: 2
        }
      ]
      
      console.log(`📝 测试写入：${testSnippets.length} 个代码片段（包含同名片段）`)
      await this.writeToGit(testSnippets, testDirectories)
      
      console.log('📖 测试读取...')
      const result = await this.readFromGit()
      
      console.log(`✅ 读取结果：${result.snippets.length} 个代码片段，${result.directories.length} 个目录`)
      
      // 验证同名代码片段合并逻辑
      if (result.snippets.length !== 2) {  // 应该合并为2个片段（hello_world合并，test_function独立）
        return {
          success: false,
          message: `同名代码片段合并失败：期望2个片段，实际${result.snippets.length}个`
        }
      }
      
      // 查找hello_world片段，应该保留Python版本（更新的时间戳）
      const helloWorldSnippet = result.snippets.find(s => s.name.toLowerCase().includes('hello'))
      if (!helloWorldSnippet) {
        return {
          success: false,
          message: '未找到合并后的hello_world代码片段'
        }
      }
      
      if (helloWorldSnippet.language !== 'python') {
        return {
          success: false,
          message: `同名代码片段合并错误：期望保留Python版本，实际保留${helloWorldSnippet.language}版本`
        }
      }
      
      return {
        success: true,
        message: `✅ 极简文件存储系统测试成功！成功处理同名代码片段合并：\n` +
                `- 原始片段：3个（包含2个同名）\n` +
                `- 合并后片段：${result.snippets.length}个\n` +
                `- 同名片段合并正确：保留了更新的Python版本\n` +
                `- 目录结构：${result.directories.length}个目录`
      }
      
    } catch (error) {
      return {
        success: false,
        message: `测试失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
    }
  }
}