import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/**
 * 简化版权限诊断
 */
export async function diagnoseConfigPermissions(): Promise<void> {
  try {
    console.log('开始简化版权限诊断...')
    
    // 获取VSCode设置文件路径
    const settingsPath = getVSCodeSettingsPath()
    console.log('设置文件路径:', settingsPath)
    
    let message = '🔍 VSCode配置文件权限诊断结果:\n\n'
    message += `📁 设置文件路径: ${settingsPath}\n`
    
    // 检查文件是否存在
    const exists = fs.existsSync(settingsPath)
    message += `✅ 文件存在: ${exists ? '是' : '否'}\n`
    
    const suggestions: string[] = []
    
    if (exists) {
      // 检查读取权限
      try {
        fs.accessSync(settingsPath, fs.constants.R_OK)
        message += `📖 可读取: 是\n`
      } catch {
        message += `📖 可读取: 否\n`
        suggestions.push('设置文件无法读取，可能需要管理员权限')
      }
      
      // 检查写入权限
      try {
        fs.accessSync(settingsPath, fs.constants.W_OK)
        message += `✏️ 可写入: 是\n`
      } catch {
        message += `✏️ 可写入: 否\n`
        suggestions.push('设置文件无法写入，建议以管理员身份运行VSCode')
      }
      
      // 检查文件是否被锁定
      const locked = await checkIfFileLocked(settingsPath)
      message += `🔒 文件被锁定: ${locked ? '是' : '否'}\n`
      if (locked) {
        suggestions.push('设置文件被其他程序占用，请关闭其他可能访问该文件的程序')
      }
    } else {
      suggestions.push('VSCode设置文件不存在，将在首次保存时创建')
    }
    
    // Windows平台检查管理员权限
    if (process.platform === 'win32') {
      const isAdmin = await checkIfRunAsAdmin()
      message += `👑 管理员权限: ${isAdmin ? '是' : '否'}\n`
      
      if (!isAdmin) {
        suggestions.push('建议以管理员身份重新启动VSCode')
      }
    }
    
    if (suggestions.length > 0) {
      message += '\n💡 建议解决方案:\n'
      suggestions.forEach((suggestion, index) => {
        message += `${index + 1}. ${suggestion}\n`
      })
    } else {
      message += '\n✅ 未发现权限问题'
    }
    
    // 显示结果
    const actions = ['重试保存配置', '以管理员身份重启', '关闭']
    const selection = await vscode.window.showInformationMessage(
      message,
      { modal: true },
      ...actions
    )
    
    if (selection === '重试保存配置') {
      vscode.window.showInformationMessage('请返回设置页面重新尝试保存配置')
    } else if (selection === '以管理员身份重启') {
      vscode.window.showInformationMessage(
        '请关闭VSCode，然后右键点击VSCode图标选择"以管理员身份运行"'
      )
    }
    
  } catch (error) {
    console.error('诊断过程中发生错误:', error)
    vscode.window.showErrorMessage(`诊断失败: ${error}`)
  }
}

/**
 * 获取VSCode设置文件路径
 */
function getVSCodeSettingsPath(): string {
  const userHome = os.homedir()
  
  switch (process.platform) {
    case 'win32':
      return path.join(userHome, 'AppData', 'Roaming', 'Code', 'User', 'settings.json')
    case 'darwin':
      return path.join(userHome, 'Library', 'Application Support', 'Code', 'User', 'settings.json')
    case 'linux':
      return path.join(userHome, '.config', 'Code', 'User', 'settings.json')
    default:
      return path.join(userHome, '.vscode', 'settings.json')
  }
}

/**
 * 检查文件是否被锁定
 */
async function checkIfFileLocked(filePath: string): Promise<boolean> {
  try {
    const fd = fs.openSync(filePath, 'r+')
    fs.closeSync(fd)
    return false
  } catch (error: any) {
    if (error.code === 'EBUSY' || error.code === 'EACCES') {
      return true
    }
    return false
  }
}

/**
 * 检查是否以管理员身份运行（仅Windows）
 */
async function checkIfRunAsAdmin(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return false
  }
  
  try {
    const { exec } = require('child_process')
    return new Promise((resolve) => {
      exec('net session >nul 2>&1', (error: any) => {
        resolve(error === null)
      })
    })
  } catch {
    return false
  }
}

/**
 * 注册简化版诊断命令
 */
export function registerDiagnoseConfigPermissionsCommand(context: vscode.ExtensionContext) {
  const command = vscode.commands.registerCommand(
    'starcode-snippets.diagnoseConfigPermissions',
    diagnoseConfigPermissions
  )
  
  context.subscriptions.push(command)
} 