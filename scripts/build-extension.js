#!/usr/bin/env node

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

/**
 * 优化Monaco Editor，只保留常用语言
 */
async function optimizeMonacoEditor(monacoPath) {
  const basicLanguagesPath = path.join(monacoPath, 'min', 'vs', 'basic-languages')
  
  if (!fs.existsSync(basicLanguagesPath)) {
    console.log('⚠️ basic-languages 目录不存在，跳过优化')
    return
  }

  // 保留的常用语言列表
  const keepLanguages = [
    'javascript', 'typescript', 'json', 'html', 'css', 'scss', 'less',
    'python', 'java', 'csharp', 'cpp', 'go', 'rust', 'php', 'ruby',
    'sql', 'mysql', 'pgsql', 'yaml', 'xml', 'markdown', 'shell',
    'dockerfile', 'kotlin', 'swift', 'scala', 'lua', 'perl', 'r'
  ]

  // 获取所有语言目录
  const allLanguages = fs.readdirSync(basicLanguagesPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)

  let removedCount = 0
  
  // 移除不在保留列表中的语言
  for (const lang of allLanguages) {
    if (!keepLanguages.includes(lang)) {
      const langPath = path.join(basicLanguagesPath, lang)
      try {
        fs.rmSync(langPath, { recursive: true, force: true })
        removedCount++
      } catch (error) {
        console.warn(`⚠️ 移除语言包 ${lang} 失败:`, error.message)
      }
    }
  }

  console.log(`✅ Monaco 优化完成，保留 ${keepLanguages.length} 种语言，移除 ${removedCount} 种不常用语言`)
}

/**
 * 清理dist目录中的冗余文件
 */
function cleanupDistDirectory() {
  const distPath = path.join(__dirname, '..', 'dist')
  
  if (!fs.existsSync(distPath)) {
    return
  }

  const files = fs.readdirSync(distPath)
  let removedCount = 0

  // 移除webpack生成的worker文件（我们使用Monaco自己的worker）
  const workerPatterns = [
    /.*\.worker\.js$/,
    /.*\.worker\.js\.map$/,
    /.*\.worker\.js\.LICENSE\.txt$/
  ]

  for (const file of files) {
    const shouldRemove = workerPatterns.some(pattern => pattern.test(file))
    
    if (shouldRemove) {
      const filePath = path.join(distPath, file)
      try {
        fs.unlinkSync(filePath)
        removedCount++
        console.log(`🗑️ 移除冗余文件: ${file}`)
      } catch (error) {
        console.warn(`⚠️ 移除文件 ${file} 失败:`, error.message)
      }
    }
  }

  if (removedCount > 0) {
    console.log(`✅ 清理完成，移除 ${removedCount} 个冗余文件`)
  } else {
    console.log('✅ 没有发现需要清理的冗余文件')
  }
}

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
      console.log(`🎨 monaco目录: ${(monacoStats / 1024).toFixed(2)} KB`)
    }
  } catch (error) {
    console.warn('⚠️ 获取统计信息失败:', error.message)
  }
}

/**
 * 主构建函数
 */
async function main() {
  console.log('🚀 开始构建 StarCode Snippets 扩展...')

  try {
    // 1. 清理旧的构建文件
    console.log('📁 清理旧的构建文件...')
    if (fs.existsSync('dist')) {
      fs.rmSync('dist', { recursive: true, force: true })
    }
    if (fs.existsSync('*.vsix')) {
      const vsixFiles = fs.readdirSync('.').filter((file) => file.endsWith('.vsix'))
      vsixFiles.forEach((file) => fs.unlinkSync(file))
    }

    // 2. 检查并下载 Monaco Editor
    const monacoPath = path.join(__dirname, '..', 'media', 'monaco-editor')
    const monacoLoaderPath = path.join(monacoPath, 'min', 'vs', 'loader.js')
    
    if (!fs.existsSync(monacoLoaderPath)) {
      console.log('📦 Monaco Editor 不存在，开始下载...')
      execSync('npm run download-monaco', { stdio: 'inherit' })
      
      // 验证下载是否成功
      if (!fs.existsSync(monacoLoaderPath)) {
        throw new Error('Monaco Editor 下载失败')
      }
      console.log('✅ Monaco Editor 下载完成')
      
      // 下载后立即优化
      console.log('🔧 优化新下载的 Monaco Editor 文件...')
      await optimizeMonacoEditor(monacoPath)
    } else {
      console.log('✅ Monaco Editor 已存在')
      
      // 检查是否已经优化过
      const basicLanguagesPath = path.join(monacoPath, 'min', 'vs', 'basic-languages')
      if (fs.existsSync(basicLanguagesPath)) {
        const languages = fs.readdirSync(basicLanguagesPath, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => dirent.name)
        
        if (languages.length > 35) {
          console.log('🔧 检测到未优化的 Monaco Editor，开始优化...')
          await optimizeMonacoEditor(monacoPath)
        } else {
          console.log('✅ Monaco Editor 已优化，跳过优化步骤')
        }
      }
    }

    // 3. Monaco Editor 已在步骤2中处理

    // 4. 运行 webpack 构建
    console.log('⚙️  运行 webpack 构建...')
    execSync('npm run package', { stdio: 'inherit' })

    // 5. 清理 dist 目录中的冗余文件
    console.log('🧹 清理构建冗余文件...')
    cleanupDistDirectory()

    // 6. 验证构建结果
    console.log('🔍 验证构建结果...')
    const distPath = path.join(__dirname, '..', 'dist', 'extension.js')
    if (!fs.existsSync(distPath)) {
      throw new Error('构建失败：dist/extension.js 不存在')
    }

    const stats = fs.statSync(distPath)
    console.log(`✅ 构建成功！文件大小: ${(stats.size / 1024).toFixed(2)} KB`)

    // 7. 验证 Monaco Editor 文件
    console.log('🔍 验证 Monaco Editor 资源...')
    const keyFiles = [
      'media/monaco-editor/min/vs/loader.js',
      'media/monaco-editor/min/vs/editor/editor.main.js',
      'media/monaco-editor/min/vs/editor/editor.main.css',
      'media/monaco-editor/min/vs/base/worker/workerMain.js'
    ]
    
    for (const file of keyFiles) {
      const filePath = path.join(__dirname, '..', file)
      if (!fs.existsSync(filePath)) {
        throw new Error(`Monaco Editor 关键文件缺失: ${file}`)
      }
    }
    console.log('✅ Monaco Editor 资源验证通过')

    console.log('🎉 扩展构建完成！')
  } catch (error) {
    console.error('❌ 构建失败:', error.message)
    process.exit(1)
  }
}

// 执行主函数
main().catch(error => {
  console.error('❌ 构建过程出错:', error.message)
  process.exit(1)
})
