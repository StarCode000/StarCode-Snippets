import * as vscode from 'vscode';
import { StorageManager } from './storage/storageManager';
import { v4 as uuidv4 } from 'uuid';
import { CodeSnippet, Directory } from './models/types';
import { SnippetEditor } from './editor/snippetEditor';
import { SnippetsTreeDataProvider } from './explorer/treeProvider';

export function activate(context: vscode.ExtensionContext): void {
  console.time('starcode-snippets:activate');
  
  // 创建存储管理器
  const storageManager = new StorageManager(context);
  
  // 创建树视图数据提供程序
  const treeDataProvider = new SnippetsTreeDataProvider(storageManager);
  
  // 注册树视图
  const treeView = vscode.window.createTreeView('copyCodeExplorer', {
    treeDataProvider: treeDataProvider,
    showCollapseAll: true
  });
  
  // 将树视图添加到上下文订阅中
  context.subscriptions.push(treeView);
  
  // 注册虚拟文档内容提供者，用于预览代码片段
  TextDocumentContentProvider.register(context);

  // 延迟初始化编辑器和注册命令，减少插件激活时的负担
  setTimeout(() => {
    // 初始化代码片段编辑器，传入存储管理器
    const snippetEditor = SnippetEditor.initialize(context, storageManager);
    
    // 监听SnippetEditor的保存事件，以便刷新视图
    snippetEditor.onDidSaveSnippet(() => {
      treeDataProvider.refresh();
    });
    
    // 注册完成编辑命令
    const finishEditing = vscode.commands.registerCommand('starcode-snippets.finishEditing', async () => {
      // 保存当前文档
      if (vscode.window.activeTextEditor) {
        await vscode.window.activeTextEditor.document.save();
      }
      // 关闭编辑器
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });
    context.subscriptions.push(finishEditing);
    
    // 注册所有命令
    const commands = registerCommands(context, storageManager, treeDataProvider);
    
    // 添加命令到订阅中
    context.subscriptions.push(...commands);
    
    console.timeEnd('starcode-snippets:activate');
  }, 500); // 缩短延迟时间
}

