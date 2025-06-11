import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { SettingsManager } from './settingsManager'
import { PathUtils } from './pathUtils'

/**
 * 冲突解决监听器
 * 监听编辑器关闭事件，自动处理冲突解决后的操作
 */

// 跟踪当前打开的冲突文件
const openConflictFiles = new Set<string>()
let isProcessingConflictResolution = false
let conflictResolutionTimeout: NodeJS.Timeout | null = null
let gitRepoPath = ''

// 【新增】无限循环保护机制
let isListenerEnabled = true  // 监听器总开关
let lastProcessingTime = 0   // 上次处理时间
const PROCESSING_COOLDOWN = 5000  // 5秒冷却时间
let isStorageUpdating = false     // 存储更新标志
let processedConflictSessions = new Set<string>()  // 已处理的冲突会话

/**
 * 创建冲突解决监听器
 */
export function createConflictResolutionListener(
  context: vscode.ExtensionContext,
  storageManager: any,
  autoSyncManager: any
): vscode.Disposable {
  
  // 初始化Git仓库路径
  updateGitRepoPath()
  
  // 扫描当前已打开的文档，查找冲突文件
  setTimeout(() => {
    scanCurrentOpenDocuments()
  }, 500)
  
  // 监听编辑器打开事件，记录冲突文件
  const didOpenTextDocument = vscode.workspace.onDidOpenTextDocument(document => {
    if (!isListenerEnabled) {
      return
    }
    
    if (isInGitRepo(document.uri.fsPath) && hasConflictMarkersInDocument(document)) {
      const filePath = document.uri.fsPath
      console.log(`📝 检测到冲突文件打开: ${path.basename(filePath)}`)
      openConflictFiles.add(filePath)
    }
  })

  // 监听编辑器关闭事件
  const didCloseTextDocument = vscode.workspace.onDidCloseTextDocument(document => {
    if (!isListenerEnabled || isStorageUpdating) {
      return
    }
    
    const filePath = document.uri.fsPath
    
    // 基于文件路径判断是否在Git仓库内
    if (isInGitRepo(filePath)) {
      console.log(`📝 检测到文件关闭: ${path.basename(filePath)}`)
      
      // 如果这个文件之前被标记为冲突文件，移除它
      if (openConflictFiles.has(filePath)) {
        console.log(`📝 移除已关闭的冲突文件: ${path.basename(filePath)}`)
        openConflictFiles.delete(filePath)
      }
      
      // 检查冷却时间，防止频繁触发
      if (shouldSkipProcessing()) {
        console.log('⏳ 冲突解决处理冷却中，跳过检查...')
        return
      }
      
      // 延迟检查，给用户时间保存文件
      scheduleConflictResolutionCheck(storageManager, autoSyncManager)
    }
  })

  // 监听文档保存事件，可能表示冲突已解决
  const didSaveTextDocument = vscode.workspace.onDidSaveTextDocument(document => {
    if (!isListenerEnabled || isStorageUpdating) {
      return
    }
    
    const filePath = document.uri.fsPath
    
    if (isInGitRepo(filePath)) {
      console.log(`💾 检测到文件保存: ${path.basename(filePath)}`)
      
      // 检查保存后的文件是否还有冲突标记
      if (hasConflictMarkersInDocument(document)) {
        // 仍然有冲突标记，添加到跟踪列表
        openConflictFiles.add(filePath)
        console.log(`⚠️ 文件仍有冲突标记: ${path.basename(filePath)}`)
      } else {
        // 没有冲突标记了，从跟踪列表移除
        openConflictFiles.delete(filePath)
        console.log(`✅ 文件冲突已解决: ${path.basename(filePath)}`)
        
        // 【重要修复】主动解决Git冲突状态
        resolveGitConflictState(filePath)
      }
      
      // 对于冲突解决不使用冷却时间，立即检查
      if (openConflictFiles.size === 0) {
        console.log('🚀 所有跟踪的冲突文件都已解决，立即检查Git状态...')
        scheduleConflictResolutionCheck(storageManager, autoSyncManager, true) // 强制检查
      } else {
        // 仍有其他冲突文件，使用正常的延迟检查
        scheduleConflictResolutionCheck(storageManager, autoSyncManager, false)
      }
    }
  })

  return vscode.Disposable.from(
    didOpenTextDocument,
    didCloseTextDocument,
    didSaveTextDocument
  )
}

