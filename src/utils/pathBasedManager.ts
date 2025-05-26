import * as crypto from 'crypto';
import { 
  CodeSnippetV1, 
  DirectoryV1, 
  CodeSnippetV2, 
  DirectoryV2,
  ExportDataV1,
  ExportDataV2,
  ExportData
} from '../models/types';

/**
 * 基于路径的目录结构管理器
 * 用于处理V1（基于ID）和V2（基于路径）之间的转换
 */
export class PathBasedManager {
  
  /**
   * 将V1格式的代码片段转换为V2格式
   */
  static convertSnippetV1ToV2(snippetV1: CodeSnippetV1, directoriesV1: DirectoryV1[]): CodeSnippetV2 {
    const fullPath = this.generateFullPathFromV1(snippetV1, directoriesV1);
    
    return {
      name: snippetV1.name,
      code: snippetV1.code,
      filePath: snippetV1.filePath,
      fileName: snippetV1.fileName,
      category: snippetV1.category,
      fullPath: fullPath,
      order: snippetV1.order,
      createTime: snippetV1.createTime,
      language: snippetV1.language
    };
  }

  /**
   * 将V2格式的代码片段转换为V1格式
   */
  static convertSnippetV2ToV1(snippetV2: CodeSnippetV2, directoriesV1: DirectoryV1[]): CodeSnippetV1 {
    const parentId = this.findParentIdFromPath(snippetV2.fullPath, directoriesV1);
    
    return {
      id: this.generateIdFromPath(snippetV2.fullPath),
      name: snippetV2.name,
      code: snippetV2.code,
      filePath: snippetV2.filePath,
      fileName: snippetV2.fileName,
      category: snippetV2.category,
      parentId: parentId,
      order: snippetV2.order,
      createTime: snippetV2.createTime,
      language: snippetV2.language
    };
  }

  /**
   * 将V1格式的目录转换为V2格式
   */
  static convertDirectoryV1ToV2(directoryV1: DirectoryV1, directoriesV1: DirectoryV1[]): DirectoryV2 {
    const fullPath = this.generateFullPathFromV1(directoryV1, directoriesV1);
    
    return {
      name: directoryV1.name,
      fullPath: fullPath,
      order: directoryV1.order
    };
  }

  /**
   * 将V2格式的目录转换为V1格式
   */
  static convertDirectoryV2ToV1(directoryV2: DirectoryV2, directoriesV1: DirectoryV1[]): DirectoryV1 {
    const parentId = this.findParentIdFromPath(directoryV2.fullPath, directoriesV1);
    
    return {
      id: this.generateIdFromPath(directoryV2.fullPath),
      name: directoryV2.name,
      parentId: parentId,
      order: directoryV2.order
    };
  }

  /**
   * 从V1格式生成完整路径
   */
  static generateFullPathFromV1(item: CodeSnippetV1 | DirectoryV1, directories: DirectoryV1[]): string {
    if (!item.parentId) {
      // 根级别项目
      if ('code' in item) {
        // 代码片段
        return `/${item.name}`;
      } else {
        // 目录
        return `/${item.name}/`;
      }
    }

    // 递归构建路径
    const parent = directories.find(d => d.id === item.parentId);
    if (!parent) {
      // 找不到父目录，当作根级别处理
      if ('code' in item) {
        return `/${item.name}`;
      } else {
        return `/${item.name}/`;
      }
    }

    const parentPath = this.generateFullPathFromV1(parent, directories);
    if ('code' in item) {
      // 代码片段
      return `${parentPath}${item.name}`;
    } else {
      // 目录
      return `${parentPath}${item.name}/`;
    }
  }

  /**
   * 从路径查找对应的父目录ID
   */
  static findParentIdFromPath(fullPath: string, directories: DirectoryV1[]): string | null {
    // 移除开头和结尾的斜杠
    const cleanPath = fullPath.replace(/^\/+|\/+$/g, '');
    const pathParts = cleanPath.split('/');
    
    if (pathParts.length <= 1) {
      return null; // 根级别
    }

    // 构建父目录路径
    const parentPathParts = pathParts.slice(0, -1);
    const parentPath = '/' + parentPathParts.join('/') + '/';

    // 查找匹配的目录
    for (const dir of directories) {
      const dirPath = this.generateFullPathFromV1(dir, directories);
      if (dirPath === parentPath) {
        return dir.id;
      }
    }

    return null;
  }

  /**
   * 从路径生成唯一ID
   */
  static generateIdFromPath(path: string): string {
    return crypto.createHash('md5').update(path).digest('hex');
  }

