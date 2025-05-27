import * as vscode from 'vscode'
import { CodeSnippetV1, DirectoryV1, CodeSnippetV2, DirectoryV2 } from '../types/types'
import { StorageStrategy, V1StorageStrategy, V2StorageStrategy } from './storageStrategy'
import { PathBasedManager } from './pathBasedManager'

/**
 * 存储上下文类
 * 管理当前使用的存储策略，提供统一的接口
 */
export class StorageContext {
  private strategy: StorageStrategy

  constructor(strategy: StorageStrategy) {
    this.strategy = strategy
  }

  /**
   * 设置新的存储策略
   */
  setStrategy(strategy: StorageStrategy): void {
    this.strategy = strategy
  }

  /**
   * 获取当前策略
   */
  getStrategy(): StorageStrategy {
    return this.strategy
  }

  /**
   * 获取当前策略的版本
   */
  getVersion(): string {
    return this.strategy.getVersion()
  }

  /**
   * 获取扩展上下文
   */
  getContext(): vscode.ExtensionContext {
    return this.strategy.getContext()
  }

  // ===== 统一接口方法 =====

  /**
   * 获取所有代码片段
   */
  async getAllSnippets(): Promise<any[]> {
    return this.strategy.getAllSnippets()
  }

  /**
   * 获取所有目录
   */
  async getAllDirectories(): Promise<any[]> {
    return this.strategy.getAllDirectories()
  }

  /**
   * 根据ID获取代码片段
   */
  async getSnippetById(id: string): Promise<any | null> {
    if (this.strategy.getSnippetById) {
      return this.strategy.getSnippetById(id)
    }
    return null
  }

  /**
   * 根据路径获取代码片段（仅V2支持）
   */
  async getSnippetByPath(path: string): Promise<any | null> {
    if (this.strategy.getSnippetByPath) {
      return this.strategy.getSnippetByPath(path)
    }
    return null
  }

  /**
   * 根据ID获取目录
   */
  async getDirectoryById(id: string): Promise<any | null> {
    if (this.strategy.getDirectoryById) {
      return this.strategy.getDirectoryById(id)
    }
    return null
  }

  /**
   * 根据路径获取目录（仅V2支持）
   */
  async getDirectoryByPath(path: string): Promise<any | null> {
    if (this.strategy.getDirectoryByPath) {
      return this.strategy.getDirectoryByPath(path)
    }
    return null
  }

  /**
   * 保存代码片段
   */
  async saveSnippet(snippet: any): Promise<void> {
    await this.strategy.saveSnippet(snippet)
  }

  /**
   * 更新代码片段
   */
  async updateSnippet(snippet: any): Promise<void> {
    await this.strategy.updateSnippet(snippet)
  }

  /**
   * 删除代码片段
   */
  async deleteSnippet(id: string): Promise<void> {
    await this.strategy.deleteSnippet(id)
  }

  /**
   * 创建目录
   */
  async createDirectory(directory: any): Promise<void> {
    await this.strategy.createDirectory(directory)
  }

  /**
   * 更新目录
   */
  async updateDirectory(directory: any): Promise<void> {
    await this.strategy.updateDirectory(directory)
  }

  /**
   * 删除目录
   */
  async deleteDirectory(id: string): Promise<void> {
    await this.strategy.deleteDirectory(id)
  }

  /**
   * 清除缓存
   */
  async clearCache(): Promise<void> {
    await this.strategy.clearCache()
  }

  // ===== 版本转换方法 =====