/**
 * 检查是否应该跳过处理（冷却时间保护）
 */
function shouldSkipProcessing(): boolean {
  const now = Date.now()
  return (now - lastProcessingTime) < PROCESSING_COOLDOWN
}

/**
 * 生成冲突会话ID（基于Git状态）
 */
async function generateConflictSessionId(): Promise<string> {
  try {
    if (!gitRepoPath) {
      return 'unknown'
    }
    
    const simpleGit = (await import('simple-git')).default
    const git = simpleGit(gitRepoPath)
    
    // 基于当前的MERGE_HEAD和时间戳生成唯一ID
    let mergeHead = 'no-merge'
    try {
      mergeHead = await git.raw(['rev-parse', '--short', 'MERGE_HEAD'])
      mergeHead = mergeHead.trim()
    } catch (error) {
      // MERGE_HEAD不存在
    }
    
    return `conflict_${mergeHead}_${Math.floor(Date.now() / 60000)}` // 按分钟分组
  } catch (error) {
    return `fallback_${Date.now()}`
  }
}

/**
 * 暂时禁用监听器（在存储更新期间）
 */
function disableListener(reason: string): void {
  console.log(`🚫 暂时禁用冲突解决监听器: ${reason}`)
  isListenerEnabled = false
  isStorageUpdating = true
}

/**
 * 重新启用监听器
 */
function enableListener(reason: string): void {
  console.log(`✅ 重新启用冲突解决监听器: ${reason}`)
  isListenerEnabled = true
  isStorageUpdating = false
}

/**
 * 更新Git仓库路径
 */
function updateGitRepoPath(): void {
  try {
    const activeConfig = SettingsManager.getActivePlatformConfig()
    if (activeConfig) {
      gitRepoPath = PathUtils.resolveDefaultPathToken(
        activeConfig.localPath || '', 
        activeConfig.provider, 
        SettingsManager.getExtensionContext() || undefined
      )
      console.log(`🔧 Git仓库路径更新为: ${gitRepoPath}`)
    }
  } catch (error) {
    console.warn('更新Git仓库路径失败:', error)
    gitRepoPath = ''
  }
}

/**
 * 检查文件是否在Git仓库目录内
 */
function isInGitRepo(filePath: string): boolean {
  if (!gitRepoPath) {
    updateGitRepoPath()
  }
  
  if (!gitRepoPath) {
    return false
  }
  
  try {
    const normalizedFilePath = path.normalize(filePath)
    const normalizedGitPath = path.normalize(gitRepoPath)
    return normalizedFilePath.startsWith(normalizedGitPath)
  } catch (error) {
    console.warn('检查文件路径失败:', error)
    return false
  }
}

/**
 * 检查文档内容是否包含Git冲突标记
 */
function hasConflictMarkersInDocument(document: vscode.TextDocument): boolean {
  try {
    const content = document.getText()
    return content.includes('<<<<<<<') || 
           content.includes('=======') || 
           content.includes('>>>>>>>')
  } catch (error) {
    console.warn('检查文档冲突标记失败:', error)
    return false
  }
}

/**
 * 检查文件内容是否包含Git冲突标记（基于文件路径）
 */
function hasConflictMarkersInFile(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) {
      return false
    }
    
    const content = fs.readFileSync(filePath, 'utf8')
    return content.includes('<<<<<<<') || 
           content.includes('=======') || 
           content.includes('>>>>>>>')
  } catch (error) {
    console.warn('检查文件冲突标记失败:', error)
    return false
  }
}

/**
 * 安排冲突解决检查
 */