  /**
   * 从路径提取目录结构
   */
  static extractDirectoriesFromPaths(paths: string[]): DirectoryV2[] {
    const directoriesSet = new Set<string>();
    
    // 收集所有目录路径
    for (const path of paths) {
      const cleanPath = path.replace(/^\/+|\/+$/g, '');
      const pathParts = cleanPath.split('/');
      
      // 为每个层级创建目录路径
      for (let i = 1; i < pathParts.length; i++) {
        const dirPath = '/' + pathParts.slice(0, i).join('/') + '/';
        directoriesSet.add(dirPath);
      }
    }

    // 转换为DirectoryV2数组
    const directories: DirectoryV2[] = [];
    for (const dirPath of directoriesSet) {
      const pathParts = dirPath.replace(/^\/+|\/+$/g, '').split('/');
      const dirName = pathParts[pathParts.length - 1];
      
      directories.push({
        name: dirName,
        fullPath: dirPath,
        order: 0
      });
    }

    // 按路径深度排序
    directories.sort((a, b) => {
      const aDepth = (a.fullPath.match(/\//g) || []).length;
      const bDepth = (b.fullPath.match(/\//g) || []).length;
      if (aDepth !== bDepth) {
        return aDepth - bDepth;
      }
      return a.fullPath.localeCompare(b.fullPath);
    });

    return directories;
  }

  /**
   * 创建目录结构（V2格式）
   */
  static createDirectoryStructureV2(snippets: CodeSnippetV2[]): DirectoryV2[] {
    const paths = snippets.map(s => s.fullPath);
    return this.extractDirectoriesFromPaths(paths);
  }

  /**
   * 验证导出数据
   */
  static validateExportData(data: any): { isValid: boolean; version?: string; error?: string } {
    if (!data || typeof data !== 'object') {
      return { isValid: false, error: '无效的导出数据' };
    }

    if (!data.version || !data.exportDate) {
      return { isValid: false, error: '缺少版本或导出日期' };
    }

    if (!Array.isArray(data.directories) || !Array.isArray(data.snippets)) {
      return { isValid: false, error: '缺少目录或代码片段数据' };
    }

    // 检查版本
    if (data.version === '1.0.0') {
      // 验证V1格式
      return { isValid: true, version: 'v1' };
    } else if (data.version === '2.0.0') {
      // 验证V2格式
      return { isValid: true, version: 'v2' };
    }

    return { isValid: false, error: '不支持的版本' };
  }

  /**
   * 将V1数据转换为V2数据
   */
  static convertExportDataV1ToV2(dataV1: ExportDataV1): ExportDataV2 {
    const directoriesV2: DirectoryV2[] = [];
    const snippetsV2: CodeSnippetV2[] = [];

    // 先转换目录
    for (const dirV1 of dataV1.directories) {
      directoriesV2.push(this.convertDirectoryV1ToV2(dirV1, dataV1.directories));
    }

    // 再转换代码片段
    for (const snippetV1 of dataV1.snippets) {
      snippetsV2.push(this.convertSnippetV1ToV2(snippetV1, dataV1.directories));
    }

    return {
      version: '2.0.0',
      exportDate: dataV1.exportDate,
      directories: directoriesV2,
      snippets: snippetsV2
    };
  }

  /**
   * 将V2数据转换为V1数据
   */
  static convertExportDataV2ToV1(dataV2: ExportDataV2): ExportDataV1 {
    // 首先创建空的V1目录结构，为了生成ID
    const emptyV1Directories: DirectoryV1[] = dataV2.directories.map(dir => ({
      id: this.generateIdFromPath(dir.fullPath),
      name: dir.name,
      parentId: null, // 临时值
      order: dir.order
    }));
    
    // 设置正确的parentId关系
    for (const dirV1 of emptyV1Directories) {
      const dirV2 = dataV2.directories.find(d => this.generateIdFromPath(d.fullPath) === dirV1.id);
      if (dirV2) {
        dirV1.parentId = this.findParentIdFromPath(dirV2.fullPath, emptyV1Directories);
      }
    }
    
    // 转换代码片段
    const snippetsV1 = dataV2.snippets.map(snippet => 
      this.convertSnippetV2ToV1(snippet, emptyV1Directories)
    );

    return {
      version: '1.0.0',
      exportDate: dataV2.exportDate,
      directories: emptyV1Directories,
      snippets: snippetsV1
    };
  }
  
  /**
   * 批量将V1数据转换为V2数据
   */
  static convertToV2(snippetsV1: CodeSnippetV1[], directoriesV1: DirectoryV1[]): { 
    snippets: CodeSnippetV2[], 
    directories: DirectoryV2[] 
  } {
    const directoriesV2: DirectoryV2[] = [];
    const snippetsV2: CodeSnippetV2[] = [];

    // 先转换目录
    for (const dirV1 of directoriesV1) {
      directoriesV2.push(this.convertDirectoryV1ToV2(dirV1, directoriesV1));
    }

    // 再转换代码片段
    for (const snippetV1 of snippetsV1) {
      snippetsV2.push(this.convertSnippetV1ToV2(snippetV1, directoriesV1));
    }

    return {
      directories: directoriesV2,
      snippets: snippetsV2
    };
  }

  /**
   * 批量将V2数据转换为V1数据
   */
  static convertToV1(snippetsV2: CodeSnippetV2[], directoriesV2: DirectoryV2[]): { 
    snippets: CodeSnippetV1[], 
    directories: DirectoryV1[] 
  } {
    // 首先创建空的V1目录结构，为了生成ID
    const emptyV1Directories: DirectoryV1[] = directoriesV2.map(dir => ({
      id: this.generateIdFromPath(dir.fullPath),
      name: dir.name,
      parentId: null, // 临时值
      order: dir.order
    }));
    
    // 设置正确的parentId关系
    for (const dirV1 of emptyV1Directories) {
      const dirV2 = directoriesV2.find(d => this.generateIdFromPath(d.fullPath) === dirV1.id);
      if (dirV2) {
        dirV1.parentId = this.findParentIdFromPath(dirV2.fullPath, emptyV1Directories);
      }
    }
    
    // 转换代码片段
    const snippetsV1 = snippetsV2.map(snippet => 
      this.convertSnippetV2ToV1(snippet, emptyV1Directories)
    );

    return {
      directories: emptyV1Directories,
      snippets: snippetsV1
    };
  }
} 