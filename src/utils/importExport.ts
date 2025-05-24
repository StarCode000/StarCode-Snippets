import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CodeSnippet, Directory } from '../models/types';
import { StorageManager } from '../storage/storageManager';
import { v4 as uuidv4 } from 'uuid';

export interface ExportData {
  version: string;
  exportDate: string;
  directories: Directory[];
  snippets: CodeSnippet[];
}

export class ImportExportManager {
  constructor(private storageManager: StorageManager) {}

  /**
   * 导出单个代码片段
   */
  async exportSnippet(snippet: CodeSnippet): Promise<void> {
    try {
      // 获取代码片段所在的目录路径
      const directories = await this.storageManager.getAllDirectories();
      const snippetDirectories = this.getSnippetDirectoryPath(snippet, directories);

      const exportData: ExportData = {
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        directories: snippetDirectories,
        snippets: [snippet]
      };

      await this.saveExportFile(exportData, `${snippet.name}.json`);
      vscode.window.showInformationMessage(`代码片段 "${snippet.name}" 导出成功！`);
    } catch (error) {
      console.error('导出代码片段失败:', error);
      vscode.window.showErrorMessage(`导出代码片段失败: ${error}`);
    }
  }

  /**
   * 导出所有代码片段
   */
  async exportAllSnippets(): Promise<void> {
    try {
      const [directories, snippets] = await Promise.all([
        this.storageManager.getAllDirectories(),
        this.storageManager.getAllSnippets()
      ]);

      const exportData: ExportData = {
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        directories,
        snippets
      };

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      await this.saveExportFile(exportData, `starcode-snippets-export-${timestamp}.json`);
      vscode.window.showInformationMessage(`所有代码片段导出成功！共导出 ${snippets.length} 个代码片段。`);
    } catch (error) {
      console.error('导出所有代码片段失败:', error);
      vscode.window.showErrorMessage(`导出所有代码片段失败: ${error}`);
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
          'JSON Files': ['json']
        },
        openLabel: '选择要导入的代码片段文件'
      });

      if (!fileUri || fileUri.length === 0) {
        return; // 用户取消了选择
      }

      const filePath = fileUri[0].fsPath;
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const importData: ExportData = JSON.parse(fileContent);

      // 验证导入数据格式
      if (!this.validateImportData(importData)) {
        vscode.window.showErrorMessage('导入文件格式不正确！');
        return;
      }

      // 执行导入
      const result = await this.performImport(importData);
      
      const message = `导入完成！新增 ${result.added} 个代码片段，更新 ${result.updated} 个代码片段，创建 ${result.directoriesCreated} 个目录。`;
      vscode.window.showInformationMessage(message);

    } catch (error) {
      console.error('导入代码片段失败:', error);
      vscode.window.showErrorMessage(`导入代码片段失败: ${error}`);
    }
  }

  /**
   * 获取代码片段的目录路径
   */
  private getSnippetDirectoryPath(snippet: CodeSnippet, allDirectories: Directory[]): Directory[] {
    const result: Directory[] = [];
    let currentParentId = snippet.parentId;

    while (currentParentId) {
      const directory = allDirectories.find(d => d.id === currentParentId);
      if (directory) {
        result.unshift(directory); // 添加到开头，保持正确的层级顺序
        currentParentId = directory.parentId;
      } else {
        break;
      }
    }

    return result;
  }

  /**
   * 保存导出文件
   */
  private async saveExportFile(data: ExportData, defaultFileName: string): Promise<void> {
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(defaultFileName),
      filters: {
        'JSON Files': ['json']
      },
      saveLabel: '保存导出文件'
    });

    if (saveUri) {
      const jsonContent = JSON.stringify(data, null, 2);
      fs.writeFileSync(saveUri.fsPath, jsonContent, 'utf8');
    }
  }

  /**
   * 验证导入数据格式
   */
  private validateImportData(data: any): data is ExportData {
    return (
      data &&
      typeof data === 'object' &&
      typeof data.version === 'string' &&
      typeof data.exportDate === 'string' &&
      Array.isArray(data.directories) &&
      Array.isArray(data.snippets)
    );
  }

  /**
   * 执行导入操作
   */
  private async performImport(importData: ExportData): Promise<{added: number, updated: number, directoriesCreated: number}> {
    let added = 0;
    let updated = 0;
    let directoriesCreated = 0;

    // 获取现有数据
    const [existingDirectories, existingSnippets] = await Promise.all([
      this.storageManager.getAllDirectories(),
      this.storageManager.getAllSnippets()
    ]);

    // 创建目录映射：旧ID -> 新ID
    const directoryIdMap = new Map<string, string>();

    // 首先处理目录
    for (const importDir of importData.directories) {
      const existingDir = existingDirectories.find(d => 
        d.name === importDir.name && 
        this.getParentIdFromMap(importDir.parentId, directoryIdMap) === d.parentId
      );

      if (existingDir) {
        // 目录已存在，记录映射关系
        directoryIdMap.set(importDir.id, existingDir.id);
      } else {
        // 创建新目录
        const newDirId = uuidv4();
        const newDirectory: Directory = {
          ...importDir,
          id: newDirId,
          parentId: this.getParentIdFromMap(importDir.parentId, directoryIdMap)
        };
        
        await this.storageManager.createDirectory(newDirectory);
        directoryIdMap.set(importDir.id, newDirId);
        directoriesCreated++;
      }
    }

    // 然后处理代码片段
    for (const importSnippet of importData.snippets) {
      const targetParentId = this.getParentIdFromMap(importSnippet.parentId, directoryIdMap);
      
      // 检查是否存在同名代码片段
      const existingSnippet = existingSnippets.find(s => 
        s.name === importSnippet.name && s.parentId === targetParentId
      );

      if (existingSnippet) {
        // 更新现有代码片段
        const updatedSnippet: CodeSnippet = {
          ...importSnippet,
          id: existingSnippet.id,
          parentId: targetParentId,
          createTime: existingSnippet.createTime // 保留原创建时间
        };
        
        await this.storageManager.updateSnippet(updatedSnippet);
        updated++;
      } else {
        // 创建新代码片段
        const newSnippet: CodeSnippet = {
          ...importSnippet,
          id: uuidv4(),
          parentId: targetParentId,
          createTime: Date.now()
        };
        
        await this.storageManager.saveSnippet(newSnippet);
        added++;
      }
    }

    return { added, updated, directoriesCreated };
  }

  /**
   * 从映射中获取新的父目录ID
   */
  private getParentIdFromMap(oldParentId: string | null, directoryIdMap: Map<string, string>): string | null {
    if (!oldParentId) {
      return null;
    }
    return directoryIdMap.get(oldParentId) || null;
  }
} 