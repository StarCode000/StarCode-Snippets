import * as vscode from 'vscode'
import { CloudSyncManager } from '../utils/cloudSyncManager'
import { FileSystemManager } from '../utils/sync/fileSystemManager'

/**
 * 测试极简文件存储系统的命令
 * 用于验证新的极简文件存储机制是否正常工作
 */
export async function testRealFileStorageCommand(): Promise<void> {
  try {
    vscode.window.showInformationMessage('🧪 开始测试极简文件存储系统...')
    
    // 创建文件系统管理器实例
    const fileSystemManager = new FileSystemManager()
    
    // 执行测试
    const testResult = await fileSystemManager.testPureFileStorage()
    
    if (testResult.success) {
      vscode.window.showInformationMessage(
        `✅ 极简文件存储系统测试成功！`,
        {
          modal: true,
          detail: testResult.message
        }
      )
    } else {
      vscode.window.showErrorMessage(
        `❌ 极简文件存储系统测试失败`,
        {
          modal: true,
          detail: testResult.message
        }
      )
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误'
    
    vscode.window.showErrorMessage(
      `❌ 测试过程中发生错误: ${errorMessage}`,
      {
        modal: true,
        detail: '请检查控制台输出获取更多详细信息。'
      }
    )
    
    console.error('测试极简文件存储系统时出错:', error)
  }
} 