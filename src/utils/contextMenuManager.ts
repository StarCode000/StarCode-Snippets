import * as vscode from 'vscode'
import { CodeSnippet, Directory } from '../types/types'
import { StorageManager } from '../storage/storageManager'
import { StorageContext } from './storageContext'
import { PathBasedManager } from './pathBasedManager'

/**
 * 菜单项接口
 */
interface MenuItemData {
  id: string
  label: string
  snippet?: CodeSnippet
  directory?: Directory
  children?: MenuItemData[]
  isDirectory: boolean
  fullPath?: string
  parentPath?: string
}

/**
 * 上下文菜单管理器
 * 
 * 负责生成树形结构的代码片段菜单，支持在编辑器右键菜单中显示。
 * 提供两种菜单模式：
 * 
 * 1. **扁平菜单模式** (`showSnippetPicker`):
 *    - 在一个列表中显示所有代码片段
 *    - 使用缩进表示层级关系
 *    - 目录显示为分隔符
 *    - 适合快速浏览和搜索
 * 
 * 2. **分层菜单模式** (`showHierarchicalMenu`):
 *    - 逐级显示目录和代码片段
 *    - 可以进入目录查看子项
 *    - 支持返回上级目录
 *    - 更接近真实的文件夹浏览体验
 * 
 * ## 功能特性
 * - 兼容V1和V2存储格式
 * - 自动检测数据格式并适配
 * - 支持目录和代码片段的排序
 * - 提供代码预览功能
 * - 错误处理和用户友好的提示
 * 
 * ## 使用示例
 * ```typescript
 * const contextMenuManager = new ContextMenuManager(storageManager, storageContext)
 * 
 * // 显示扁平菜单
 * const snippet = await contextMenuManager.showSnippetPicker()
 * 
 * // 显示分层菜单
 * const snippet = await contextMenuManager.showHierarchicalMenu()
 * ```
 * 
 * @author StarCode000
 * @since 0.4.5
 */
export class ContextMenuManager {
  private storageManager: StorageManager
  private storageContext: StorageContext
  private menuItems: MenuItemData[] = []
  private isV2Format: boolean = false

  constructor(storageManager: StorageManager, storageContext: StorageContext) {
    this.storageManager = storageManager
    this.storageContext = storageContext
  }

  /**
   * 生成菜单项数据
   */
  async generateMenuItems(): Promise<MenuItemData[]> {
    try {
      // 获取所有数据
      const [snippets, directories] = await Promise.all([
        this.storageManager.getAllSnippets(),
        this.storageManager.getAllDirectories()
      ])

      // 检测数据格式
      this.isV2Format = snippets.length > 0 ? 'fullPath' in snippets[0] : 
                       directories.length > 0 ? 'fullPath' in directories[0] : 
                       this.storageContext.getCurrentStorageVersion() === 'v2'

      // 构建菜单树
      this.menuItems = this.buildMenuTree(snippets, directories)
      
      return this.menuItems
    } catch (error) {
      console.error('生成菜单项失败:', error)
      return []
    }
  }

  /**
   * 构建菜单树结构
   */
  private buildMenuTree(snippets: CodeSnippet[], directories: Directory[]): MenuItemData[] {
    if (this.isV2Format) {
      return this.buildV2MenuTree(snippets, directories)
    } else {
      return this.buildV1MenuTree(snippets, directories)
    }
  }

