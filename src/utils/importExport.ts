import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import {
  CodeSnippet,
  Directory,
  CodeSnippetV1,
  DirectoryV1,
  CodeSnippetV2,
  DirectoryV2,
  ExportDataV1,
  ExportDataV2,
  ExportData,
} from '../types/types'
import { StorageManager } from '../storage/storageManager'
import { v4 as uuidv4 } from 'uuid'
import { PathBasedManager } from './pathBasedManager'
import { StorageContext } from './storageContext'

export class ImportExportManager {
  private storageContext?: StorageContext

  constructor(private storageManager: StorageManager, storageContext?: StorageContext) {
    this.storageContext = storageContext
  }

  /**
   * 导出单个代码片段（仅支持V2格式）
   */
  async exportSnippet(snippet: CodeSnippet): Promise<void> {
    try {
      // 始终使用V2格式导出
      let exportData: ExportDataV2

      if (this.isUsingV2()) {
        // 已经是V2格式，直接导出
        const snippetV2 = snippet as CodeSnippetV2
        const paths = [snippetV2.fullPath]
        const directoriesV2 = PathBasedManager.extractDirectoriesFromPaths(paths)

        exportData = {
          version: '2.0.0',
          exportDate: new Date().toISOString(),
          directories: directoriesV2,
          snippets: [snippetV2],
        }
      } else {
        // 将V1格式转换为V2
        const snippetV1 = snippet as unknown as CodeSnippetV1
        const directories = (await this.storageManager.getAllDirectories()) as unknown as DirectoryV1[]

        // 转换成V2格式
        const result = PathBasedManager.convertToV2([snippetV1], directories)

        exportData = {
          version: '2.0.0',
          exportDate: new Date().toISOString(),
          directories: result.directories,
          snippets: result.snippets,
        }
      }

      await this.saveExportFile(exportData, `${snippet.name}.json`)
      vscode.window.showInformationMessage(`代码片段 "${snippet.name}" 导出成功！`)
    } catch (error) {
      console.error('导出代码片段失败:', error)
      vscode.window.showErrorMessage(`导出代码片段失败: ${error}`)
    }
  }

  /**
   * 导出所有代码片段（仅支持V2格式）
   */
  async exportAllSnippets(): Promise<void> {
    try {
      // 始终使用V2格式导出
      const [directories, snippets] = await Promise.all([
        this.storageManager.getAllDirectories(),
        this.storageManager.getAllSnippets(),
      ])

      let exportData: ExportDataV2

      if (this.isUsingV2()) {
        // 已经是V2格式，直接导出
        exportData = {
          version: '2.0.0',
          exportDate: new Date().toISOString(),
          directories: directories as CodeSnippetV2[],
          snippets: snippets as CodeSnippetV2[],
        }
      } else {
        // 将V1格式转换为V2
        const result = PathBasedManager.convertToV2(
          snippets as unknown as CodeSnippetV1[], 
          directories as unknown as DirectoryV1[]
        )

        exportData = {
          version: '2.0.0',
          exportDate: new Date().toISOString(),
          directories: result.directories,
          snippets: result.snippets,
        }
      }

      await this.saveExportFile(exportData)
    } catch (error) {
      vscode.window.showErrorMessage(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 导入代码片段（支持V1和V2格式）
   */
  async importSnippets(): Promise<void> {
    try {
      // 选择要导入的文件
      const fileUri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
          'JSON Files': ['json'],
        },
        openLabel: '选择要导入的代码片段文件',
      })

      if (!fileUri || fileUri.length === 0) {
        return // 用户取消了选择
      }

      const filePath = fileUri[0].fsPath
      const fileContent = fs.readFileSync(filePath, 'utf8')
      let importData: ExportData = JSON.parse(fileContent)

      // 验证导入数据格式
      const validation = PathBasedManager.validateExportData(importData)
      if (!validation.isValid) {
        vscode.window.showErrorMessage(`导入文件格式不正确！${validation.error || ''}`)
        return
      }

      // 检查是否需要转换格式
      const isV2 = this.isUsingV2()
      const isV2Data = importData.version === '2.0.0'

      // 如果数据格式与当前使用的格式不匹配，需要转换
      if (isV2 && !isV2Data) {
        // 将V1数据转换为V2
        importData = PathBasedManager.convertExportDataV1ToV2(importData as ExportDataV1)
        vscode.window.showInformationMessage('已将导入数据从V1转换为V2格式')
      } else if (!isV2 && isV2Data) {
        // 将V2数据转换为V1
        importData = PathBasedManager.convertExportDataV2ToV1(importData as ExportDataV2)
        vscode.window.showInformationMessage('已将导入数据从V2转换为V1格式')
      }

      // 执行导入
      const result = await this.performImport(importData)

      const message = `导入完成！新增 ${result.added} 个代码片段，更新 ${result.updated} 个代码片段，创建 ${result.directoriesCreated} 个目录。`
      vscode.window.showInformationMessage(message)
    } catch (error) {
      console.error('导入代码片段失败:', error)
      vscode.window.showErrorMessage(`导入代码片段失败: ${error}`)
    }
  }

