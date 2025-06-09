import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { CodeSnippet, Directory } from '../../types/types'
import { SnippetConflict, DirectoryConflict, ConflictResolutionDetectionResult } from '../../types/syncTypes'
import { ConflictDetector } from './conflictDetector'
import { SettingsManager } from '../settingsManager'

/**
 * 手动冲突处理器
 * 负责创建冲突文件、设置文件监听器和处理用户的手动冲突解决
 */
export class ManualConflictHandler {
  private context: vscode.ExtensionContext | null = null
  private storageManager: any = null
  private conflictDetector: ConflictDetector
  private processingFiles: Set<string> = new Set() // 正在处理的文件集合，防止重复处理
  private resolvedSnippets: Map<string, CodeSnippet> = new Map() // 存储已解决的代码片段

  constructor(context?: vscode.ExtensionContext, storageManager?: any) {
    this.context = context || null
    this.storageManager = storageManager
    this.conflictDetector = new ConflictDetector()
  }

  /**
   * 处理需要手动合并的冲突
   * 为每个冲突创建临时文件并打开VSCode的合并编辑器
   */
  public async handleManualMergeConflicts(
    snippetConflicts: SnippetConflict[],
    directoryConflicts: DirectoryConflict[]
  ): Promise<{
    success: boolean
    message: string
    conflictCount: number
    conflictFiles: string[]
    resolvedSnippets?: CodeSnippet[]
  }> {
    const allConflicts = [...snippetConflicts, ...directoryConflicts]
    const conflictCount = allConflicts.length
    
    if (conflictCount === 0) {
      return {
        success: true,
        message: '没有需要手动解决的冲突',
        conflictCount: 0,
        conflictFiles: []
      }
    }

    try {
      // 为每个冲突创建临时合并文件
      const tempDir = path.join(SettingsManager.getEffectiveLocalPath(), '.merge-conflicts')
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true })
      }

      const conflictFiles: string[] = []
      const conflictFileMapping: Map<string, any> = new Map() // 映射冲突文件路径到冲突对象

      // 处理代码片段冲突
      for (let i = 0; i < snippetConflicts.length; i++) {
        const conflict = snippetConflicts[i]
        if (!conflict.conflictData) {continue}

        const conflictFileName = `conflict_${i + 1}_${conflict.fullPath.replace(/[\/\\]/g, '_')}.txt`
        const conflictFilePath = path.join(tempDir, conflictFileName)

        // 创建冲突文件内容（使用标准的Git冲突标记）
        const conflictContent = this.conflictDetector.createConflictFileContent(
          conflict.conflictData.localContent,
          conflict.conflictData.remoteContent,
          conflict.fullPath
        )

        fs.writeFileSync(conflictFilePath, conflictContent, 'utf8')
        conflictFiles.push(conflictFilePath)
        conflictFileMapping.set(conflictFilePath, conflict)
      }

      if (conflictFiles.length === 0) {
        return {
          success: true,
          message: '所有冲突都已自动解决',
          conflictCount: 0,
          conflictFiles: []
        }
      }

      // 检查是否存在已解决的冲突文件
      const resolvedConflicts = await this.checkForResolvedConflicts(tempDir, conflictFileMapping)
      
      if (resolvedConflicts.hasResolved) {
        // 用户已经手动解决了冲突，读取解决后的内容
        const resolvedSnippets: CodeSnippet[] = []
        
        for (const resolvedFile of resolvedConflicts.resolvedFiles) {
          const conflict = conflictFileMapping.get(resolvedFile.filePath)
          if (conflict) {
            // 创建解决后的代码片段对象
            const resolvedSnippet: CodeSnippet = {
              ...conflict.remote, // 使用远程的基础结构
              code: resolvedFile.resolvedContent, // 使用用户解决后的代码内容
              createTime: Math.max(conflict.local.createTime || 0, conflict.remote.createTime || 0) // 使用较新的时间戳
            }
            resolvedSnippets.push(resolvedSnippet)
          }
        }
        
        // 清理临时文件
        await this.cleanupTempConflictFiles(tempDir)
        
        return {
          success: true,
          message: `已读取用户手动解决的 ${resolvedConflicts.resolvedFiles.length} 个冲突`,
          conflictCount,
          conflictFiles: [],
          resolvedSnippets
        }
      }

      // 添加调试日志
      console.log(`准备显示冲突解决对话框，冲突文件数量：${conflictFiles.length}`)
      console.log(`冲突文件路径：`, conflictFiles)

      // 询问用户是否要打开合并编辑器
      const choice = await vscode.window.showWarningMessage(
        `检测到 ${conflictCount} 个需要手动解决的代码冲突。\n\n系统已经为每个冲突创建了临时文件，您可以：\n1. 打开冲突文件手动编辑\n2. 使用自动解决方案（保留较新版本）\n3. 取消同步`,
        { modal: true },
        '打开冲突文件',
        '自动解决（保留较新版本）',
        '取消同步'
      )
      
      console.log(`用户选择：${choice || '无选择（可能对话框没有显示）'}`)

      if (choice === '取消同步') {
        // 清理临时文件
        await this.cleanupTempConflictFiles(tempDir)
        return {
          success: false,
          message: '用户取消了同步操作',
          conflictCount,
          conflictFiles: []
        }
      }

      if (choice === '自动解决（保留较新版本）') {
        // 使用自动解决策略
        const resolvedSnippets: CodeSnippet[] = []
        for (const conflict of snippetConflicts) {
          if (conflict.conflictData) {
            // 基于时间戳选择版本
            const localTime = conflict.local.createTime || 0
            const remoteTime = conflict.remote.createTime || 0
            const resolved = remoteTime > localTime ? conflict.remote : conflict.local
            resolvedSnippets.push(resolved)
          }
        }

        // 清理临时文件
        await this.cleanupTempConflictFiles(tempDir)

        return {
          success: true,
          message: `已自动解决 ${conflictCount} 个冲突（保留较新版本）`,
          conflictCount,
          conflictFiles: [],
          resolvedSnippets
        }
      }

      if (choice === '打开冲突文件') {
        console.log('用户选择打开冲突文件进行手动解决')
        
        // 清空之前的解决结果
        this.resolvedSnippets.clear()
        console.log(`已清空解决结果缓存，当前缓存大小：${this.resolvedSnippets.size}`)
        
        // 设置文件监听器，当用户保存冲突文件时自动检查是否已解决
        this.setupConflictFileWatcher(tempDir, conflictFileMapping)
        
        // 打开第一个冲突文件
        if (conflictFiles.length > 0) {
          const document = await vscode.workspace.openTextDocument(conflictFiles[0])
          await vscode.window.showTextDocument(document)
          
          // 显示指引消息 - 通过通知方式
          vscode.window.showInformationMessage(
            `🔀 冲突解决指南：\n\n1. 保留您想要的内容\n2. 删除不需要的内容和冲突标记行（<<<<<<< ======= >>>>>>>）\n3. 关闭文件 - 系统将检查解决状态并应用您的解决方案\n\n💡 如果有多个冲突文件，解决当前文件后会自动打开下一个`,
            { modal: false },
            '了解'
          )
          
          // 显示额外的状态栏信息
          vscode.window.setStatusBarMessage(
            `📝 正在解决冲突 ${1}/${conflictFiles.length} - 关闭文件时检查解决状态`,
            10000
          )
        }

        // 等待用户解决所有冲突
        console.log(`开始等待用户解决冲突，总数：${conflictCount}，当前已解决：${this.resolvedSnippets.size}`)
        return await this.waitForConflictResolution(conflictFileMapping, conflictCount)
      }

      // 如果没有选择（可能对话框没有显示），默认打开冲突文件
      if (!choice) {
        console.warn('用户没有选择冲突解决方案，默认打开冲突文件')
        
        // 清空之前的解决结果
        this.resolvedSnippets.clear()
        console.log(`已清空解决结果缓存，当前缓存大小：${this.resolvedSnippets.size}`)
        
        // 设置文件监听器
        this.setupConflictFileWatcher(tempDir, conflictFileMapping)
        
        // 打开第一个冲突文件
        if (conflictFiles.length > 0) {
          try {
            const document = await vscode.workspace.openTextDocument(conflictFiles[0])
            await vscode.window.showTextDocument(document)
            
            // 显示指引消息
            vscode.window.showInformationMessage(
              `🔀 检测到代码冲突！\n\n请编辑此文件：\n1. 保留您想要的内容\n2. 删除冲突标记行（<<<<<<< ======= >>>>>>>）\n3. 关闭文件 - 系统将检查解决状态并应用解决方案`,
              { modal: false },
              '了解'
            )
            
            console.log(`已打开冲突文件：${conflictFiles[0]}`)
          } catch (openError) {
            console.error('打开冲突文件失败:', openError)
        return {
          success: false,
              message: `无法打开冲突文件: ${openError instanceof Error ? openError.message : '未知错误'}`,
          conflictCount,
              conflictFiles: []
            }
          }
        }
        
        // 等待用户解决所有冲突
        console.log(`开始等待用户解决冲突，总数：${conflictCount}，当前已解决：${this.resolvedSnippets.size}`)
        return await this.waitForConflictResolution(conflictFileMapping, conflictCount)
      }

      // 默认返回失败
      return {
        success: false,
        message: '未选择冲突解决方案',
        conflictCount,
        conflictFiles: []
      }

    } catch (error) {
      console.error('处理手动冲突失败:', error)
      return {
        success: false,
        message: `冲突处理失败: ${error instanceof Error ? error.message : '未知错误'}`,
        conflictCount,
        conflictFiles: []
      }
    }
  }

  /**
   * 检查是否存在已解决的冲突文件
   * 读取用户手动编辑后的冲突文件内容
   */
  public async checkForResolvedConflicts(
    tempDir: string, 
    conflictFileMapping: Map<string, any>
  ): Promise<ConflictResolutionDetectionResult> {
    const resolvedFiles: Array<any> = []
    
    try {
      if (!fs.existsSync(tempDir)) {
        return { hasResolved: false, resolvedFiles: [] }
      }
      
      for (const [filePath, conflict] of conflictFileMapping.entries()) {
        if (fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath, 'utf8')
          
          // 检查文件是否已经被用户编辑（不包含冲突标记）
          const hasConflictMarkers = fileContent.includes('<<<<<<< LOCAL') || 
                                   fileContent.includes('=======') || 
                                   fileContent.includes('>>>>>>> REMOTE')
          
          if (!hasConflictMarkers) {
            // 用户已经解决了冲突，提取解决后的代码内容
            const resolvedResult = this.conflictDetector.extractResolvedContent(fileContent)
            
            if (resolvedResult.success && resolvedResult.content.length > 0) {
              resolvedFiles.push({
                filePath,
                resolvedContent: resolvedResult.content,
                originalConflict: conflict
              })
            }
          }
        }
      }
      
      return {
        hasResolved: resolvedFiles.length > 0,
        resolvedFiles
      }
    } catch (error) {
      console.warn('检查已解决冲突文件失败:', error)
      return { hasResolved: false, resolvedFiles: [] }
    }
  }

  /**
   * 设置冲突文件监听器
   * 当用户保存冲突文件时自动检查是否已解决冲突
   */
  public setupConflictFileWatcher(
    tempDir: string, 
    conflictFileMapping: Map<string, any>
  ): void {
    if (!this.context) {
      console.warn('无法设置文件监听器：context未初始化')
      return
    }

    try {
      // 监听文件关闭事件，而不是保存事件
      const closeDisposable = vscode.workspace.onDidCloseTextDocument(async (document) => {
        try {
          const filePath = document.uri.fsPath
          
          // 只处理冲突文件映射中的文件
          if (!conflictFileMapping.has(filePath)) {
            return
          }
          
          console.log(`📝 检测到冲突文件关闭: ${path.basename(filePath)}`)
          
          // 延迟一点时间，确保文件状态已稳定
          setTimeout(async () => {
            await this.handleConflictFileClose(filePath, conflictFileMapping, tempDir)
          }, 500)
        } catch (error) {
          console.error('处理冲突文件关闭失败:', error)
        }
      })
      
      // 同时监听文件系统变更，以防用户直接删除了文件
      const pattern = new vscode.RelativePattern(tempDir, '*.txt')
      const watcher = vscode.workspace.createFileSystemWatcher(pattern)
      
      // 处理文件删除事件
      const onFileDeleted = async (uri: vscode.Uri) => {
        try {
          if (conflictFileMapping.has(uri.fsPath)) {
            console.log(`🗑️ 检测到冲突文件被删除: ${path.basename(uri.fsPath)}`)
            // 文件被删除，视为用户放弃解决此冲突
            await this.handleConflictFileAbandoned(uri.fsPath, conflictFileMapping)
          }
        } catch (error) {
          console.error('处理冲突文件删除失败:', error)
        }
      }
      
      watcher.onDidDelete(onFileDeleted)
      
      // 确保在适当的时候清理监听器
      const disposable = vscode.Disposable.from(closeDisposable, watcher)
      this.context.subscriptions.push(disposable)
      
      // 设置清理定时器（60分钟后自动清理，给用户足够时间解决冲突）
      const cleanupTimer = setTimeout(() => {
        try {
          disposable.dispose()
          // 清理临时文件
          this.cleanupTempConflictFiles(tempDir)
          vscode.window.showWarningMessage(
            '冲突解决超时，临时文件已清理。请重新执行同步操作。',
            { modal: false }
          )
        } catch (error) {
          console.warn('清理文件监听器失败:', error)
        }
      }, 60 * 60 * 1000) // 60分钟
      
      // 存储定时器引用以便提前清理
      ;(disposable as any).cleanupTimer = cleanupTimer
      
    } catch (error) {
      console.error('设置冲突文件监听器失败:', error)
    }
  }

  /**
   * 处理冲突文件关闭事件
   * 检查用户是否已解决冲突，如果没有则重新打开文件
   */
  public async handleConflictFileClose(
    filePath: string, 
    conflictFileMapping: Map<string, any>,
    tempDir: string
  ): Promise<void> {
    try {
      // 防止重复处理同一个文件
      if (this.processingFiles.has(filePath)) {
        return
      }
      
      if (!fs.existsSync(filePath)) {
        return
      }
      
      // 标记文件正在处理
      this.processingFiles.add(filePath)
      
      const fileContent = fs.readFileSync(filePath, 'utf8')
      
      // 使用冲突检测器进行更robust的检测
      const resolvedResult = this.conflictDetector.extractResolvedContent(fileContent)
      
      if (resolvedResult.success) {
        // 用户已经解决了冲突
        const conflict = conflictFileMapping.get(filePath)
        if (!conflict) {
          return
        }
        
        if (resolvedResult.content.length > 0) {
          // 显示解决成功的通知
          vscode.window.showInformationMessage(
            `✅ 冲突已解决：${conflict.fullPath}\n\n正在自动应用解决方案...`,
            { modal: false }
          )
          
          // 更新状态栏
          vscode.window.setStatusBarMessage(
            `✅ 自动应用冲突解决方案：${path.basename(conflict.fullPath)}`,
            5000
          )
          
          // 应用解决方案到VSCode存储
          if (this.storageManager) {
            try {
              // 基于冲突中的本地代码片段创建解决后的版本，保持原有的标识符和关键属性
              const resolvedSnippet: CodeSnippet = {
                ...conflict.local, // 使用本地代码片段作为基础，保持ID等关键属性
                code: resolvedResult.content, // 使用用户解决后的代码内容
                createTime: Math.max(conflict.local.createTime || 0, conflict.remote.createTime || 0), // 使用较新的时间戳
                // 如果远程有更新的其他属性，选择性地合并
                ...(conflict.remote.modifyTime && (!conflict.local.modifyTime || conflict.remote.modifyTime > conflict.local.modifyTime) 
                  ? { modifyTime: conflict.remote.modifyTime } 
                  : {}),
              }
              
              // 存储解决后的代码片段
              this.resolvedSnippets.set(conflict.fullPath, resolvedSnippet)
              
              console.log(`💾 保存解决后的代码片段: ${resolvedSnippet.fullPath}`)
              console.log(`   - 本地路径: ${conflict.local.fullPath}`)
              console.log(`   - 远程路径: ${conflict.remote.fullPath}`)
              console.log(`   - 解决后路径: ${resolvedSnippet.fullPath}`)
              
              // 确保没有重复项：先检查是否存在同路径的其他代码片段
              try {
                const existingSnippets = await this.storageManager.getAllSnippets()
                const duplicates = existingSnippets.filter((s: CodeSnippet) => 
                  s.fullPath === resolvedSnippet.fullPath && 
                  (s.name !== resolvedSnippet.name || s.createTime !== resolvedSnippet.createTime)
                )
                
                if (duplicates.length > 0) {
                  console.warn(`⚠️ 发现潜在重复代码片段，将先删除: ${duplicates.length} 个`)
                  for (const duplicate of duplicates) {
                    console.log(`   删除重复项: name=${duplicate.name}, fullPath=${duplicate.fullPath}, createTime=${duplicate.createTime}`)
                    await this.storageManager.deleteSnippet(duplicate.fullPath)
                  }
                  // 清理缓存以确保删除生效
                  if (this.storageManager.clearCache) {
                    this.storageManager.clearCache()
                  }
                }
              } catch (checkError) {
                console.warn('检查重复代码片段时出错:', checkError)
              }
              
              await this.storageManager.saveSnippet(resolvedSnippet)
              
              // 清除缓存并刷新界面
              if (this.storageManager.clearCache) {
                this.storageManager.clearCache()
              }
              
              if (this.context) {
                await vscode.commands.executeCommand('starcode-snippets.refreshExplorer')
              }
              
              // 从映射中移除已解决的冲突
              conflictFileMapping.delete(filePath)
              
              // 从正在处理的文件集合中移除
              this.processingFiles.delete(filePath)
              
              // 删除已解决的冲突文件
              try {
                if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath)
                  console.log(`已删除冲突文件：${filePath}`)
                } else {
                  console.log(`冲突文件不存在，跳过删除：${filePath}`)
                }
              } catch (deleteError) {
                console.warn(`删除冲突文件失败：${filePath}`, deleteError)
              }
              
              // 检查是否还有其他冲突需要解决
              const remainingConflicts = Array.from(conflictFileMapping.keys()).filter(f => fs.existsSync(f))
              
              if (remainingConflicts.length > 0) {
                // 还有其他冲突，打开下一个
                setTimeout(async () => {
                  try {
                    const nextFile = remainingConflicts[0]
                    const document = await vscode.workspace.openTextDocument(nextFile)
                    await vscode.window.showTextDocument(document)
                    
                    vscode.window.showInformationMessage(
                      `📂 已自动打开下一个冲突文件 (${remainingConflicts.length} 个剩余)`,
                      { modal: false }
                    )
                    
                    vscode.window.setStatusBarMessage(
                      `📝 正在解决冲突 ${conflictFileMapping.size - remainingConflicts.length + 1}/${conflictFileMapping.size} - 关闭文件时检查解决状态`,
                      10000
                    )
                  } catch (error) {
                    console.error('打开下一个冲突文件失败:', error)
                  }
                }, 1000)
              } else {
                // 所有冲突都已解决
                console.log(`🎉 所有冲突都已解决！共解决 ${this.resolvedSnippets.size} 个冲突`)
                
                // 立即清理临时目录
                await this.cleanupTempConflictFiles(tempDir)
                
                // 显示简短的成功消息
                vscode.window.showInformationMessage(
                  `🎉 所有冲突都已解决！同步将自动继续...`,
                  { modal: false }
                )
                
                // 不再触发重新同步，因为当前同步流程会继续
              }
              
            } catch (saveError) {
              console.error('保存解决后的代码片段失败:', saveError)
              vscode.window.showErrorMessage(
                `保存解决方案失败：${saveError instanceof Error ? saveError.message : '未知错误'}`
              )
            }
          }
        }
      } else {
        // 冲突解决失败，重新打开文件让用户继续解决
        const conflict = conflictFileMapping.get(filePath)
        if (conflict && resolvedResult.errors.length > 0) {
          // 询问用户是否要继续解决冲突
          const choice = await vscode.window.showWarningMessage(
            `❌ 冲突解决不完整：${conflict.fullPath}\n\n发现以下问题：\n${resolvedResult.errors.map(err => `• ${err}`).join('\n')}\n\n请选择下一步操作：`,
            { modal: true },
            '继续编辑',
            '跳过此冲突',
            '取消所有冲突解决'
          )
          
          if (choice === '继续编辑') {
            // 重新打开文件继续编辑
            try {
              const document = await vscode.workspace.openTextDocument(filePath)
              await vscode.window.showTextDocument(document)
              
              vscode.window.showInformationMessage(
                `📝 已重新打开冲突文件，请完成冲突解决后关闭文件`,
                { modal: false }
              )
              
          vscode.window.setStatusBarMessage(
                `📝 请继续解决冲突：${path.basename(conflict.fullPath)} - 关闭文件时将检查解决状态`,
                15000
          )
            } catch (error) {
              console.error('重新打开冲突文件失败:', error)
              vscode.window.showErrorMessage(`无法重新打开文件：${error instanceof Error ? error.message : '未知错误'}`)
            }
          } else if (choice === '跳过此冲突') {
            // 跳过此冲突，使用本地版本
            await this.handleConflictFileAbandoned(filePath, conflictFileMapping, 'local')
          } else if (choice === '取消所有冲突解决') {
            // 取消所有冲突解决
            await this.handleConflictFileAbandoned(filePath, conflictFileMapping, 'cancel_all')
          }
          // 如果用户关闭了对话框（choice为undefined），则不做任何操作，等待用户下次打开文件
        }
      }
    } catch (error) {
      console.error('处理冲突文件关闭失败:', error)
    } finally {
      // 确保在任何情况下都从正在处理的文件集合中移除
      this.processingFiles.delete(filePath)
    }
  }

  /**
   * 处理冲突文件被放弃的情况
   * 用户删除文件或选择跳过冲突时调用
   */
  public async handleConflictFileAbandoned(
    filePath: string, 
    conflictFileMapping: Map<string, any>, 
    action: 'local' | 'remote' | 'cancel_all' = 'local'
  ): Promise<void> {
    try {
      const conflict = conflictFileMapping.get(filePath)
      if (!conflict) {
        return
      }

      console.log(`🚫 冲突文件被放弃: ${path.basename(filePath)}, 动作: ${action}`)

      if (action === 'cancel_all') {
        // 取消所有冲突解决，清理所有临时文件
        vscode.window.showWarningMessage(
          '❌ 用户取消了冲突解决过程。同步操作已中止。',
          { modal: false }
        )
        
        // 清理所有冲突映射和文件
        for (const [tempFilePath] of conflictFileMapping) {
          try {
            if (fs.existsSync(tempFilePath)) {
              fs.unlinkSync(tempFilePath)
            }
          } catch (error) {
            console.warn(`删除临时文件失败: ${tempFilePath}`, error)
          }
        }
        conflictFileMapping.clear()
        this.resolvedSnippets.clear()
        return
      }

      // 根据选择使用本地或远程版本，但保持本地代码片段的ID等关键属性
      let resolvedSnippet: CodeSnippet
      if (action === 'local') {
        resolvedSnippet = conflict.local
        vscode.window.showInformationMessage(
          `📁 已跳过冲突，使用本地版本：${conflict.fullPath}`,
          { modal: false }
        )
      } else {
        // 使用远程版本的内容，但保持本地代码片段的关键路径属性
        resolvedSnippet = {
          ...conflict.local, // 保持本地代码片段的关键属性
          ...conflict.remote, // 使用远程代码片段的内容和其他属性
          fullPath: conflict.local.fullPath // 明确保持本地路径作为唯一标识符
        }
        vscode.window.showInformationMessage(
          `☁️ 已跳过冲突，使用远程版本：${conflict.fullPath}`,
          { modal: false }
        )
      }

      // 存储解决后的代码片段
      this.resolvedSnippets.set(conflict.fullPath, resolvedSnippet)

      // 保存到存储管理器
      if (this.storageManager) {
        try {
          console.log(`💾 保存跳过冲突的代码片段: ${resolvedSnippet.fullPath} (${action})`)
          
          // 确保没有重复项
          try {
            const existingSnippets = await this.storageManager.getAllSnippets()
            const duplicates = existingSnippets.filter((s: CodeSnippet) => 
              s.fullPath === resolvedSnippet.fullPath && 
              (s.name !== resolvedSnippet.name || s.createTime !== resolvedSnippet.createTime)
            )
            
            if (duplicates.length > 0) {
              console.warn(`⚠️ 跳过冲突时发现重复代码片段，将先删除: ${duplicates.length} 个`)
              for (const duplicate of duplicates) {
                console.log(`   删除重复项: name=${duplicate.name}, fullPath=${duplicate.fullPath}`)
                await this.storageManager.deleteSnippet(duplicate.fullPath)
              }
              // 清理缓存
              if (this.storageManager.clearCache) {
                this.storageManager.clearCache()
              }
            }
          } catch (checkError) {
            console.warn('检查重复代码片段时出错:', checkError)
          }
          
          await this.storageManager.saveSnippet(resolvedSnippet)
          
          // 清除缓存并刷新界面
          if (this.storageManager.clearCache) {
            this.storageManager.clearCache()
          }
          
          if (this.context) {
            vscode.commands.executeCommand('starcode-snippets.refreshExplorer')
          }
        } catch (error) {
          console.error('保存跳过的冲突解决方案失败:', error)
        }
      }

      // 从映射中移除已处理的冲突
      conflictFileMapping.delete(filePath)

      // 删除临时文件
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
      } catch (error) {
        console.warn(`删除临时冲突文件失败: ${filePath}`, error)
      }

      // 更新状态栏
      vscode.window.setStatusBarMessage(
        `✅ 已跳过冲突：${path.basename(conflict.fullPath)}`,
        5000
      )

    } catch (error) {
      console.error('处理冲突文件放弃失败:', error)
    }
  }

  /**
   * 清理临时冲突文件
   */
  public async cleanupTempConflictFiles(tempDir: string): Promise<void> {
    try {
      if (fs.existsSync(tempDir)) {
        await this.deleteDirectory(tempDir)
        // console.log('已清理临时冲突文件目录')
      }
    } catch (error) {
      console.warn('清理临时冲突文件失败:', error)
    }
  }

  /**
   * 清理所有旧的临时冲突文件（在同步开始前调用）
   */
  public async cleanupOldConflictFiles(): Promise<void> {
    try {
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      const tempDir = path.join(effectiveLocalPath, '.merge-conflicts')
      
      if (fs.existsSync(tempDir)) {
        // 删除整个临时目录，确保没有残留的冲突文件
        await this.deleteDirectory(tempDir)
        // console.log('已清理旧的临时冲突文件')
      }
    } catch (error) {
      console.warn('清理旧临时冲突文件失败:', error)
    }
  }

  /**
   * 删除目录的辅助方法
   */
  private async deleteDirectory(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      return
    }

    const items = fs.readdirSync(dirPath)
    for (const item of items) {
      const itemPath = path.join(dirPath, item)
      const stat = fs.statSync(itemPath)
      
      if (stat.isDirectory()) {
        await this.deleteDirectory(itemPath)
      } else {
        fs.unlinkSync(itemPath)
      }
    }
    
    fs.rmdirSync(dirPath)
  }

  /**
   * 获取冲突解决的统计信息
   */
  public getConflictStats(
    snippetConflicts: SnippetConflict[],
    directoryConflicts: DirectoryConflict[]
  ): {
    total: number
    autoResolved: number
    manualRequired: number
    complexity: { simple: number; moderate: number; complex: number }
  } {
    const total = snippetConflicts.length + directoryConflicts.length
    let autoResolved = 0
    let manualRequired = 0
    const complexity = { simple: 0, moderate: 0, complex: 0 }

    for (const conflict of snippetConflicts) {
      if (conflict.needsManualMerge) {
        manualRequired++
        
        if (conflict.conflictData) {
          const analysis = this.conflictDetector.analyzeConflictComplexity(
            conflict.conflictData.localContent,
            conflict.conflictData.remoteContent
          )
          complexity[analysis.complexity]++
        }
      } else {
        autoResolved++
      }
    }

    for (const conflict of directoryConflicts) {
      if (conflict.needsManualMerge) {
        manualRequired++
      } else {
        autoResolved++
      }
    }

    return { total, autoResolved, manualRequired, complexity }
  }

  /**
   * 等待用户解决所有冲突
   * 通过轮询检查是否所有冲突都已解决
   */
  private async waitForConflictResolution(
    conflictFileMapping: Map<string, any>,
    totalConflictCount: number
  ): Promise<{
    success: boolean
    message: string
    conflictCount: number
    conflictFiles: string[]
    resolvedSnippets?: CodeSnippet[]
  }> {
    return new Promise((resolve) => {
      const checkResolution = () => {
        console.log(`轮询检查冲突解决状态：已解决 ${this.resolvedSnippets.size}/${totalConflictCount}`)
        
        // 检查是否所有冲突都已解决
        if (this.resolvedSnippets.size >= totalConflictCount) {
          console.log('检测到所有冲突都已解决，准备返回结果')
          // 所有冲突都已解决
          const resolvedSnippetsArray = Array.from(this.resolvedSnippets.values())
          
          resolve({
            success: true,
            message: `✅ 已成功解决 ${totalConflictCount} 个冲突`,
            conflictCount: totalConflictCount,
            conflictFiles: [],
            resolvedSnippets: resolvedSnippetsArray
          })
          return
        }
        
        // 检查是否还有冲突文件存在
        const remainingFiles = Array.from(conflictFileMapping.keys()).filter(f => fs.existsSync(f))
        if (remainingFiles.length === 0 && this.resolvedSnippets.size > 0) {
          // 文件都被删除了，但有一些解决结果
          const resolvedSnippetsArray = Array.from(this.resolvedSnippets.values())
          
          resolve({
            success: true,
            message: `✅ 已解决 ${this.resolvedSnippets.size} 个冲突`,
            conflictCount: totalConflictCount,
            conflictFiles: [],
            resolvedSnippets: resolvedSnippetsArray
          })
          return
        }
        
        // 继续等待
        setTimeout(checkResolution, 1000)
      }
      
      // 开始检查
      checkResolution()
      
      // 设置最大等待时间（10分钟）
      setTimeout(() => {
        resolve({
          success: false,
          message: `等待用户解决冲突超时。已解决 ${this.resolvedSnippets.size}/${totalConflictCount} 个冲突。`,
          conflictCount: totalConflictCount,
          conflictFiles: Array.from(conflictFileMapping.keys()).filter(f => fs.existsSync(f))
        })
      }, 10 * 60 * 1000) // 10分钟超时
    })
  }

  /**
   * 获取已解决的代码片段
   */
  public getResolvedSnippets(): CodeSnippet[] {
    return Array.from(this.resolvedSnippets.values())
  }

  /**
   * 清空已解决的代码片段缓存
   */
  public clearResolvedSnippets(): void {
    this.resolvedSnippets.clear()
  }
} 