  /**
   * 构建V2格式的菜单树（基于路径）
   */
  private buildV2MenuTree(snippets: CodeSnippet[], directories: Directory[]): MenuItemData[] {
    const menuItems: MenuItemData[] = []
    const pathMap = new Map<string, MenuItemData>()

    // 标准化路径
    const normalizeV2Path = (path: string): string => {
      if (!path || path === '/') {
        return '/'
      }
      
      let normalized = path
      if (!normalized.startsWith('/')) {
        normalized = '/' + normalized
      }
      if (!normalized.endsWith('/')) {
        normalized = normalized + '/'
      }
      
      return normalized
    }

    // 首先处理所有目录
    directories.forEach(directory => {
      const fullPath = normalizeV2Path((directory as any).fullPath)
      const pathParts = fullPath.split('/').filter((p: string) => p.length > 0)
      
      const menuItem: MenuItemData = {
        id: PathBasedManager.generateIdFromPath(fullPath),
        label: directory.name,
        directory: directory,
        children: [],
        isDirectory: true,
        fullPath: fullPath,
        parentPath: pathParts.length > 1 ? 
          '/' + pathParts.slice(0, -1).join('/') + '/' : 
          '/'
      }
      
      pathMap.set(fullPath, menuItem)
    })

    // 然后处理所有代码片段
    snippets.forEach(snippet => {
      const fullPath = (snippet as any).fullPath
      if (!fullPath) {
        return // 跳过没有fullPath的代码片段
      }
      const pathParts = fullPath.split('/').filter((p: string) => p.length > 0)
      const parentPath = pathParts.length > 1 ? 
        '/' + pathParts.slice(0, -1).join('/') + '/' : 
        '/'

      const menuItem: MenuItemData = {
        id: PathBasedManager.generateIdFromPath(fullPath),
        label: snippet.name,
        snippet: snippet,
        isDirectory: false,
        fullPath: fullPath,
        parentPath: parentPath
      }

      pathMap.set(fullPath, menuItem)
    })

    // 构建树形结构
    pathMap.forEach(item => {
      if (item.parentPath === '/') {
        // 根级别项目
        menuItems.push(item)
      } else {
        // 子项目
        const parent = pathMap.get(item.parentPath || '/')
        if (parent && parent.children) {
          parent.children.push(item)
        } else {
          // 如果找不到父级，放到根级别
          menuItems.push(item)
        }
      }
    })

    return this.sortMenuItems(menuItems)
  }

  /**
   * 构建V1格式的菜单树（基于ID）
   */
  private buildV1MenuTree(snippets: CodeSnippet[], directories: Directory[]): MenuItemData[] {
    const menuItems: MenuItemData[] = []
    const idMap = new Map<string, MenuItemData>()

    // 处理所有目录
    directories.forEach(directory => {
      const menuItem: MenuItemData = {
        id: (directory as any).id,
        label: directory.name,
        directory: directory,
        children: [],
        isDirectory: true
      }
      
      idMap.set((directory as any).id, menuItem)
    })

    // 处理所有代码片段
    snippets.forEach(snippet => {
      const menuItem: MenuItemData = {
        id: (snippet as any).id,
        label: snippet.name,
        snippet: snippet,
        isDirectory: false
      }

      idMap.set((snippet as any).id, menuItem)
    })

    // 构建树形结构
    idMap.forEach(item => {
      if (item.directory) {
        const parentId = (item.directory as any).parentId
        if (!parentId) {
          // 根级别目录
          menuItems.push(item)
        } else {
          // 子目录
          const parent = idMap.get(parentId)
          if (parent && parent.children) {
            parent.children.push(item)
          } else {
            // 如果找不到父级，放到根级别
            menuItems.push(item)
          }
        }
      } else if (item.snippet) {
        const parentId = (item.snippet as any).parentId
        if (!parentId) {
          // 根级别代码片段
          menuItems.push(item)
        } else {
          // 目录下的代码片段
          const parent = idMap.get(parentId)
          if (parent && parent.children) {
            parent.children.push(item)
          } else {
            // 如果找不到父级，放到根级别
            menuItems.push(item)
          }
        }
      }
    })

    return this.sortMenuItems(menuItems)
  }

  /**
   * 递归排序菜单项
   */
  private sortMenuItems(items: MenuItemData[]): MenuItemData[] {
    // 按类型和顺序排序：目录在前，代码片段在后
    items.sort((a, b) => {
      // 目录优先
      if (a.isDirectory && !b.isDirectory) {
        return -1
      }
      if (!a.isDirectory && b.isDirectory) {
        return 1
      }
      
      // 同类型按名称排序
      return a.label.localeCompare(b.label)
    })

    // 递归排序子项
    items.forEach(item => {
      if (item.children && item.children.length > 0) {
        item.children = this.sortMenuItems(item.children)
      }
    })

    return items
  }

  /**
   * 将菜单项转换为QuickPick项
   */
  convertToQuickPickItems(items: MenuItemData[], level: number = 0): vscode.QuickPickItem[] {
    const quickPickItems: vscode.QuickPickItem[] = []
    const indent = '  '.repeat(level)

    items.forEach(item => {
      if (item.isDirectory) {
        // 目录项
        quickPickItems.push({
          label: `${indent}📁 ${item.label}`,
          description: '目录',
          detail: item.directory ? `包含 ${(item.children || []).length} 个项目` : undefined,
          kind: vscode.QuickPickItemKind.Separator
        })

        // 递归添加子项
        if (item.children && item.children.length > 0) {
          quickPickItems.push(...this.convertToQuickPickItems(item.children, level + 1))
        }
      } else {
        // 代码片段项
        const snippet = item.snippet!
        quickPickItems.push({
          label: `${indent}📄 ${item.label}`,
          description: snippet.language || 'plaintext',
          detail: snippet.code.length > 100 ? 
            snippet.code.substring(0, 100) + '...' : 
            snippet.code,
          // 将snippet数据附加到item上，用于后续处理
          ...(snippet as any)
        })
      }
    })

    return quickPickItems
  }