function scheduleConflictResolutionCheck(storageManager: any, autoSyncManager: any, force: boolean = false): void {
  if (conflictResolutionTimeout) {
    clearTimeout(conflictResolutionTimeout)
  }
  
  conflictResolutionTimeout = setTimeout(async () => {
    await checkAndCompleteConflictResolution(storageManager, autoSyncManager, force)
  }, force ? 0 : 1000) // 0秒延迟（强制检查）或1秒延迟（正常检查）
}

/**
 * 主动解决Git冲突状态
 */
async function resolveGitConflictState(filePath: string): Promise<void> {
  try {
    console.log(`🔄 主动解决Git冲突状态: ${path.basename(filePath)}`)
    
    if (!gitRepoPath) {
      updateGitRepoPath()
      if (!gitRepoPath) {
        console.warn('Git仓库路径未配置，无法解决冲突状态')
        return
      }
    }
    
    const simpleGit = (await import('simple-git')).default
    const git = simpleGit(gitRepoPath)
    
    // 检查文件是否在Git仓库中
    const relativePath = path.relative(gitRepoPath, filePath)
    if (relativePath.startsWith('..')) {
      console.warn(`文件不在Git仓库内: ${filePath}`)
      return
    }
    
    // 执行 git add 标记冲突已解决
    await git.add(relativePath)
    console.log(`✅ 已标记冲突文件为已解决: ${relativePath}`)
    
  } catch (error) {
    console.error('解决Git冲突状态失败:', error)
  }
}

/**
 * 检查并完成冲突解决
 */
