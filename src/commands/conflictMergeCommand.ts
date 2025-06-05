import * as vscode from 'vscode'
import { SettingsManager } from '../utils/settingsManager'
import { simpleGit } from 'simple-git'
import * as fs from 'fs'
import * as path from 'path'
import { CodeSnippet, Directory } from '../types/types'

/**
 * Git冲突合并处理命令
 */
export function registerConflictMergeCommand(context: vscode.ExtensionContext, storageManager: any): vscode.Disposable {
  
  return vscode.commands.registerCommand('starcode-snippets.resolveConflicts', async () => {
    try {
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      
      if (!fs.existsSync(effectiveLocalPath) || !fs.existsSync(path.join(effectiveLocalPath, '.git'))) {
        vscode.window.showWarningMessage('未找到Git仓库')
        return
      }
      
      const git = simpleGit(effectiveLocalPath)
      
      // 检查是否有冲突
      const status = await git.status()
      
      if (!status.conflicted || status.conflicted.length === 0) {
        vscode.window.showInformationMessage('当前没有检测到Git冲突')
        return
      }
      
      const conflictedFiles = status.conflicted
      console.log('检测到冲突文件:', conflictedFiles)
      
      // 分析冲突文件类型
      const snippetConflicts = conflictedFiles.filter(file => file.endsWith('snippets.json'))
      const directoryConflicts = conflictedFiles.filter(file => file.endsWith('directories.json'))
      const otherConflicts = conflictedFiles.filter(file => 
        !file.endsWith('snippets.json') && !file.endsWith('directories.json')
      )
      
      const operations = []
      operations.push('=== Git冲突处理 ===')
      operations.push(`冲突文件总数: ${conflictedFiles.length}`)
      operations.push('')
      
      if (snippetConflicts.length > 0) {
        operations.push(`代码片段冲突: ${snippetConflicts.join(', ')}`)
      }
      if (directoryConflicts.length > 0) {
        operations.push(`目录结构冲突: ${directoryConflicts.join(', ')}`)
      }
      if (otherConflicts.length > 0) {
        operations.push(`其他文件冲突: ${otherConflicts.join(', ')}`)
      }
      operations.push('')
      
      // 提供解决方案选项
      const mergeOptions = [
        {
          label: '🔍 查看冲突详情',
          detail: '分析冲突内容，显示具体差异',
          action: 'analyze'
        },
        {
          label: '📝 手动解决',
          detail: '使用VSCode内置合并工具手动解决冲突',
          action: 'manual'
        },
        {
          label: '⬇️ 使用远程版本',
          detail: '放弃本地更改，使用远程仓库版本',
          action: 'use_remote'
        },
        {
          label: '⬆️ 使用本地版本',
          detail: '忽略远程更改，保留本地版本',
          action: 'use_local'
        },
        {
          label: '🔄 智能合并',
          detail: '尝试自动合并代码片段数据（推荐）',
          action: 'smart_merge'
        }
      ]
      
      const selected = await vscode.window.showQuickPick(mergeOptions, {
        placeHolder: `选择冲突解决方式（${conflictedFiles.length} 个冲突文件）`,
        ignoreFocusOut: true
      })
      
      if (!selected) {
        return
      }
      
      if (selected.action === 'analyze') {
        // 分析冲突详情
        operations.push('=== 冲突分析 ===')
        
        for (const file of conflictedFiles) {
          operations.push(`\n文件: ${file}`)
          
          try {
            const filePath = path.join(effectiveLocalPath, file)
            const content = fs.readFileSync(filePath, 'utf8')
            
            // 解析冲突标记
            const conflictMarkers = {
              start: '<<<<<<< HEAD',
              separator: '=======',
              end: '>>>>>>> '
            }
            
            const conflicts = parseConflictMarkers(content, conflictMarkers)
            operations.push(`冲突区域数量: ${conflicts.length}`)
            
            conflicts.forEach((conflict, index) => {
              operations.push(`\n冲突 ${index + 1}:`)
              operations.push('本地版本 (HEAD):')
              operations.push(conflict.local.substring(0, 200) + (conflict.local.length > 200 ? '...' : ''))
              operations.push('\n远程版本:')
              operations.push(conflict.remote.substring(0, 200) + (conflict.remote.length > 200 ? '...' : ''))
            })
            
          } catch (error) {
            operations.push(`读取文件失败: ${error instanceof Error ? error.message : '未知错误'}`)
          }
        }
        
      } else if (selected.action === 'manual') {
        // 手动解决
        operations.push('=== 手动解决指南 ===')
        operations.push('正在打开冲突文件...')
        
        // 依次打开每个冲突文件
        for (const file of conflictedFiles) {
          const filePath = path.join(effectiveLocalPath, file)
          try {
            const document = await vscode.workspace.openTextDocument(filePath)
            await vscode.window.showTextDocument(document)
            operations.push(`已打开: ${file}`)
          } catch (error) {
            operations.push(`打开文件失败 ${file}: ${error instanceof Error ? error.message : '未知错误'}`)
          }
        }
        
        operations.push('\n手动解决步骤:')
        operations.push('1. 在编辑器中查找冲突标记 (<<<<<<<, =======, >>>>>>>)')
        operations.push('2. 选择保留需要的内容，删除冲突标记')
        operations.push('3. 保存文件')
        operations.push('4. 重新执行同步命令')
        operations.push('')
        operations.push('提示: VSCode会高亮显示冲突区域，并提供快速操作按钮')
        
      } else if (selected.action === 'use_remote') {
        // 使用远程版本
        const confirm = await vscode.window.showWarningMessage(
          '⚠️ 这将丢失所有本地更改！是否确认使用远程版本？',
          { modal: true },
          '确认使用远程版本',
          '取消'
        )
        
        if (confirm === '确认使用远程版本') {
          operations.push('=== 使用远程版本 ===')
          
          try {
            // 对每个冲突文件执行 git checkout --theirs
            for (const file of conflictedFiles) {
              await git.raw(['checkout', '--theirs', file])
              operations.push(`✅ 已采用远程版本: ${file}`)
            }
            
            // 标记冲突已解决
            await git.add(conflictedFiles)
            operations.push('\n✅ 所有冲突已解决（使用远程版本）')
            operations.push('💡 现在可以提交更改并完成同步')
            
          } catch (error) {
            operations.push(`❌ 操作失败: ${error instanceof Error ? error.message : '未知错误'}`)
          }
        } else {
          operations.push('用户取消操作')
        }
        
      } else if (selected.action === 'use_local') {
        // 使用本地版本
        const confirm = await vscode.window.showWarningMessage(
          '⚠️ 这将忽略远程更改！是否确认使用本地版本？',
          { modal: true },
          '确认使用本地版本',
          '取消'
        )
        
        if (confirm === '确认使用本地版本') {
          operations.push('=== 使用本地版本 ===')
          
          try {
            // 对每个冲突文件执行 git checkout --ours
            for (const file of conflictedFiles) {
              await git.raw(['checkout', '--ours', file])
              operations.push(`✅ 已采用本地版本: ${file}`)
            }
            
            // 标记冲突已解决
            await git.add(conflictedFiles)
            operations.push('\n✅ 所有冲突已解决（使用本地版本）')
            operations.push('💡 现在可以提交更改并完成同步')
            
          } catch (error) {
            operations.push(`❌ 操作失败: ${error instanceof Error ? error.message : '未知错误'}`)
          }
        } else {
          operations.push('用户取消操作')
        }
        
      } else if (selected.action === 'smart_merge') {
        // 智能合并
        operations.push('=== 智能合并 ===')
        
        try {
          // 特别处理代码片段和目录文件
          let mergeSuccess = true
          
          for (const file of conflictedFiles) {
            operations.push(`\n处理文件: ${file}`)
            
            if (file.endsWith('snippets.json') || file.endsWith('directories.json')) {
              const mergeResult = await performSmartMerge(effectiveLocalPath, file, operations)
              if (!mergeResult) {
                mergeSuccess = false
              }
            } else {
              operations.push(`跳过非数据文件: ${file}（需要手动处理）`)
              mergeSuccess = false
            }
          }
          
          if (mergeSuccess) {
            // 标记所有已解决的文件
            const resolvedFiles = conflictedFiles.filter(file => 
              file.endsWith('snippets.json') || file.endsWith('directories.json')
            )
            
            if (resolvedFiles.length > 0) {
              await git.add(resolvedFiles)
              operations.push('\n✅ 智能合并完成')
              operations.push('💡 现在可以提交更改并完成同步')
            }
          } else {
            operations.push('\n⚠️ 部分文件需要手动处理')
            operations.push('建议使用"手动解决"选项处理剩余冲突')
          }
          
        } catch (error) {
          operations.push(`❌ 智能合并失败: ${error instanceof Error ? error.message : '未知错误'}`)
        }
      }
      
      // 显示操作结果
      const document = await vscode.workspace.openTextDocument({
        content: operations.join('\n'),
        language: 'plaintext'
      })
      
      await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: true
      })
      
    } catch (error) {
      console.error('冲突处理失败:', error)
      vscode.window.showErrorMessage(`冲突处理失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  })
}

/**
 * 解析Git冲突标记
 */
function parseConflictMarkers(content: string, markers: { start: string; separator: string; end: string }) {
  const conflicts = []
  const lines = content.split('\n')
  
  let inConflict = false
  let currentConflict: { local: string; remote: string } | null = null
  let localLines: string[] = []
  let remoteLines: string[] = []
  let inRemoteSection = false
  
  for (const line of lines) {
    if (line.startsWith(markers.start)) {
      inConflict = true
      currentConflict = { local: '', remote: '' }
      localLines = []
      remoteLines = []
      inRemoteSection = false
    } else if (line.startsWith(markers.separator) && inConflict) {
      inRemoteSection = true
    } else if (line.startsWith(markers.end) && inConflict) {
      if (currentConflict) {
        currentConflict.local = localLines.join('\n')
        currentConflict.remote = remoteLines.join('\n')
        conflicts.push(currentConflict)
      }
      inConflict = false
      currentConflict = null
    } else if (inConflict) {
      if (inRemoteSection) {
        remoteLines.push(line)
      } else {
        localLines.push(line)
      }
    }
  }
  
  return conflicts
}

/**
 * 对代码片段/目录JSON文件执行智能合并
 */
async function performSmartMerge(repoPath: string, fileName: string, operations: string[]): Promise<boolean> {
  try {
    const filePath = path.join(repoPath, fileName)
    const content = fs.readFileSync(filePath, 'utf8')
    
    const conflicts = parseConflictMarkers(content, {
      start: '<<<<<<< HEAD',
      separator: '=======',
      end: '>>>>>>> '
    })
    
    if (conflicts.length === 0) {
      operations.push(`  ✅ ${fileName}: 没有发现冲突标记`)
      return true
    }
    
    operations.push(`  🔍 分析 ${fileName} 中的 ${conflicts.length} 个冲突...`)
    
    // 尝试解析JSON并合并
    let mergedData: any = null
    
    for (let i = 0; i < conflicts.length; i++) {
      const conflict = conflicts[i]
      
      try {
        const localData = JSON.parse(conflict.local)
        const remoteData = JSON.parse(conflict.remote)
        
        if (fileName.endsWith('snippets.json')) {
          mergedData = mergeSnippetsData(localData, remoteData, operations, i + 1)
        } else if (fileName.endsWith('directories.json')) {
          mergedData = mergeDirectoriesData(localData, remoteData, operations, i + 1)
        }
        
      } catch (parseError) {
        operations.push(`  ❌ 冲突 ${i + 1}: JSON解析失败，需要手动处理`)
        return false
      }
    }
    
    if (mergedData !== null) {
      // 写入合并结果
      const mergedContent = JSON.stringify(mergedData, null, 2)
      fs.writeFileSync(filePath, mergedContent, 'utf8')
      operations.push(`  ✅ ${fileName}: 智能合并完成`)
      return true
    }
    
    return false
    
  } catch (error) {
    operations.push(`  ❌ ${fileName}: 处理失败 - ${error instanceof Error ? error.message : '未知错误'}`)
    return false
  }
}

/**
 * 合并代码片段数据
 */
function mergeSnippetsData(localSnippets: CodeSnippet[], remoteSnippets: CodeSnippet[], operations: string[], conflictIndex: number): CodeSnippet[] {
  operations.push(`    🔀 冲突 ${conflictIndex}: 合并代码片段数据...`)
  
  const merged = new Map<string, CodeSnippet>()
  
  // 添加本地片段
  localSnippets.forEach(snippet => {
    const key = (snippet as any).fullPath || snippet.id
    merged.set(key, { ...snippet })
  })
  
  // 合并远程片段
  let addedCount = 0
  let updatedCount = 0
  
  remoteSnippets.forEach(remoteSnippet => {
    const key = (remoteSnippet as any).fullPath || remoteSnippet.id
    const existingSnippet = merged.get(key)
    
    if (!existingSnippet) {
      merged.set(key, { ...remoteSnippet })
      addedCount++
    } else {
      // 比较更新时间，选择较新的版本
      const localTime = new Date((existingSnippet as any).updatedAt || 0).getTime()
      const remoteTime = new Date((remoteSnippet as any).updatedAt || 0).getTime()
      
      if (remoteTime > localTime) {
        merged.set(key, { ...remoteSnippet })
        updatedCount++
      }
    }
  })
  
  operations.push(`    ✅ 合并完成: 新增 ${addedCount} 个，更新 ${updatedCount} 个代码片段`)
  
  return Array.from(merged.values())
}

/**
 * 合并目录数据
 */
function mergeDirectoriesData(localDirs: Directory[], remoteDirs: Directory[], operations: string[], conflictIndex: number): Directory[] {
  operations.push(`    🔀 冲突 ${conflictIndex}: 合并目录数据...`)
  
  const merged = new Map<string, Directory>()
  
  // 添加本地目录
  localDirs.forEach(dir => {
    const key = (dir as any).fullPath || dir.id
    merged.set(key, { ...dir })
  })
  
  // 合并远程目录
  let addedCount = 0
  let updatedCount = 0
  
  remoteDirs.forEach(remoteDir => {
    const key = (remoteDir as any).fullPath || remoteDir.id
    const existingDir = merged.get(key)
    
    if (!existingDir) {
      merged.set(key, { ...remoteDir })
      addedCount++
    } else {
      // 目录通常以本地版本为准，除非远程有更新的元数据
      const localTime = new Date((existingDir as any).updatedAt || 0).getTime()
      const remoteTime = new Date((remoteDir as any).updatedAt || 0).getTime()
      
      if (remoteTime > localTime) {
        merged.set(key, { ...remoteDir })
        updatedCount++
      }
    }
  })
  
  operations.push(`    ✅ 合并完成: 新增 ${addedCount} 个，更新 ${updatedCount} 个目录`)
  
  return Array.from(merged.values())
} 