  /**
   * 显示代码片段选择器
   */
  async showSnippetPicker(): Promise<CodeSnippet | undefined> {
    try {
      // 生成菜单项
      const menuItems = await this.generateMenuItems()
      
      if (menuItems.length === 0) {
        vscode.window.showInformationMessage('没有可用的代码片段')
        return undefined
      }

      // 转换为QuickPick项
      const quickPickItems = this.convertToQuickPickItems(menuItems)
      
      // 过滤掉目录分隔符，只保留代码片段
      const snippetItems = quickPickItems.filter(item => 
        item.kind !== vscode.QuickPickItemKind.Separator
      )

      if (snippetItems.length === 0) {
        vscode.window.showInformationMessage('没有可用的代码片段')
        return undefined
      }

      // 显示选择器
      const selectedItem = await vscode.window.showQuickPick(snippetItems, {
        placeHolder: '选择要粘贴的代码片段',
        matchOnDescription: true,
        matchOnDetail: true
      })

      if (selectedItem) {
        // 从选中的项目中提取代码片段数据
        // 由于我们将snippet数据附加到了quickPickItem上，可以直接使用
        const snippet = selectedItem as any as CodeSnippet
        return snippet
      }

      return undefined
    } catch (error) {
      console.error('显示代码片段选择器失败:', error)
      vscode.window.showErrorMessage(`显示代码片段选择器失败: ${error}`)
      return undefined
    }
  }

  /**
   * 创建分层菜单（更接近真正的树形菜单）
   */
  async showHierarchicalMenu(): Promise<CodeSnippet | undefined> {
    try {
      const menuItems = await this.generateMenuItems()
      
      if (menuItems.length === 0) {
        vscode.window.showInformationMessage('没有可用的代码片段')
        return undefined
      }

      return await this.showMenuLevel(menuItems, '选择代码片段')
    } catch (error) {
      console.error('显示分层菜单失败:', error)
      vscode.window.showErrorMessage(`显示分层菜单失败: ${error}`)
      return undefined
    }
  }

  /**
   * 递归显示菜单层级
   */
  private async showMenuLevel(items: MenuItemData[], title: string): Promise<CodeSnippet | undefined> {
    const quickPickItems: (vscode.QuickPickItem & { menuData?: MenuItemData })[] = []

    // 添加返回上级选项（如果不是根级别）
    if (title !== '选择代码片段') {
      quickPickItems.push({
        label: '$(arrow-left) 返回上级',
        description: '',
        menuData: undefined
      })
    }

    // 添加当前级别的项目
    items.forEach(item => {
      if (item.isDirectory) {
        quickPickItems.push({
          label: `$(folder) ${item.label}`,
          description: `包含 ${(item.children || []).length} 个项目`,
          menuData: item
        })
      } else {
        const snippet = item.snippet!
        quickPickItems.push({
          label: `$(file-code) ${item.label}`,
          description: snippet.language || 'plaintext',
          detail: snippet.code.length > 100 ? 
            snippet.code.substring(0, 100) + '...' : 
            snippet.code,
          menuData: item
        })
      }
    })

    const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
      placeHolder: title,
      matchOnDescription: true,
      matchOnDetail: true
    })

    if (!selectedItem) {
      return undefined
    }

    // 处理返回上级
    if (selectedItem.label.includes('返回上级')) {
      return undefined // 返回上级，让调用者处理
    }

    const menuData = selectedItem.menuData
    if (!menuData) {
      return undefined
    }

    if (menuData.isDirectory) {
      // 进入子目录
      if (menuData.children && menuData.children.length > 0) {
        return await this.showMenuLevel(menuData.children, `${menuData.label} 中的代码片段`)
      } else {
        vscode.window.showInformationMessage(`目录 "${menuData.label}" 为空`)
        return await this.showMenuLevel(items, title) // 重新显示当前级别
      }
    } else {
      // 选择了代码片段
      return menuData.snippet
    }
  }
} 