async function checkAndCompleteConflictResolution(
  storageManager: any,
  autoSyncManager: any,
  force: boolean = false
): Promise<void> {
  if (isProcessingConflictResolution) {
    console.log('🔄 冲突解决正在处理中，跳过重复检查...')
    return
  }

  // 强制检查时跳过冷却时间检查
  if (!force && shouldSkipProcessing()) {
    console.log('⏳ 冲突解决处理冷却中，跳过检查...')
    return
  }

  try {
    isProcessingConflictResolution = true
    lastProcessingTime = Date.now()  // 更新最后处理时间
    
    const activeConfig = SettingsManager.getActivePlatformConfig()
    if (!activeConfig) {
      console.log('⚠️ 未找到激活的同步配置，跳过冲突解决检查')
      return
    }

    // 解析实际的Git仓库路径
    const gitRepoPath = PathUtils.resolveDefaultPathToken(
      activeConfig.localPath || '', 
      activeConfig.provider, 
      SettingsManager.getExtensionContext() || undefined
    )

    const simpleGit = (await import('simple-git')).default
    const git = simpleGit(gitRepoPath)
    
    // 生成冲突会话ID并检查是否已处理过
    const sessionId = await generateConflictSessionId()
    if (!force && processedConflictSessions.has(sessionId)) {
      console.log(`🔄 冲突会话 ${sessionId} 已处理过，跳过重复处理`)
      return
    }
    
    // 检查Git状态
    const status = await git.status()
    
    console.log('🔍 检查Git冲突状态...')
    console.log(`   冲突会话ID: ${sessionId}`)
    console.log(`   强制检查: ${force}`)
    console.log(`   冲突文件数量: ${status.conflicted.length}`)
    console.log(`   未暂存文件数量: ${status.files.length}`)
    console.log(`   已暂存文件数量: ${status.staged.length}`)
    console.log(`   当前跟踪的打开冲突文件: ${openConflictFiles.size}`)
    
    // 打印当前跟踪的文件
    if (openConflictFiles.size > 0) {
      const trackedFiles = Array.from(openConflictFiles).map(f => path.basename(f)).join(', ')
      console.log(`   跟踪的文件: ${trackedFiles}`)
    }

    // 如果还有冲突文件，不执行任何操作
    if (status.conflicted.length > 0) {
      console.log(`⚠️ 仍有 ${status.conflicted.length} 个冲突文件未解决，等待用户继续处理...`)
      const conflictFileNames = status.conflicted.map((f: any) => f.path || f).join(', ')
      console.log(`   未解决的冲突文件: ${conflictFileNames}`)
      return
    }

    // 检查是否有MERGE_HEAD（表示正在进行合并）
    let hasMergeHead = false
    try {
      await git.raw(['rev-parse', '--verify', 'MERGE_HEAD'])
      hasMergeHead = true
    } catch (error) {
      hasMergeHead = false
    }

    console.log(`🔍 Git合并状态检查: hasMergeHead=${hasMergeHead}`)

    // 如果没有合并状态，说明不需要处理
    if (!hasMergeHead) {
      console.log('✅ 没有检测到正在进行的合并，无需处理')
      return
    }

    // 额外检查：验证是否还有任何文件包含冲突标记
    const hasOpenConflictFiles = await verifyNoConflictMarkersInRepo(gitRepoPath)
    
    if (hasOpenConflictFiles) {
      console.log('⚠️ 检测到仓库中仍有文件包含冲突标记，等待用户解决...')
      return
    }

    // 检查VSCode中是否还有打开的冲突文件
    const currentOpenConflicts = await scanForCurrentConflictFiles()
    if (currentOpenConflicts.length > 0) {
      console.log(`⚠️ VSCode中仍有 ${currentOpenConflicts.length} 个打开的冲突文件，等待关闭...`)
      const fileNames = currentOpenConflicts.map(f => path.basename(f)).join(', ')
      console.log(`   打开的冲突文件: ${fileNames}`)
      return
    }

    console.log('🎉 所有冲突已解决！开始自动完成合并...')
    
    // 标记此会话已处理
    processedConflictSessions.add(sessionId)

    // 检查是否有文件需要暂存
    if (status.files.length > 0) {
      console.log('📝 暂存所有已解决的冲突文件...')
      await git.add('.')
    }

    // 完成合并提交
    const commitMessage = `解决合并冲突: ${new Date().toLocaleString()}`
    console.log(`💾 创建合并提交: ${commitMessage}`)
    await git.commit(commitMessage)

    // 显示成功消息
    vscode.window.showInformationMessage(
      '🎉 冲突解决完成！合并已自动提交，正在继续同步...',
      { modal: false }
    )

    // 延迟一点时间，然后继续同步流程
    setTimeout(async () => {
      try {
        console.log('🔄 冲突解决完成，继续同步流程...')
        
        // 【关键】禁用监听器，防止存储更新触发循环
        disableListener('开始存储更新操作')
        
        // 推送合并结果到远程
        console.log('📤 推送合并结果到远程...')
        try {
          await git.push()
          console.log('✅ 合并结果已推送到远程')
        } catch (pushError: any) {
          // 如果推送失败，检查是否是因为没有上游分支
          if (pushError.message && pushError.message.includes('no upstream branch')) {
            console.log('🔧 检测到没有上游分支，设置上游分支并推送...')
            try {
              // 获取当前分支名
              const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD'])
              const branchName = currentBranch.trim()
              console.log(`   当前分支: ${branchName}`)
              
              // 设置上游分支并推送
              await git.push(['--set-upstream', 'origin', branchName])
              console.log('✅ 已设置上游分支并推送成功')
            } catch (upstreamError) {
              console.error('设置上游分支推送失败:', upstreamError)
              throw new Error(`推送失败: ${upstreamError instanceof Error ? upstreamError.message : '未知错误'}`)
            }
          } else {
            // 其他推送错误
            console.error('推送失败:', pushError)
            throw pushError
          }
        }

        // 读取合并后的数据并更新VSCode存储
        const { DataSyncManager } = require('./sync/dataSyncManager')
        const dataSyncManager = new DataSyncManager(
          SettingsManager.getExtensionContext(),
          storageManager
        )

        // 从Git仓库读取合并后的数据
        const mergedData = await dataSyncManager.readDataFromGitRepo()
        
        console.log('🔄 更新VSCode存储为合并后的数据...')
        console.log(`   合并后数据: ${mergedData.snippets.length} 个代码片段, ${mergedData.directories.length} 个目录`)

        // 执行安全的存储更新
        // 使用私有方法的反射调用或直接通过存储管理器更新
        let updateResult = { success: false, error: '更新方法未找到' }
        
        try {
          // 【修复】更安全的数据更新方式：检查并避免重复
          console.log('🔄 开始安全的数据更新...')
          const existingSnippets = await storageManager.getAllSnippets()
          const existingDirectories = await storageManager.getAllDirectories()
          
          console.log(`📊 现有数据: ${existingSnippets.length} 个代码片段, ${existingDirectories.length} 个目录`)
          console.log(`📊 合并数据: ${mergedData.snippets.length} 个代码片段, ${mergedData.directories.length} 个目录`)
          
          // 【优化】先分析需要的操作，避免不必要的删除重建
          const needsUpdate = 
            existingSnippets.length !== mergedData.snippets.length ||
            existingDirectories.length !== mergedData.directories.length ||
            !existingSnippets.every((existing: any) => 
              mergedData.snippets.some((merged: any) => 
                merged.fullPath === existing.fullPath && 
                merged.name === existing.name &&
                merged.code === existing.code &&
                merged.language === existing.language
              )
            ) ||
            !existingDirectories.every((existing: any) =>
              mergedData.directories.some((merged: any) => 
                merged.fullPath === existing.fullPath && 
                merged.name === existing.name
              )
            )
          
          if (!needsUpdate) {
            console.log('✅ 数据已一致，无需更新')
            updateResult = { success: true, error: '' }
          } else {
            console.log('🔄 检测到数据差异，执行更新...')
            
            // 【修复】使用更精确的更新策略
            // 1. 先处理目录（目录变更）
            const existingDirPaths = new Set(existingDirectories.map((d: any) => d.fullPath))
            const targetDirPaths = new Set(mergedData.directories.map((d: any) => d.fullPath))
            
            // 删除不再存在的目录
            for (const existingDir of existingDirectories) {
              if (!targetDirPaths.has(existingDir.fullPath)) {
                console.log(`🗑️ 删除目录: ${existingDir.fullPath}`)
                await storageManager.deleteDirectory(existingDir.fullPath)
              }
            }
            
            // 添加新目录
            for (const mergedDir of mergedData.directories) {
              if (!existingDirPaths.has(mergedDir.fullPath)) {
                console.log(`📁 创建目录: ${mergedDir.fullPath}`)
                await storageManager.createDirectory(mergedDir.name, mergedDir.fullPath)
              }
            }
            
            // 2. 处理代码片段（更精确的更新）
            const existingSnippetPaths = new Set(existingSnippets.map((s: any) => s.fullPath))
            const targetSnippetPaths = new Set(mergedData.snippets.map((s: any) => s.fullPath))
            
            // 删除不再存在的代码片段
            for (const existingSnippet of existingSnippets) {
              if (!targetSnippetPaths.has(existingSnippet.fullPath)) {
                console.log(`🗑️ 删除代码片段: ${existingSnippet.fullPath}`)
                await storageManager.deleteSnippet(existingSnippet.fullPath)
              }
            }
            
            // 添加或更新代码片段
            for (const mergedSnippet of mergedData.snippets) {
              const existingSnippet = existingSnippets.find((s: any) => s.fullPath === mergedSnippet.fullPath)
              
              if (!existingSnippet) {
                // 新增代码片段
                console.log(`➕ 添加代码片段: ${mergedSnippet.fullPath}`)
                await storageManager.saveSnippet(mergedSnippet)
              } else {
                // 检查是否需要更新
                const needsSnippetUpdate = 
                  existingSnippet.name !== mergedSnippet.name ||
                  existingSnippet.code !== mergedSnippet.code ||
                  existingSnippet.language !== mergedSnippet.language
                
                if (needsSnippetUpdate) {
                  console.log(`🔄 更新代码片段: ${mergedSnippet.fullPath}`)
                  // 先删除再添加，确保完全更新
                  await storageManager.deleteSnippet(existingSnippet.fullPath)
                  await storageManager.saveSnippet(mergedSnippet)
                } else {
                  console.log(`✅ 代码片段无变化: ${mergedSnippet.fullPath}`)
                }
              }
            }
            
            // 3. 清理缓存并验证更新结果
            if (storageManager.clearCache) {
              storageManager.clearCache()
            }
            
            // 验证更新结果
            const updatedSnippets = await storageManager.getAllSnippets()
            const updatedDirectories = await storageManager.getAllDirectories()
            
            console.log(`📊 更新后数据: ${updatedSnippets.length} 个代码片段, ${updatedDirectories.length} 个目录`)
            
            if (updatedSnippets.length === mergedData.snippets.length && 
                updatedDirectories.length === mergedData.directories.length) {
              updateResult = { success: true, error: '' }
              console.log('✅ 数据更新验证通过')
            } else {
              updateResult = { 
                success: false, 
                error: `数据数量不匹配: 期望 ${mergedData.snippets.length}/${mergedData.directories.length}，实际 ${updatedSnippets.length}/${updatedDirectories.length}` 
              }
              console.warn('⚠️ 数据更新验证失败:', updateResult.error)
            }
          }
        } catch (updateError) {
          console.error('数据更新失败:', updateError)
          updateResult = { 
            success: false, 
            error: updateError instanceof Error ? updateError.message : '未知错误' 
          }
        }

        if (updateResult?.success) {
          console.log('✅ VSCode存储已更新为合并后的数据')
          vscode.window.showInformationMessage(
            '✅ 同步完成！冲突已解决，数据已合并更新',
            { modal: false }
          )
          
          // 【修复】更新同步状态管理器 - 清除错误状态并标记为同步成功
          try {
            const { DetailedSyncStatusManager } = await import('./detailedSyncStatusManager')
            const statusManager = DetailedSyncStatusManager.getInstance()
            await statusManager.completeSync(true, '冲突已解决，同步完成')
            console.log('✅ 同步状态已更新为成功')
          } catch (statusError) {
            console.warn('更新同步状态失败:', statusError)
          }
          
          // 刷新视图
          await vscode.commands.executeCommand('starcode-snippets.refreshExplorer')
        } else {
          console.warn('⚠️ VSCode存储更新失败:', updateResult?.error)
          vscode.window.showWarningMessage(
            '⚠️ 合并完成但VSCode数据更新失败，请手动刷新',
            { modal: false }
          )
          
          // 【修复】设置错误状态到同步状态管理器
          try {
            const { DetailedSyncStatusManager } = await import('./detailedSyncStatusManager')
            const statusManager = DetailedSyncStatusManager.getInstance()
            await statusManager.setError(updateResult?.error || '数据更新失败')
            console.log('✅ 同步状态已更新为错误状态')
          } catch (statusError) {
            console.warn('更新同步状态失败:', statusError)
          }
        }

      } catch (continueError) {
        console.error('继续同步流程失败:', continueError)
        vscode.window.showErrorMessage(
          `继续同步失败: ${continueError instanceof Error ? continueError.message : '未知错误'}`,
          { modal: false }
        )
        
        // 【修复】设置错误状态到同步状态管理器
        try {
          const { DetailedSyncStatusManager } = await import('./detailedSyncStatusManager')
          const statusManager = DetailedSyncStatusManager.getInstance()
          await statusManager.setError(continueError instanceof Error ? continueError.message : '继续同步失败')
          console.log('✅ 同步状态已更新为错误状态')
        } catch (statusError) {
          console.warn('更新同步状态失败:', statusError)
        }
      } finally {
        // 【关键】重新启用监听器
        setTimeout(() => {
          enableListener('存储更新操作完成')
          // 清理旧的会话记录（保留最近的10个）
          if (processedConflictSessions.size > 10) {
            const sessionsArray = Array.from(processedConflictSessions)
            const toKeep = sessionsArray.slice(-10)
            processedConflictSessions.clear()
            toKeep.forEach(session => processedConflictSessions.add(session))
          }
        }, 2000) // 2秒后重新启用，确保所有存储操作都完成
      }
    }, 1000) // 延迟1秒

  } catch (error) {
    console.error('冲突解决检查失败:', error)
    vscode.window.showErrorMessage(
      `冲突解决检查失败: ${error instanceof Error ? error.message : '未知错误'}`,
      { modal: false }
    )
    
    // 【修复】设置错误状态到同步状态管理器
    try {
      const { DetailedSyncStatusManager } = await import('./detailedSyncStatusManager')
      const statusManager = DetailedSyncStatusManager.getInstance()
      await statusManager.setError(error instanceof Error ? error.message : '冲突解决检查失败')
      console.log('✅ 同步状态已更新为错误状态')
    } catch (statusError) {
      console.warn('更新同步状态失败:', statusError)
    }
  } finally {
    isProcessingConflictResolution = false
  }
}