// 将命令注册逻辑分离出来，便于延迟加载
function registerCommands(
  context: vscode.ExtensionContext, 
  storageManager: StorageManager, 
  treeDataProvider: SnippetsTreeDataProvider
): vscode.Disposable[] {
  // 插入代码片段的通用函数
  async function insertSnippet(snippet: CodeSnippet): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const position = editor.selection.active;
      await editor.edit((editBuilder) => {
        editBuilder.insert(position, snippet.code);
      });
      // 强制将焦点设置回编辑器
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      return true;
    }
    return false;
  }

  // 检查同一目录下是否有重名代码片段
  async function checkDuplicateSnippetName(name: string, parentId: string | null): Promise<boolean> {
    const snippets = await storageManager.getAllSnippets();
    return snippets.some(s => s.name === name && s.parentId === parentId);
  }

  // 检查同一级别是否有重名目录
  async function checkDuplicateDirectoryName(name: string, parentId: string | null): Promise<boolean> {
    const directories = await storageManager.getAllDirectories();
    return directories.some(d => d.name === name && d.parentId === parentId);
  }

  // 添加一个辅助函数，将我们的语言ID映射到VSCode支持的语言ID
  function mapLanguageToVSCode(language: string): string {
    // 大多数语言ID是兼容的，但有些需要特殊处理
    switch (language) {
      case 'vue':
        return 'html' // 使用HTML作为Vue文件的后备语言
      case 'shell':
        return 'shellscript'
      case 'yaml':
        return 'yaml'
      case 'cpp':
        return 'cpp'
      case 'csharp':
        return 'csharp'
      default:
        return language
    }
  }

  // 注册保存代码片段命令
  const saveToLibrary = vscode.commands.registerCommand(
    'starcode-snippets.saveToLibrary', 
    async () => {
      const editor = vscode.window.activeTextEditor;
    if (editor) {
        const selection = editor.selection;
        const code = editor.document.getText(selection);

      // 获取文件信息
        const fileName = editor.document.fileName.split('/').pop() || '';
        const filePath = editor.document.fileName;

      // 提示用户输入名称
      const name = await vscode.window.showInputBox({
        prompt: '为代码片段命名',
        placeHolder: '输入代码片段名称',
        });

      if (name) {
        // 获取所有目录供选择
          const directories = await storageManager.getAllDirectories();
        const directoryItems = [
          { label: '根目录', id: null },
          ...directories.map((dir) => ({ label: dir.name, id: dir.id })),
          ];

        const selectedDirectory = await vscode.window.showQuickPick(directoryItems, {
          placeHolder: '选择保存位置',
          });

        if (selectedDirectory) {
          // 检查是否有重名代码片段
            const isDuplicate = await checkDuplicateSnippetName(name, selectedDirectory.id);
          if (isDuplicate) {
              vscode.window.showErrorMessage(`所选目录中已存在名为 "${name}" 的代码片段`);
              return;
          }
          // 根据文件扩展名或内容自动检测语言
            let language = 'plaintext';

          // 从文件扩展名检测语言
            const fileExt = fileName.split('.').pop()?.toLowerCase();
          if (fileExt) {
            switch (fileExt) {
              case 'ts':
                  language = 'typescript';
                  break;
              case 'js':
                  language = 'javascript';
                  break;
              case 'html':
                  language = 'html';
                  break;
              case 'css':
                  language = 'css';
                  break;
              case 'json':
                  language = 'json';
                  break;
              case 'vue':
                  language = 'vue';
                  break;
              case 'py':
                  language = 'python';
                  break;
              case 'java':
                  language = 'java';
                  break;
              case 'cs':
                  language = 'csharp';
                  break;
              case 'cpp':
              case 'c':
              case 'h':
                  language = 'cpp';
                  break;
              case 'go':
                  language = 'go';
                  break;
              case 'php':
                  language = 'php';
                  break;
              case 'rb':
                  language = 'ruby';
                  break;
              case 'rs':
                  language = 'rust';
                  break;
              case 'sql':
                  language = 'sql';
                  break;
              case 'md':
                  language = 'markdown';
                  break;
              case 'yml':
              case 'yaml':
                  language = 'yaml';
                  break;
              case 'sh':
              case 'bash':
                  language = 'shell';
                  break;
            }
          }

          // 如果没有从文件扩展名检测到语言，尝试从内容检测
          if (language === 'plaintext') {
            // 检测Vue文件
            if (code.includes('<template>') && (code.includes('<script>') || code.includes('<script setup'))) {
                language = 'vue';
            }
            // 检测HTML文件
            else if (code.includes('<!DOCTYPE html>') || (code.includes('<html') && code.includes('<body'))) {
                language = 'html';
            }
            // 检测JavaScript/TypeScript文件
            else if (
              code.includes('function') ||
              code.includes('const ') ||
              code.includes('let ') ||
              code.includes('class ')
            ) {
              if (
                code.includes(': string') ||
                code.includes(': number') ||
                code.includes(': boolean') ||
                code.includes('interface ')
              ) {
                  language = 'typescript';
              } else {
                  language = 'javascript';
              }
            }
          }

          const snippet: CodeSnippet = {
            id: uuidv4(),
            name,
            code,
            fileName,
            filePath,
            category: selectedDirectory.label,
            parentId: selectedDirectory.id,
            order: 0,
            createTime: Date.now(),
            language: language,
            };

            await storageManager.saveSnippet(snippet);
            treeDataProvider.refresh();
          }
        }
      }
    }
  );

  // 注册预览代码片段命令
  const previewSnippet = vscode.commands.registerCommand(
    'starcode-snippets.previewSnippet',
    async (snippet: CodeSnippet) => {
      if (!snippet) {return;}

      try {
        // 获取代码语言 - 修复可能的 undefined.split() 错误
        const language = snippet.language || 
                       (snippet.fileName ? snippet.fileName.split('.').pop() : '') || 
                       'plaintext';
        
        // 检查该代码片段是否已有预览窗口
        if (TextDocumentContentProvider.instance) {
          const existingPreviewUri = TextDocumentContentProvider.instance.getOpenPreviewUri(snippet.id);
          if (existingPreviewUri) {
            // 如果已经有预览窗口，找到对应的编辑器并激活它
            for (const editor of vscode.window.visibleTextEditors) {
              if (editor.document.uri.toString() === existingPreviewUri.toString()) {
                // 激活该编辑器
                await vscode.window.showTextDocument(editor.document, {
                  viewColumn: editor.viewColumn,
                  preserveFocus: false,
                  preview: true
                });
                return; // 已经显示了现有的预览，不需要创建新的
              }
            }
            // 如果找不到对应的编辑器（可能已经关闭），从跟踪中移除
            TextDocumentContentProvider.instance.setOpenPreview(snippet.id, undefined);
          }
        }
        
        // 创建虚拟文档URI - 使用自定义scheme，添加片段ID确保唯一性
        const scheme = 'starcode-preview';
        const uri = vscode.Uri.parse(`${scheme}:${snippet.name}_${snippet.id}.${language}`);

        // 注册文档内容提供者(如果还没注册)
        if (!TextDocumentContentProvider.instance) {
          TextDocumentContentProvider.register(context);
        }
        
        // 设置当前预览内容
        TextDocumentContentProvider.instance.update(uri, snippet.code || '', language);
        
        // 记录这个代码片段的预览URI
        TextDocumentContentProvider.instance.setOpenPreview(snippet.id, uri);
        
        // 打开文档
        const document = await vscode.workspace.openTextDocument(uri);
        
        // 设置语言 - 使用映射后的语言ID
        const vscodeLangId = mapLanguageToVSCode(language);
        if (vscodeLangId !== 'plaintext') {
          try {
            await vscode.languages.setTextDocumentLanguage(document, vscodeLangId);
          } catch (error) {
            console.warn(`无法设置语言为 ${vscodeLangId}:`, error);
            // 如果设置失败，尝试使用html作为备选
            if (language === 'vue') {
              await vscode.languages.setTextDocumentLanguage(document, 'html');
            }
          }
        }
                    
        // 显示文档
        await vscode.window.showTextDocument(document, {
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: false,
          preview: true
        });
                
        // 设置编辑器标题
        vscode.window.showInformationMessage(`预览: ${snippet.name}`);
        
      } catch (error) {
        console.error('预览失败:', error);
        vscode.window.showErrorMessage(`预览代码片段失败: ${error}`);
      }
    }
  );

  // 重命名命令
  const renameItem = vscode.commands.registerCommand(
    'starcode-snippets.rename', 
    async (item: any) => {
      if (!item) {return;}

    const newName = await vscode.window.showInputBox({
      prompt: '重命名...',
      value: item.label,
      });

    if (newName) {
      if (item.snippet) {
        // 检查是否有重名代码片段
          const isDuplicate = await checkDuplicateSnippetName(newName, item.snippet.parentId);
        if (isDuplicate) {
            vscode.window.showErrorMessage(`所选目录中已存在名为 "${newName}" 的代码片段`);
            return;
        }
          const updatedSnippet = { ...item.snippet, name: newName };
          await storageManager.updateSnippet(updatedSnippet);
      } else if (item.directory) {
        // 检查是否有重名目录
          const isDuplicate = await checkDuplicateDirectoryName(newName, item.directory.parentId);
        if (isDuplicate) {
            vscode.window.showErrorMessage(`当前层级已存在名为 "${newName}" 的目录`);
            return;
        }
          const updatedDirectory = { ...item.directory, name: newName };
          await storageManager.updateDirectory(updatedDirectory);
      }
        treeDataProvider.refresh();
    }
    }
  );

  // 创建目录命令
  const createDirectory = vscode.commands.registerCommand(
    'starcode-snippets.createDirectory', 
    async () => {
    const name = await vscode.window.showInputBox({
      prompt: '输入目录名',
      placeHolder: '新建目录',
      });

    if (name) {
      // 检查是否有重名目录
        const isDuplicate = await checkDuplicateDirectoryName(name, null);
      if (isDuplicate) {
          vscode.window.showErrorMessage(`根目录下已存在名为 "${name}" 的目录`);
          return;
      }

      const directory: Directory = {
        id: uuidv4(),
        name,
        parentId: null,
        order: 0,
        };
        await storageManager.createDirectory(directory);
        treeDataProvider.refresh();
      }
    }
  );

  // 在指定目录中创建代码片段命令
  const createSnippetInDirectory = vscode.commands.registerCommand(
    'starcode-snippets.createSnippetInDirectory',
    async (item: any) => {
      if (!item?.directory) {return;}

      const name = await vscode.window.showInputBox({
        prompt: '输入代码片段名称',
        placeHolder: '新建代码片段',
      });

      if (name) {
        // 检查是否有重名代码片段
        const isDuplicate = await checkDuplicateSnippetName(name, item.directory.id);
        if (isDuplicate) {
          vscode.window.showErrorMessage(`目录 "${item.directory.name}" 中已存在名为 "${name}" 的代码片段`);
          return;
        }

        // 让用户选择语言
        const languageOptions = [
          { label: '纯文本', value: 'plaintext' },
          { label: 'TypeScript', value: 'typescript' },
          { label: 'JavaScript', value: 'javascript' },
          { label: 'HTML', value: 'html' },
          { label: 'CSS', value: 'css' },
          { label: 'JSON', value: 'json' },
          { label: 'Vue', value: 'vue' },
          { label: 'Python', value: 'python' },
          { label: 'Java', value: 'java' },
          { label: 'C#', value: 'csharp' },
          { label: 'C++', value: 'cpp' },
          { label: 'Go', value: 'go' },
          { label: 'PHP', value: 'php' },
          { label: 'Ruby', value: 'ruby' },
          { label: 'Rust', value: 'rust' },
          { label: 'SQL', value: 'sql' },
          { label: 'Markdown', value: 'markdown' },
          { label: 'YAML', value: 'yaml' },
          { label: 'Shell', value: 'shell' },
        ];

        const selectedLanguage = await vscode.window.showQuickPick(languageOptions, {
          placeHolder: '选择代码语言',
        });

        if (!selectedLanguage) {return;} // 用户取消了选择

        // 根据选择的语言设置文件名
        let fileName = 'snippet';
        switch (selectedLanguage.value) {
          case 'typescript':
            fileName += '.ts';
            break;
          case 'javascript':
            fileName += '.js';
            break;
          case 'html':
            fileName += '.html';
            break;
          case 'css':
            fileName += '.css';
            break;
          case 'json':
            fileName += '.json';
            break;
          case 'vue':
            fileName += '.vue';
            break;
          case 'python':
            fileName += '.py';
            break;
          case 'java':
            fileName += '.java';
            break;
          case 'csharp':
            fileName += '.cs';
            break;
          case 'cpp':
            fileName += '.cpp';
            break;
          case 'go':
            fileName += '.go';
            break;
          case 'php':
            fileName += '.php';
            break;
          case 'ruby':
            fileName += '.rb';
            break;
          case 'rust':
            fileName += '.rs';
            break;
          case 'sql':
            fileName += '.sql';
            break;
          case 'markdown':
            fileName += '.md';
            break;
          case 'yaml':
            fileName += '.yml';
            break;
          case 'shell':
            fileName += '.sh';
            break;
          default:
            fileName += '.txt';
        }

        const snippet: CodeSnippet = {
          id: uuidv4(),
          name,
          code: '',
          fileName: fileName,
          filePath: '',
          category: item.directory.name,
          parentId: item.directory.id,
          order: 0,
          createTime: Date.now(),
          language: selectedLanguage.value,
        };

        await storageManager.saveSnippet(snippet);
        treeDataProvider.refresh();

        // 打开编辑器编辑代码片段
        try {
          await SnippetEditor.getInstance().edit(snippet);
          // 编辑器会自动处理保存和刷新
        } catch (error) {
          console.error('编辑代码片段失败:', error);
          vscode.window.showErrorMessage(`编辑代码片段失败: ${error}`);
        }
      }
    }
  );

  // 删除命令
  const deleteItem = vscode.commands.registerCommand(
    'starcode-snippets.delete', 
    async (item: any) => {
      if (!item) {return;}

    const confirmMessage = item.snippet
      ? `确定要删除代码片段 "${item.snippet.name}" 吗？`
        : `确定要删除目录 "${item.directory.name}" 及其所有内容吗？`;

      const confirm = await vscode.window.showWarningMessage(confirmMessage, { modal: true }, '确定');

    if (confirm === '确定') {
      if (item.snippet) {
          await storageManager.deleteSnippet(item.snippet.id);
      } else if (item.directory) {
          await storageManager.deleteDirectory(item.directory.id);
        }
        treeDataProvider.refresh();
      }
    }
  );

  // 追加粘贴命令
  const appendCode = vscode.commands.registerCommand(
    'starcode-snippets.appendCode', 
    async (item: any) => {
      if (!item?.snippet) {return;}

      const editor = vscode.window.activeTextEditor;
    if (editor) {
        const position = editor.selection.active;
      await editor.edit((editBuilder) => {
          editBuilder.insert(position, item.snippet.code);
        });
      }
    }
  );

  // 编辑代码命令
  const editSnippet = vscode.commands.registerCommand(
    'starcode-snippets.editSnippet', 
    async (item: any) => {
      if (!item?.snippet) {return;}

      try {
        // 使用SnippetEditor编辑代码片段
        await SnippetEditor.getInstance().edit(item.snippet);
        // 编辑器现在会自动处理保存和通知刷新
      } catch (error) {
        console.error('编辑代码片段失败:', error);
        vscode.window.showErrorMessage(`编辑代码片段失败: ${error}`);
    }
    }
  );

  // 移动到目录命令
  const moveToDirectory = vscode.commands.registerCommand(
    'starcode-snippets.moveToDirectory', 
    async (item: any) => {
      if (!item?.snippet) {return;}

      const directories = await storageManager.getAllDirectories();
    const directoryItems = [
      { label: '根目录', id: null },
        ...directories.map((dir: Directory) => ({ label: dir.name, id: dir.id })),
      ];

    const selectedDirectory = await vscode.window.showQuickPick(directoryItems, {
      placeHolder: '选择目标目录',
      });

    if (selectedDirectory) {
      // 检查目标目录中是否已有同名代码片段
        const isDuplicate = await checkDuplicateSnippetName(item.snippet.name, selectedDirectory.id);
      if (isDuplicate) {
          vscode.window.showErrorMessage(`目标目录中已存在名为 "${item.snippet.name}" 的代码片段`);
          return;
      }

      const updatedSnippet = {
        ...item.snippet,
        parentId: selectedDirectory.id,
        category: selectedDirectory.label,
        };
        await storageManager.updateSnippet(updatedSnippet);
        treeDataProvider.refresh();
      }
    }
  );

  // 注册插入代码片段命令
  const insertSnippetCommand = vscode.commands.registerCommand(
    'starcode-snippets.insertSnippet',
    async (snippet: CodeSnippet) => {
      await insertSnippet(snippet);
    }
  );

  // 注册刷新视图命令
  const refreshExplorer = vscode.commands.registerCommand(
    'starcode-snippets.refreshExplorer', 
    () => {
      treeDataProvider.refresh();
      console.log('刷新视图');
      vscode.window.showInformationMessage('代码库已刷新');
    }
  );

  // 返回所有注册的命令
  return [
    saveToLibrary,
    previewSnippet,
    renameItem,
    createDirectory,
    deleteItem,
    appendCode,
    editSnippet,
    moveToDirectory,
    insertSnippetCommand,
    createSnippetInDirectory,
    refreshExplorer
  ];
}