  /**
   * 获取代码片段的目录路径
   */
  private getSnippetDirectoryPath(snippet: CodeSnippetV1, allDirectories: DirectoryV1[]): DirectoryV1[] {
    const result: DirectoryV1[] = []
    let currentParentId = snippet.parentId

    while (currentParentId) {
      const directory = allDirectories.find(d => d.id === currentParentId)
      if (directory) {
        result.unshift(directory)
        currentParentId = directory.parentId
      } else {
        break
      }
    }

    return result
  }

  private async saveExportFile(data: ExportDataV2, defaultFileName?: string): Promise<void> {
    const fileName = defaultFileName || `starcode_snippets_${new Date().toISOString().slice(0, 10)}.json`
    
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(fileName),
      filters: {
        'JSON Files': ['json']
      }
    })

    if (saveUri) {
      fs.writeFileSync(saveUri.fsPath, JSON.stringify(data, null, 2))
      vscode.window.showInformationMessage(`导出成功：${saveUri.fsPath}`)
    }
  }

  private isUsingV2(): boolean {
    // 检查当前存储管理器是否使用V2格式
    // 可以通过检查配置或者数据格式来判断
    const config = vscode.workspace.getConfiguration('starcode-snippets')
    return config.get('storageVersion', 'v2') === 'v2'
  }

  private async performImport(
    importData: ExportData
  ): Promise<{ added: number; updated: number; directoriesCreated: number }> {
    if (importData.version === '1.0.0') {
      return this.performImportV1(importData as ExportDataV1)
    } else {
      return this.performImportV2(importData as ExportDataV2)
    }
  }

  private async performImportV1(
    importData: ExportDataV1
  ): Promise<{ added: number; updated: number; directoriesCreated: number }> {
    let added = 0
    let updated = 0
    let directoriesCreated = 0

    try {
      // 获取现有数据
      const [existingDirectories, existingSnippets] = await Promise.all([
        this.storageManager.getAllDirectories() as Promise<any[]>,
        this.storageManager.getAllSnippets() as Promise<any[]>,
      ])

      // 导入目录
      const directoryIdMap = new Map<string, string>()

      for (const importDir of importData.directories) {
        // 检查是否已存在同名目录
        const existingDir = existingDirectories.find(d => d.name === importDir.name)
        
        if (!existingDir) {
          // 创建新目录
          const newDirectory = {
            id: uuidv4(),
            name: importDir.name,
            parentId: this.getParentIdFromMap(importDir.parentId, directoryIdMap),
            order: importDir.order,
          }
          
          await this.storageManager.createDirectory(newDirectory as any)
          directoryIdMap.set(importDir.id, newDirectory.id)
          directoriesCreated++
        } else {
          // 使用现有目录
          directoryIdMap.set(importDir.id, existingDir.id)
        }
      }

      // 导入代码片段
      for (const importSnippet of importData.snippets) {
        // 检查是否已存在同名代码片段
        const existingSnippet = existingSnippets.find(s => s.name === importSnippet.name)
        
        if (!existingSnippet) {
          // 创建新代码片段
          const newSnippet = {
            id: uuidv4(),
            name: importSnippet.name,
            code: importSnippet.code,
            filePath: importSnippet.filePath || '',
            fileName: importSnippet.fileName || importSnippet.name,
            category: importSnippet.category || '',
            language: importSnippet.language,
            parentId: this.getParentIdFromMap(importSnippet.parentId, directoryIdMap),
            createTime: Date.now(),
            order: importSnippet.order,
          }
          
          await this.storageManager.saveSnippet(newSnippet as any)
          added++
        } else {
          // 更新现有代码片段
          const updatedSnippet = {
            ...existingSnippet,
            code: importSnippet.code,
            filePath: importSnippet.filePath || existingSnippet.filePath,
            fileName: importSnippet.fileName || existingSnippet.fileName,
            category: importSnippet.category || existingSnippet.category,
            language: importSnippet.language,
            parentId: this.getParentIdFromMap(importSnippet.parentId, directoryIdMap),
            order: importSnippet.order,
          }
          
          await this.storageManager.updateSnippet(updatedSnippet as any)
          updated++
        }
      }

      return { added, updated, directoriesCreated }
    } catch (error) {
      console.error('V1导入失败:', error)
      throw error
    }
  }

  private async performImportV2(
    importData: ExportDataV2
  ): Promise<{ added: number; updated: number; directoriesCreated: number }> {
    let added = 0
    let updated = 0
    let directoriesCreated = 0

    try {
      // 获取现有数据
      const [existingDirectories, existingSnippets] = await Promise.all([
        this.storageManager.getAllDirectories() as Promise<any[]>,
        this.storageManager.getAllSnippets() as Promise<any[]>,
      ])

      // 导入目录
      for (const importDir of importData.directories) {
        // 检查是否已存在相同路径的目录
        const existingDir = existingDirectories.find(d => d.fullPath === importDir.fullPath)
        
        if (!existingDir) {
          // 创建新目录
          const newDirectory = {
            ...importDir,
            id: uuidv4(), // 为V1兼容性保留ID
          }
          
          await this.storageManager.createDirectory(newDirectory as any)
          directoriesCreated++
        }
      }

      // 导入代码片段
      for (const importSnippet of importData.snippets) {
        // 检查是否已存在相同路径的代码片段
        const existingSnippet = existingSnippets.find(s => s.fullPath === importSnippet.fullPath)
        
        if (!existingSnippet) {
          // 创建新代码片段
          const newSnippet = {
            ...importSnippet,
            id: uuidv4(), // 为V1兼容性保留ID
            createdAt: new Date(),
            updatedAt: new Date(),
          }
          
          await this.storageManager.saveSnippet(newSnippet as any)
          added++
        } else {
          // 更新现有代码片段
          const updatedSnippet = {
            ...existingSnippet,
            ...importSnippet,
            id: existingSnippet.id, // 保持原有ID
            createdAt: existingSnippet.createdAt, // 保持原有创建时间
            updatedAt: new Date(),
          }
          
          await this.storageManager.updateSnippet(updatedSnippet as any)
          updated++
        }
      }

      return { added, updated, directoriesCreated }
    } catch (error) {
      console.error('V2导入失败:', error)
      throw error
    }
  }

  private getParentIdFromMap(oldParentId: string | null, directoryIdMap: Map<string, string>): string | null {
    if (!oldParentId) {
      return null
    }
    return directoryIdMap.get(oldParentId) || null
  }
}