/**
 * 验证仓库中是否还有包含冲突标记的文件
 */
async function verifyNoConflictMarkersInRepo(gitRepoPath: string): Promise<boolean> {
  try {
    const simpleGit = (await import('simple-git')).default
    const git = simpleGit(gitRepoPath)
    
    // 获取所有跟踪的文件
    const files = await git.raw(['ls-files'])
    const fileList = files.trim().split('\n').filter(f => f.length > 0)
    
    for (const relativePath of fileList) {
      const fullPath = path.join(gitRepoPath, relativePath)
      
      // 跳过目录和不存在的文件
      if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
        continue
      }
      
      if (hasConflictMarkersInFile(fullPath)) {
        console.log(`⚠️ 发现包含冲突标记的文件: ${relativePath}`)
        return true
      }
    }
    
    return false
  } catch (error) {
    console.warn('验证冲突标记失败:', error)
    return false
  }
}

/**
 * 扫描当前打开的冲突文件
 */
async function scanForCurrentConflictFiles(): Promise<string[]> {
  const conflictFiles: string[] = []
  
  try {
    // 检查所有已打开的文档
    const allOpenDocuments = vscode.workspace.textDocuments
    
    for (const document of allOpenDocuments) {
      const filePath = document.uri.fsPath
      
      if (isInGitRepo(filePath) && hasConflictMarkersInDocument(document)) {
        conflictFiles.push(filePath)
      }
    }
    
  } catch (error) {
    console.warn('扫描当前冲突文件失败:', error)
  }
  
  return conflictFiles
}

