const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

/**
 * 计算目录大小
 */
function getDirectorySize(dirPath) {
  let totalSize = 0
  
  if (!fs.existsSync(dirPath)) {
    return 0
  }

  function calculateSize(currentPath) {
    const stats = fs.statSync(currentPath)
    
    if (stats.isFile()) {
      totalSize += stats.size
    } else if (stats.isDirectory()) {
      const files = fs.readdirSync(currentPath)
      files.forEach(file => {
        calculateSize(path.join(currentPath, file))
      })
    }
  }

  calculateSize(dirPath)
  return totalSize
}

/**
 * 显示打包统计信息
 */
function showPackageStats() {
  try {
    const vsixFiles = fs.readdirSync('.').filter(file => file.endsWith('.vsix'))
    
    if (vsixFiles.length > 0) {
      const vsixFile = vsixFiles[0]
      const stats = fs.statSync(vsixFile)
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2)
      
      console.log(`\n📊 打包统计:`)
      console.log(`📦 扩展包: ${vsixFile}`)
      console.log(`📏 文件大小: ${sizeMB} MB`)
      
      // 显示目录大小统计
      const distStats = getDirectorySize(path.join(__dirname, '..', 'dist'))
      const monacoStats = getDirectorySize(path.join(__dirname, '..', 'media', 'monaco-editor'))
      
      console.log(`📁 dist目录: ${(distStats / 1024).toFixed(2)} KB`)
      console.log(`🎨 monaco目录: ${(monacoStats / (1024 * 1024)).toFixed(2)} MB`)
    }
  } catch (error) {
    console.warn('⚠️ 获取统计信息失败:', error.message)
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 开始完整构建和打包...')

  try {
    // 1. 执行构建
    console.log('📦 运行构建脚本...')
    execSync('npm run build', { stdio: 'inherit' })

    // 2. 运行 vsce package
    console.log('📦 打包扩展...')
    execSync('vsce package', { stdio: 'inherit' })

    // 3. 显示最终统计信息
    showPackageStats()

    console.log('🎉 完整构建和打包完成！')
  } catch (error) {
    console.error('❌ 构建和打包失败:', error.message)
    process.exit(1)
  }
}

// 执行主函数
main().catch(error => {
  console.error('❌ 过程出错:', error.message)
  process.exit(1)
}) 