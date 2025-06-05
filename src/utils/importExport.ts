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
   * 导出单个代码片段
   */
  async exportSnippet(snippet: CodeSnippet | CodeSnippetV2): Promise<void> {
    try {
      // 始终使用V2格式导出
      let exportData: ExportData

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
        } as ExportDataV2
      } else {
        // 将V1格式转换为V2
        const snippetV1 = snippet as CodeSnippetV1
        const directories = (await this.storageManager.getAllDirectories()) as DirectoryV1[]

        // 转换成V2格式
        const result = PathBasedManager.convertToV2([snippetV1 as CodeSnippetV1], directories as DirectoryV1[])

        exportData = {
          version: '2.0.0',
          exportDate: new Date().toISOString(),
          directories: result.directories,
          snippets: result.snippets,
        } as ExportDataV2
      }

      await this.saveExportFile(exportData, `${snippet.name}.json`)
      vscode.window.showInformationMessage(`代码片段 "${snippet.name}" 导出成功！`)
    } catch (error) {
      console.error('导出代码片段失败:', error)
      vscode.window.showErrorMessage(`导出代码片段失败: ${error}`)
    }
  }

  /**
   * 导出所有代码片段
   */
  async exportAllSnippets(): Promise<void> {
    try {
      // 始终使用V2格式导出
      const [directories, snippets] = await Promise.all([
        this.storageManager.getAllDirectories(),
        this.storageManager.getAllSnippets(),
      ])

      // 检查是否需要类型转换
      let exportData: ExportData

      if (this.isUsingV2()) {
        // 已经是V2格式，直接导出
        exportData = {
          version: '2.0.0',
          exportDate: new Date().toISOString(),
          directories: directories as unknown as DirectoryV2[],
          snippets: snippets as unknown as CodeSnippetV2[],
        } as ExportDataV2
      } else {
        // 将V1格式转换为V2
        const result = PathBasedManager.convertToV2(snippets as CodeSnippetV1[], directories as DirectoryV1[])

        exportData = {
          version: '2.0.0',
          exportDate: new Date().toISOString(),
          directories: result.directories,
          snippets: result.snippets,
        } as ExportDataV2
      }

      await this.saveExportFile(exportData)
    } catch (error) {
      vscode.window.showErrorMessage(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 使用指定格式导出所有代码片段
   * @param format 导出格式，'v1'或'v2'
   */
  async exportWithFormat(format: 'v1' | 'v2'): Promise<void> {
    try {
      // 获取当前使用的类型版本
      const isCurrentV2 = this.isUsingV2()
      const useV2 = format === 'v2'

      const [directories, snippets] = await Promise.all([
        this.storageManager.getAllDirectories(),
        this.storageManager.getAllSnippets(),
      ])

      let exportData: ExportData

      // 检查是否需要类型转换
      if (useV2 && !isCurrentV2) {
        // 将V1数据转换为V2
        if (this.storageContext) {
          // 使用StorageContext进行转换
          const result = PathBasedManager.convertToV2(snippets as CodeSnippetV1[], directories as DirectoryV1[])
          exportData = {
            version: '2.0.0',
            exportDate: new Date().toISOString(),
            directories: result.directories,
            snippets: result.snippets,
          } as ExportDataV2
        } else {
          // 手动转换
          const directoriesV2 = (directories as DirectoryV1[]).map((dir) =>
            PathBasedManager.convertDirectoryV1ToV2(dir, directories as DirectoryV1[])
          )
          const snippetsV2 = (snippets as CodeSnippetV1[]).map((snippet) =>
            PathBasedManager.convertSnippetV1ToV2(snippet, directories as DirectoryV1[])
          )
          exportData = {
            version: '2.0.0',
            exportDate: new Date().toISOString(),
            directories: directoriesV2,
            snippets: snippetsV2,
          } as ExportDataV2
        }
      } else if (!useV2 && isCurrentV2) {
        // 将V2数据转换为V1
        if (this.storageContext) {
          // 使用StorageContext进行转换
          const result = PathBasedManager.convertToV1(
            snippets as unknown as CodeSnippetV2[],
            directories as unknown as DirectoryV2[]
          )
          exportData = {
            version: '1.0.0',
            exportDate: new Date().toISOString(),
            directories: result.directories,
            snippets: result.snippets,
          } as ExportDataV1
        } else {
          // 首先创建空的V1目录结构，为了生成ID
          const emptyV1Directories: DirectoryV1[] = (directories as unknown as DirectoryV2[]).map((dir) => ({
            id: PathBasedManager.generateIdFromPath(dir.fullPath),
            name: dir.name,
            parentId: null, // 临时值
            order: dir.order,
          }))

          // 设置正确的parentId关系
          for (const dirV1 of emptyV1Directories) {
            const dirV2 = (directories as unknown as DirectoryV2[]).find(
              (d) => PathBasedManager.generateIdFromPath(d.fullPath) === dirV1.id
            )
            if (dirV2) {
              dirV1.parentId = PathBasedManager.findParentIdFromPath(dirV2.fullPath, emptyV1Directories)
            }
          }

          // 转换代码片段
          const snippetsV1 = (snippets as unknown as CodeSnippetV2[]).map((snippet) =>
            PathBasedManager.convertSnippetV2ToV1(snippet, emptyV1Directories)
          )

          exportData = {
            version: '1.0.0',
            exportDate: new Date().toISOString(),
            directories: emptyV1Directories,
            snippets: snippetsV1,
          } as ExportDataV1
        }
      } else {
        // 格式一致，无需转换
        if (useV2) {
          exportData = {
            version: '2.0.0',
            exportDate: new Date().toISOString(),
            directories: directories as unknown as DirectoryV2[],
            snippets: snippets as unknown as CodeSnippetV2[],
          } as ExportDataV2
        } else {
          exportData = {
            version: '1.0.0',
            exportDate: new Date().toISOString(),
            directories: directories as DirectoryV1[],
            snippets: snippets as CodeSnippetV1[],
          } as ExportDataV1
        }
      }

      await this.saveExportFile(exportData, `snippets_${format}.json`)
    } catch (error) {
      vscode.window.showErrorMessage(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 导入代码片段
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
        // console.log('已将导入数据从V1转换为V2格式')
      } else if (!isV2 && isV2Data) {
        // 将V2数据转换为V1
        importData = PathBasedManager.convertExportDataV2ToV1(importData as ExportDataV2)
        // console.log('已将导入数据从V2转换为V1格式')
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
      const directory = allDirectories.find((d) => d.id === currentParentId)
      if (directory) {
        result.unshift(directory) // 添加到开头，保持正确的层级顺序
        currentParentId = directory.parentId
      } else {
        break
      }
    }

    return result
  }

  /**
   * 保存导出文件
   */
  private async saveExportFile(data: ExportData, defaultFileName?: string): Promise<void> {
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(defaultFileName || 'CodeRepositoryExport.json'),
      filters: {
        'JSON Files': ['json'],
      },
      saveLabel: '保存导出文件',
    })

    if (saveUri) {
      const jsonContent = JSON.stringify(data, null, 2)
      fs.writeFileSync(saveUri.fsPath, jsonContent, 'utf8')
    }
  }

  /**
   * 判断当前是否使用V2版本类型
   */
  private isUsingV2(): boolean {
    if (this.storageContext) {
      return this.storageContext.getVersion() === 'v2'
    }
    // 如果未提供storageContext，尝试根据数据结构判断
    return false // 默认使用V1类型
  }

  /**
   * 执行导入操作
   */
  private async performImport(
    importData: ExportData
  ): Promise<{ added: number; updated: number; directoriesCreated: number }> {
    let added = 0
    let updated = 0
    let directoriesCreated = 0

    // 检查是否使用V2版本
    const isV2 = this.isUsingV2()

    if (isV2) {
      // V2版本导入处理
      return this.performImportV2(importData as ExportDataV2)
    } else {
      // V1版本导入处理
      return this.performImportV1(importData as ExportDataV1)
    }
  }

  /**
   * V1版本的导入处理
   */
  private async performImportV1(
    importData: ExportDataV1
  ): Promise<{ added: number; updated: number; directoriesCreated: number }> {
    let added = 0
    let updated = 0
    let directoriesCreated = 0

    // 获取现有数据
    const [existingDirectories, existingSnippets] = await Promise.all([
      this.storageManager.getAllDirectories() as Promise<DirectoryV1[]>,
      this.storageManager.getAllSnippets() as Promise<CodeSnippetV1[]>,
    ])

    // 创建目录映射：旧ID -> 新ID
    const directoryIdMap = new Map<string, string>()

    // 首先处理目录
    for (const importDir of importData.directories) {
      const existingDir = existingDirectories.find(
        (d) => d.name === importDir.name && this.getParentIdFromMap(importDir.parentId, directoryIdMap) === d.parentId
      )

      if (existingDir) {
        // 目录已存在，记录映射关系
        directoryIdMap.set(importDir.id, existingDir.id)
      } else {
        // 创建新目录
        const newDirId = uuidv4()
        const newDirectory: DirectoryV1 = {
          ...importDir,
          id: newDirId,
          parentId: this.getParentIdFromMap(importDir.parentId, directoryIdMap),
        }

        await this.storageManager.createDirectory(newDirectory)
        directoryIdMap.set(importDir.id, newDirId)
        directoriesCreated++
      }
    }

    // 然后处理代码片段
    for (const importSnippet of importData.snippets) {
      const targetParentId = this.getParentIdFromMap(importSnippet.parentId, directoryIdMap)

      // 检查是否存在同名代码片段
      const existingSnippet = existingSnippets.find(
        (s) => s.name === importSnippet.name && s.parentId === targetParentId
      )

      if (existingSnippet) {
        // 更新现有代码片段
        const updatedSnippet: CodeSnippetV1 = {
          ...importSnippet,
          id: existingSnippet.id,
          parentId: targetParentId,
          createTime: existingSnippet.createTime, // 保留原创建时间
        }

        await this.storageManager.updateSnippet(updatedSnippet)
        updated++
      } else {
        // 创建新代码片段
        const newSnippet: CodeSnippetV1 = {
          ...importSnippet,
          id: uuidv4(),
          parentId: targetParentId,
          createTime: Date.now(),
        }

        await this.storageManager.saveSnippet(newSnippet)
        added++
      }
    }

    return { added, updated, directoriesCreated }
  }

  /**
   * V2版本的导入处理
   */
  private async performImportV2(
    importData: ExportDataV2
  ): Promise<{ added: number; updated: number; directoriesCreated: number }> {
    let added = 0
    let updated = 0
    let directoriesCreated = 0

    // 获取现有数据
    const [existingDirectories, existingSnippets] = await Promise.all([
      this.storageManager.getAllDirectories() as unknown as Promise<DirectoryV2[]>,
      this.storageManager.getAllSnippets() as unknown as Promise<CodeSnippetV2[]>,
    ])

    // 首先处理目录
    for (const importDir of importData.directories) {
      const existingDir = existingDirectories.find((d) => d.fullPath === importDir.fullPath)

      if (!existingDir) {
        // 创建新目录
        await this.storageManager.createDirectory(importDir as unknown as DirectoryV1)
        directoriesCreated++
      }
    }

    // 然后处理代码片段
    for (const importSnippet of importData.snippets) {
      // 检查是否存在同路径的代码片段
      const existingSnippet = existingSnippets.find((s) => s.fullPath === importSnippet.fullPath)

      if (existingSnippet) {
        // 更新现有代码片段
        const updatedSnippet: CodeSnippetV2 = {
          ...importSnippet,
          createTime: existingSnippet.createTime, // 保留原创建时间
        }

        await this.storageManager.updateSnippet(updatedSnippet as unknown as CodeSnippetV1)
        updated++
      } else {
        // 创建新代码片段
        const newSnippet: CodeSnippetV2 = {
          ...importSnippet,
          createTime: Date.now(),
        }

        await this.storageManager.saveSnippet(newSnippet as unknown as CodeSnippetV1)
        added++
      }
    }

    return { added, updated, directoriesCreated }
  }

  /**
   * 从映射中获取新的父目录ID
   */
  private getParentIdFromMap(oldParentId: string | null, directoryIdMap: Map<string, string>): string | null {
    if (!oldParentId) {
      return null
    }
    return directoryIdMap.get(oldParentId) || null
  }
}
