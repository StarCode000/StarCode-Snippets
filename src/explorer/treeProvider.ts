import * as vscode from 'vscode';
import { StorageManager } from '../storage/storageManager';
import { CodeSnippet, Directory } from '../models/types';
import * as path from 'path';

export class SnippetTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly snippet?: CodeSnippet,
    public readonly directory?: Directory
  ) {
    super(label, collapsibleState);
    
    // 设置图标
    if (directory) {
      this.iconPath = new vscode.ThemeIcon('folder');
      this.contextValue = 'directory';
      
      // 添加目录的内联按钮
      this.tooltip = `目录: ${directory.name}`;
      
      // 为目录添加按钮 - 注意VSCode的树视图中这些会显示为图标
      // 不需要在这里添加，通过 package.json 的 view/item/context 配置
    } else if (snippet) {
      this.iconPath = new vscode.ThemeIcon('symbol-variable');
      this.contextValue = 'snippet';
      
      // 添加代码片段的tooltip显示代码预览
      const codePreview = snippet.code.length > 500 
        ? snippet.code.substring(0, 500) + '...' 
        : snippet.code;
      this.tooltip = new vscode.MarkdownString(`**${snippet.name}**\n\`\`\`${snippet.language}\n${codePreview}\n\`\`\``);
      
      // 为代码片段添加命令 - 双击时预览
      this.command = {
        command: 'starcode-snippets.previewSnippet',
        title: '预览代码片段',
        arguments: [snippet]
      };
    }
  }
}

export class SnippetsTreeDataProvider implements vscode.TreeDataProvider<SnippetTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<SnippetTreeItem | undefined | null | void> = new vscode.EventEmitter<SnippetTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<SnippetTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
  
  private _snippets: CodeSnippet[] = [];
  private _directories: Directory[] = [];
  private _initialized: boolean = false;
  
  constructor(private storageManager: StorageManager) {
    // 立即加载数据
    this._loadData().then(() => {
      console.log('TreeDataProvider 初始化完成');
      this._initialized = true;
    }).catch(error => {
      console.error('TreeDataProvider 初始化失败:', error);
    });
  }
  
  refresh(): void {
    this._loadData().then(() => {
      this._onDidChangeTreeData.fire();
    });
  }
  
  private async _loadData(): Promise<void> {
    try {
      // 并行加载数据
      const [directories, snippets] = await Promise.all([
        this.storageManager.getAllDirectories(),
        this.storageManager.getAllSnippets()
      ]);
      
      this._directories = directories;
      this._snippets = snippets;
      
      console.log(`加载了 ${this._directories.length} 个目录和 ${this._snippets.length} 个代码片段`);
    } catch (error) {
      console.error('加载数据失败:', error);
      vscode.window.showErrorMessage(`加载代码片段失败: ${error}`);
    }
  }
  
  getTreeItem(element: SnippetTreeItem): vscode.TreeItem {
    return element;
  }
  
  async getChildren(element?: SnippetTreeItem): Promise<SnippetTreeItem[]> {
    // 如果数据还没加载完成，先等待数据加载
    if (!this._initialized) {
      await this._loadData();
      this._initialized = true;
    }
    
    if (!element) {
      // 根节点 - 显示所有顶级目录和代码片段
      const rootItems: SnippetTreeItem[] = [];
      
      // 添加根级别的目录
      const rootDirs = this._directories.filter(dir => dir.parentId === null);
      rootDirs
        .sort((a, b) => a.order - b.order)
        .forEach(dir => {
          rootItems.push(new SnippetTreeItem(
            dir.name,
            vscode.TreeItemCollapsibleState.Expanded,
            undefined,
            dir
          ));
        });
      
      // 添加根级别的代码片段
      const rootSnippets = this._snippets.filter(s => s.parentId === null);
      rootSnippets
        .sort((a, b) => a.order - b.order)
        .forEach(snippet => {
          const item = new SnippetTreeItem(
            snippet.name,
            vscode.TreeItemCollapsibleState.None,
            snippet
          );
          
          rootItems.push(item);
        });
      
      return rootItems;
    } else if (element.directory) {
      // 目录节点 - 显示该目录下的所有子目录和代码片段
      const directoryItems: SnippetTreeItem[] = [];
      
      // 添加子目录
      const childDirs = this._directories.filter(dir => dir.parentId === element.directory?.id);
      childDirs
        .sort((a, b) => a.order - b.order)
        .forEach(dir => {
          directoryItems.push(new SnippetTreeItem(
            dir.name,
            vscode.TreeItemCollapsibleState.Expanded,
            undefined,
            dir
          ));
        });
      
      // 添加目录下的代码片段
      const dirSnippets = this._snippets.filter(s => s.parentId === element.directory?.id);
      dirSnippets
        .sort((a, b) => a.order - b.order)
        .forEach(snippet => {
          const item = new SnippetTreeItem(
            snippet.name,
            vscode.TreeItemCollapsibleState.None,
            snippet
          );
          
          directoryItems.push(item);
        });
      
      return directoryItems;
    }
    
    return [];
  }
} 