/**
 * 扫描当前已打开的文档，查找冲突文件
 */
function scanCurrentOpenDocuments(): void {
  try {
    console.log('🔍 扫描当前已打开的文档...')
    
    // 检查所有已打开的文本编辑器
    const openEditors = vscode.window.visibleTextEditors
    for (const editor of openEditors) {
      const document = editor.document
      const filePath = document.uri.fsPath
      
      if (isInGitRepo(filePath) && hasConflictMarkersInDocument(document)) {
        console.log(`📝 发现已打开的冲突文件: ${path.basename(filePath)}`)
        openConflictFiles.add(filePath)
      }
    }
    
    // 还需要检查所有已打开但不可见的文档
    const allOpenDocuments = vscode.workspace.textDocuments
    for (const document of allOpenDocuments) {
      const filePath = document.uri.fsPath
      
      if (isInGitRepo(filePath) && hasConflictMarkersInDocument(document)) {
        if (!openConflictFiles.has(filePath)) {
          console.log(`📝 发现已打开的冲突文件（后台）: ${path.basename(filePath)}`)
          openConflictFiles.add(filePath)
        }
      }
    }
    
    if (openConflictFiles.size > 0) {
      console.log(`📝 当前跟踪 ${openConflictFiles.size} 个冲突文件`)
    } else {
      console.log('✅ 当前没有发现冲突文件')
    }
    
  } catch (error) {
    console.warn('扫描已打开文档失败:', error)
  }
}