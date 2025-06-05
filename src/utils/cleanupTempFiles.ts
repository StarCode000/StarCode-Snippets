import * as fs from 'fs'
import * as path from 'path'
import { SettingsManager } from './settingsManager'

/**
 * 清理错误生成的Gitee临时凭据文件
 * 这些文件是由于之前版本中的bug而产生的
 */
export class TempFilesCleaner {
  
  /**
   * 清理本地Git仓库中的临时凭据文件
   */
  public static async cleanupGiteeCredFiles(): Promise<{
    success: boolean;
    message: string;
    deletedFiles: string[];
  }> {
    const deletedFiles: string[] = []
    
    try {
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      
      if (!fs.existsSync(effectiveLocalPath)) {
        return {
          success: true,
          message: '本地Git仓库目录不存在，无需清理',
          deletedFiles: []
        }
      }
      
      // 读取目录中的所有文件
      const files = fs.readdirSync(effectiveLocalPath)
      
      // 查找匹配的临时凭据文件
      const tempCredFiles = files.filter(file => 
        file.startsWith('UsersstarAppDataLocalTempgitee-cred-') && 
        file.endsWith('.txt')
      )
      
      if (tempCredFiles.length === 0) {
        return {
          success: true,
          message: '没有发现需要清理的临时凭据文件',
          deletedFiles: []
        }
      }
      
      // 删除找到的临时文件
      for (const file of tempCredFiles) {
        try {
          const filePath = path.join(effectiveLocalPath, file)
          fs.unlinkSync(filePath)
          deletedFiles.push(file)
          console.log(`已删除临时凭据文件: ${file}`)
        } catch (deleteError) {
          console.warn(`删除文件失败 ${file}:`, deleteError)
        }
      }
      
      return {
        success: true,
        message: `成功清理 ${deletedFiles.length} 个临时凭据文件`,
        deletedFiles
      }
      
    } catch (error) {
      console.error('清理临时凭据文件失败:', error)
      return {
        success: false,
        message: `清理失败: ${error instanceof Error ? error.message : '未知错误'}`,
        deletedFiles
      }
    }
  }
  
  /**
   * 检查是否存在需要清理的临时文件
   */
  public static async checkNeedCleanup(): Promise<{
    needCleanup: boolean;
    fileCount: number;
    files: string[];
  }> {
    try {
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      
      if (!fs.existsSync(effectiveLocalPath)) {
        return {
          needCleanup: false,
          fileCount: 0,
          files: []
        }
      }
      
      const files = fs.readdirSync(effectiveLocalPath)
      const tempCredFiles = files.filter(file => 
        file.startsWith('UsersstarAppDataLocalTempgitee-cred-') && 
        file.endsWith('.txt')
      )
      
      return {
        needCleanup: tempCredFiles.length > 0,
        fileCount: tempCredFiles.length,
        files: tempCredFiles
      }
      
    } catch (error) {
      console.error('检查临时文件失败:', error)
      return {
        needCleanup: false,
        fileCount: 0,
        files: []
      }
    }
  }
  
  /**
   * 获取临时文件的详细信息
   */
  public static async getTempFilesInfo(): Promise<{
    files: Array<{
      name: string;
      size: number;
      modifiedTime: Date;
      path: string;
    }>;
    totalSize: number;
  }> {
    const fileInfos: Array<{
      name: string;
      size: number;
      modifiedTime: Date;
      path: string;
    }> = []
    
    try {
      const effectiveLocalPath = SettingsManager.getEffectiveLocalPath()
      
      if (!fs.existsSync(effectiveLocalPath)) {
        return { files: fileInfos, totalSize: 0 }
      }
      
      const files = fs.readdirSync(effectiveLocalPath)
      const tempCredFiles = files.filter(file => 
        file.startsWith('UsersstarAppDataLocalTempgitee-cred-') && 
        file.endsWith('.txt')
      )
      
      let totalSize = 0
      
      for (const file of tempCredFiles) {
        try {
          const filePath = path.join(effectiveLocalPath, file)
          const stats = fs.statSync(filePath)
          
          fileInfos.push({
            name: file,
            size: stats.size,
            modifiedTime: stats.mtime,
            path: filePath
          })
          
          totalSize += stats.size
        } catch (statError) {
          console.warn(`获取文件信息失败 ${file}:`, statError)
        }
      }
      
      return { files: fileInfos, totalSize }
      
    } catch (error) {
      console.error('获取临时文件信息失败:', error)
      return { files: fileInfos, totalSize: 0 }
    }
  }
} 