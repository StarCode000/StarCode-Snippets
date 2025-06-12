const fs = require('fs')
const path = require('path')
const https = require('https')
const { execSync } = require('child_process')

/**
 * 下载Monaco Editor到本地
 */
async function downloadMonacoEditor() {
  const monacoVersion = '0.50.0' // 使用稳定版本
  const targetDir = path.join(__dirname, '..', 'media', 'monaco-editor')
  const tempDir = path.join(__dirname, '..', 'temp-monaco')
  
  console.log('🚀 开始下载Monaco Editor...')
  console.log(`版本: ${monacoVersion}`)
  console.log(`目标目录: ${targetDir}`)
  
  try {
    // 清理旧文件
    if (fs.existsSync(targetDir)) {
      console.log('🧹 清理旧的Monaco Editor文件...')
      fs.rmSync(targetDir, { recursive: true, force: true })
    }
    
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    
    // 创建临时目录
    fs.mkdirSync(tempDir, { recursive: true })
    
    console.log('📦 下载Monaco Editor包...')
    
    // 使用npm来下载monaco-editor包
    process.chdir(tempDir)
    execSync(`npm init -y`, { stdio: 'pipe' })
    execSync(`npm install monaco-editor@${monacoVersion}`, { stdio: 'pipe' })
    
    // 复制必要的文件到目标目录
    const srcPath = path.join(tempDir, 'node_modules', 'monaco-editor')
    
    console.log('📁 复制Monaco Editor文件...')
    
    // 创建目标目录结构
    fs.mkdirSync(targetDir, { recursive: true })
    
    // 复制核心文件
    const filesToCopy = [
      'min/vs/loader.js',
      'min/vs/editor/editor.main.js',
      'min/vs/editor/editor.main.css',
      'min/vs/editor/editor.main.nls.js',
      'min/vs/base/worker/workerMain.js',
      'min/vs/basic-languages',
      'min/vs/language'
    ]
    
    for (const file of filesToCopy) {
      const srcFile = path.join(srcPath, file)
      const destFile = path.join(targetDir, file)
      
      if (fs.existsSync(srcFile)) {
        // 确保目标目录存在
        fs.mkdirSync(path.dirname(destFile), { recursive: true })
        
        if (fs.statSync(srcFile).isDirectory()) {
          // 如果是目录，递归复制
          copyDir(srcFile, destFile)
        } else {
          // 如果是文件，直接复制
          fs.copyFileSync(srcFile, destFile)
        }
        console.log(`✅ 复制: ${file}`)
      } else {
        console.log(`⚠️ 文件不存在: ${file}`)
      }
    }
    
    // 创建一个简化的package.json用于版本信息
    const packageInfo = {
      name: 'monaco-editor-local',
      version: monacoVersion,
      description: 'Local copy of Monaco Editor for StarCode Snippets',
      main: 'min/vs/loader.js'
    }
    
    fs.writeFileSync(
      path.join(targetDir, 'package.json'), 
      JSON.stringify(packageInfo, null, 2)
    )
    
    // 清理临时目录
    console.log('🧹 清理临时文件...')
    process.chdir(path.join(__dirname, '..'))
    fs.rmSync(tempDir, { recursive: true, force: true })
    
    console.log('✨ Monaco Editor下载完成!')
    console.log(`📍 安装位置: ${targetDir}`)
    
    // 检查关键文件是否存在
    const keyFiles = [
      'min/vs/loader.js',
      'min/vs/editor/editor.main.js',
      'min/vs/base/worker/workerMain.js'
    ]
    
    console.log('\n🔍 验证关键文件:')
    for (const file of keyFiles) {
      const filePath = path.join(targetDir, file)
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath)
        console.log(`✅ ${file} (${(stats.size / 1024).toFixed(1)}KB)`)
      } else {
        console.log(`❌ ${file} - 缺失!`)
      }
    }
    
  } catch (error) {
    console.error('❌ 下载Monaco Editor失败:', error.message)
    
    // 清理可能的部分文件
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true })
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    
    process.exit(1)
  }
}

/**
 * 递归复制目录
 */
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true })
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  downloadMonacoEditor()
} 