  /**
   * 将数据从V1格式转换为V2格式
   * @param force 是否强制转换（即使当前已是V2）
   * @param merge 是否合并现有V2数据（默认为true）
   */
  async convertToV2(force: boolean = false, merge: boolean = true): Promise<void> {
    if (this.strategy.getVersion() === 'v1' || force) {
      console.log('开始将数据从V1转换为V2...')

      // 获取V1数据
      const v1Snippets = (await this.strategy.getAllSnippets()) as CodeSnippetV1[]
      const v1Directories = (await this.strategy.getAllDirectories()) as DirectoryV1[]

      console.log(`转换前V1数据统计: ${v1Snippets.length} 个代码片段, ${v1Directories.length} 个目录`)

      // 使用PathBasedManager转换数据
      const { snippets: convertedV2Snippets, directories: convertedV2Directories } = PathBasedManager.convertToV2(
        v1Snippets,
        v1Directories
      )

      console.log(`转换后数据统计: ${convertedV2Snippets.length} 个代码片段, ${convertedV2Directories.length} 个目录`)

      // 创建V2策略并准备保存数据
      const v2Strategy = new V2StorageStrategy(this.strategy.getContext())

      // 检查是否需要合并数据
      if (merge) {
        try {
          // 尝试获取现有的V2数据
          const existingV2Snippets = await v2Strategy.getAllSnippets()
          const existingV2Directories = await v2Strategy.getAllDirectories()

          if (existingV2Snippets.length > 0 || existingV2Directories.length > 0) {
            console.log(
              `发现现有V2数据: ${existingV2Snippets.length} 个代码片段, ${existingV2Directories.length} 个目录`
            )

            // 合并目录 (按fullPath去重)
            const mergedDirectories = [...existingV2Directories]
            for (const dir of convertedV2Directories) {
              if (!mergedDirectories.some((d) => d.fullPath === dir.fullPath)) {
                mergedDirectories.push(dir)
              }
            }

            // 合并代码片段 (按fullPath去重)
            const mergedSnippets = [...existingV2Snippets]
            for (const snippet of convertedV2Snippets) {
              const existingIndex = mergedSnippets.findIndex((s) => s.fullPath === snippet.fullPath)
              if (existingIndex >= 0) {
                // 如果存在同路径的代码片段，保留最新的
                console.log(`发现路径冲突，使用较新的版本: ${snippet.fullPath}`)
                // 判断哪个更新，默认使用v1转换来的数据
                mergedSnippets[existingIndex] = snippet
              } else {
                mergedSnippets.push(snippet)
              }
            }

            console.log(`合并后数据统计: ${mergedSnippets.length} 个代码片段, ${mergedDirectories.length} 个目录`)

            // 保存合并后的V2数据
            await (v2Strategy as any).saveSnippets(mergedSnippets)
            await (v2Strategy as any).saveDirectories(mergedDirectories)
          } else {
            // 没有现有V2数据，直接保存转换后的数据
            await (v2Strategy as any).saveSnippets(convertedV2Snippets)
            await (v2Strategy as any).saveDirectories(convertedV2Directories)
          }
        } catch (error) {
          console.error('合并V2数据失败，使用转换后的数据:', error)
          // 出错时直接使用转换后的数据
          await (v2Strategy as any).saveSnippets(convertedV2Snippets)
          await (v2Strategy as any).saveDirectories(convertedV2Directories)
        }
      } else {
        // 不合并，直接保存转换后的数据
        await (v2Strategy as any).saveSnippets(convertedV2Snippets)
        await (v2Strategy as any).saveDirectories(convertedV2Directories)
      }

      console.log('数据转换完成，切换到V2策略')

      // 切换到V2策略
      this.setStrategy(v2Strategy)
    } else {
      console.log('当前已经是V2格式，无需转换')
    }
  }

  /**
   * 将数据从V2格式转换回V1格式
   * @param force 是否强制转换（即使当前已是V1）
   */
  async convertToV1(force: boolean = false): Promise<void> {
    if (this.strategy.getVersion() === 'v2' || force) {
      console.log('开始将数据从V2转换为V1...')

      // 获取V2数据
      const v2Snippets = (await this.strategy.getAllSnippets()) as CodeSnippetV2[]
      const v2Directories = (await this.strategy.getAllDirectories()) as DirectoryV2[]

      console.log(`转换前数据统计: ${v2Snippets.length} 个代码片段, ${v2Directories.length} 个目录`)

      // 使用PathBasedManager转换数据
      const { snippets: v1Snippets, directories: v1Directories } = PathBasedManager.convertToV1(
        v2Snippets,
        v2Directories
      )

      console.log(`转换后数据统计: ${v1Snippets.length} 个代码片段, ${v1Directories.length} 个目录`)

      // 创建V1策略
      const v1Strategy = new V1StorageStrategy(this.strategy.getContext())

      // 保存所有V1目录
      for (const dir of v1Directories) {
        await v1Strategy.createDirectory(dir)
      }

      // 保存所有V1代码片段
      for (const snippet of v1Snippets) {
        await v1Strategy.saveSnippet(snippet)
      }

      console.log('数据转换完成，切换到V1策略')

      // 切换到V1策略
      this.setStrategy(v1Strategy)
    } else {
      console.log('当前已经是V1格式，无需转换')
    }
  }
}
