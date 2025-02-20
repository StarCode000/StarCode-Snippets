// src/storage/storageManager.ts
import * as vscode from 'vscode';
import { CodeSnippet, Directory } from '../models/types';

export class StorageManager {
    private context: vscode.ExtensionContext;
    
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    // 获取所有代码片段
    public async getAllSnippets(): Promise<CodeSnippet[]> {
        const snippets = this.context.globalState.get<CodeSnippet[]>('codeSnippets', []);
        return snippets;
    }

    // 保存代码片段
    public async saveSnippet(snippet: CodeSnippet): Promise<void> {
        const snippets = await this.getAllSnippets();
        snippets.push(snippet);
        await this.context.globalState.update('codeSnippets', snippets);
    }

    // 更新代码片段
    public async updateSnippet(snippet: CodeSnippet): Promise<void> {
        const snippets = await this.getAllSnippets();
        const index = snippets.findIndex(s => s.id === snippet.id);
        if (index !== -1) {
            snippets[index] = snippet;
            await this.context.globalState.update('codeSnippets', snippets);
        }
    }

    // 删除代码片段
    public async deleteSnippet(id: string): Promise<void> {
        const snippets = await this.getAllSnippets();
        const filteredSnippets = snippets.filter(s => s.id !== id);
        await this.context.globalState.update('codeSnippets', filteredSnippets);
    }

    // 获取所有目录
    public async getAllDirectories(): Promise<Directory[]> {
      return this.context.globalState.get<Directory[]>('directories', []);
  }

  // 创建目录
  public async createDirectory(directory: Directory): Promise<void> {
      const directories = await this.getAllDirectories();
      directories.push(directory);
      await this.context.globalState.update('directories', directories);
  }

  // 更新代码片段顺序
  public async updateSnippetsOrder(snippets: CodeSnippet[]): Promise<void> {
      await this.context.globalState.update('codeSnippets', snippets);
  }

  // 更新目录
  public async updateDirectory(directory: Directory): Promise<void> {
      const directories = await this.getAllDirectories();
      const index = directories.findIndex(d => d.id === directory.id);
      if (index !== -1) {
          directories[index] = directory;
          await this.context.globalState.update('directories', directories);
      }
  }

  // 删除目录
  public async deleteDirectory(id: string): Promise<void> {
      const directories = await this.getAllDirectories();
      const filteredDirectories = directories.filter(d => d.id !== id);
      await this.context.globalState.update('directories', filteredDirectories);

      // 同时删除该目录下的所有代码片段
      const snippets = await this.getAllSnippets();
      const filteredSnippets = snippets.filter(s => s.parentId !== id);
      await this.context.globalState.update('codeSnippets', filteredSnippets);
  }
}