export function deactivate(): void {}

/**
 * 虚拟文档内容提供程序
 */
class TextDocumentContentProvider implements vscode.TextDocumentContentProvider {
  public static instance: TextDocumentContentProvider;
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  private contents = new Map<string, string>();
  private languages = new Map<string, string>();
  private maxCachedEntries = 50; // 最多缓存多少条预览记录
  // 添加已打开预览的跟踪
  private openPreviewsBySnippetId = new Map<string, vscode.Uri>();
  
  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    TextDocumentContentProvider.instance = new TextDocumentContentProvider();
    
    // 注册提供者，用于自定义scheme
    const registration = vscode.workspace.registerTextDocumentContentProvider(
      'starcode-preview',
      TextDocumentContentProvider.instance
    );
    
    // 添加编辑器关闭事件监听，清理内存
    const disposable = vscode.window.onDidChangeVisibleTextEditors(editors => {
      TextDocumentContentProvider.instance.cleanupUnusedContent(editors);
    });
    
    context.subscriptions.push(registration, disposable);
    return registration;
  }
  
  /**
   * 清理未使用的内容，防止内存泄漏
   */
  private cleanupUnusedContent(editors: readonly vscode.TextEditor[]) {
    // 获取当前打开的所有URI
    const openUris = new Set<string>(
      editors.map(editor => editor.document.uri.toString())
    );
    
    // 找出哪些内容不再使用
    const unusedUris: string[] = [];
    for (const uri of this.contents.keys()) {
      if (!openUris.has(uri)) {
        unusedUris.push(uri);
      }
    }
    
    // 删除未使用的内容
    for (const uri of unusedUris) {
      this.contents.delete(uri);
      this.languages.delete(uri);
      
      // 从已打开预览中移除
      for (const [snippetId, previewUri] of this.openPreviewsBySnippetId.entries()) {
        if (previewUri.toString() === uri) {
          this.openPreviewsBySnippetId.delete(snippetId);
          break;
        }
      }
    }
    
    // 如果缓存太大，移除最旧的条目
    if (this.contents.size > this.maxCachedEntries) {
      const entriesToDelete = this.contents.size - this.maxCachedEntries;
      const uris = [...this.contents.keys()].slice(0, entriesToDelete);
      for (const uri of uris) {
        this.contents.delete(uri);
        this.languages.delete(uri);
      }
    }
  }
  
  // 添加获取已打开预览的方法
  public getOpenPreviewUri(snippetId: string): vscode.Uri | undefined {
    return this.openPreviewsBySnippetId.get(snippetId);
  }
  
  // 添加设置已打开预览的方法
  public setOpenPreview(snippetId: string, uri: vscode.Uri | undefined): void {
    if (uri) {
      this.openPreviewsBySnippetId.set(snippetId, uri);
    } else {
      this.openPreviewsBySnippetId.delete(snippetId);
    }
  }
  
  public get onDidChange(): vscode.Event<vscode.Uri> {
    return this._onDidChange.event;
  }
  
  public update(uri: vscode.Uri, content: string, language?: string): void {
    this.contents.set(uri.toString(), content);
    if (language) {
      this.languages.set(uri.toString(), language);
    }
    this._onDidChange.fire(uri);
  }
  
  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) || '';
  }
}
