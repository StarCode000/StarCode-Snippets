// src/explorer/treeDataProvider.ts
import * as vscode from 'vscode';
import { CodeSnippet, Directory } from '../models/types';
import { StorageManager } from '../storage/storageManager';
import { DragAndDropController } from './dragAndDrop';

export class CopyCodeTreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined> = new vscode.EventEmitter<TreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined> = this._onDidChangeTreeData.event;

    private dragAndDropController: DragAndDropController;

    constructor(private storageManager: StorageManager) {
        this.dragAndDropController = new DragAndDropController(this._onDidChangeTreeData);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeItem): Promise<TreeItem[]> {
        if (!element) {
            // 根级别项目
            const snippets = await this.storageManager.getAllSnippets();
            return this.buildTree(snippets);
        }
        return element.children;
    }

    private buildTree(snippets: CodeSnippet[]): TreeItem[] {
        // 构建树形结构
        const rootItems: TreeItem[] = [];
        const itemMap = new Map<string, TreeItem>();

        // 首先创建所有目录
        snippets.forEach(snippet => {
            if (snippet.parentId === null) {
                const item = new TreeItem(
                    snippet.name,
                    vscode.TreeItemCollapsibleState.None,
                    snippet
                );
                rootItems.push(item);
            } else {
                // 处理在目录中的项目
                if (!itemMap.has(snippet.parentId)) {
                    const parentItem = new TreeItem(
                        snippet.category,
                        vscode.TreeItemCollapsibleState.Expanded
                    );
                    itemMap.set(snippet.parentId, parentItem);
                    rootItems.push(parentItem);
                }
                const parentItem = itemMap.get(snippet.parentId)!;
                const item = new TreeItem(
                    snippet.name,
                    vscode.TreeItemCollapsibleState.None,
                    snippet
                );
                parentItem.children.push(item);
            }
        });

        return rootItems;
    }


    public getDragAndDropController(): vscode.TreeDragAndDropController<any> {
        return this.dragAndDropController;
    }
}

export class TreeItem extends vscode.TreeItem {
    children: TreeItem[] = [];
    
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly snippet?: CodeSnippet
    ) {
        super(label, collapsibleState);
        
        if (snippet) {
            this.tooltip = `${snippet.fileName}\n${snippet.filePath}`;
            this.command = {
                command: 'copy-code.previewSnippet',
                title: 'Preview Snippet',
                arguments: [snippet]
            };
        }
    }
}