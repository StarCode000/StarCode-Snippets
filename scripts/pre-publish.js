#!/usr/bin/env node

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

/**
 * 检查必要文件是否存在
 */
function checkRequiredFiles() {
  console.log('🔍 检查必要文件...')
  
  const requiredFiles = [
    'dist/extension.js',
    'package.json',
    'README.md',
    'CHANGELOG.md',
    'LICENSE',
    'icon.svg',
    'logo.png',
    'media/monaco-editor/min/vs/loader.js',
    'media/monaco-editor/min/vs/editor/editor.main.js',
    'media/monaco-editor/min/vs/editor/editor.main.css',
    'media/monaco-editor/min/vs/base/worker/workerMain.js'
  ]

  const missingFiles = []
  
  for (const file of requiredFiles) {
    if (!fs.existsSync(file)) {
      missingFiles.push(file)
    }
  }

  if (missingFiles.length > 0) {
    console.error('❌ 缺少必要文件:')
    missingFiles.forEach(file => console.error(`  - ${file}`))
    return false
  }

  console.log('✅ 所有必要文件都存在')
  return true
}

/**
 * 检查冗余文件
 */
function checkRedundantFiles() {
  console.log('🔍 检查冗余文件...')
  
  const redundantPatterns = [
    'dist/**/*.worker.js',
    'dist/**/*.worker.js.map', 
    'dist/**/*.worker.js.LICENSE.txt',
    'src/**',
    'scripts/**',
    'node_modules/**',
    '**/*.ts',
    'webpack.config.js',
    'tsconfig.json'
  ]

  // 这里我们只做警告，因为.vscodeignore应该会处理这些
  console.log('ℹ️  以下文件类型应该被.vscodeignore排除:')
  redundantPatterns.forEach(pattern => console.log(`  - ${pattern}`))
  
  return true
}

/**
 * 检查Monaco编辑器优化情况
 */
function checkMonacoOptimization() {
  console.log('🔍 检查Monaco编辑器优化情况...')
  
  const basicLanguagesPath = 'media/monaco-editor/min/vs/basic-languages'
  
  if (!fs.existsSync(basicLanguagesPath)) {
    console.warn('⚠️ Monaco编辑器基础语言目录不存在')
    return false
  }

  const languages = fs.readdirSync(basicLanguagesPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)

  console.log(`📊 Monaco编辑器语言支持: ${languages.length} 种语言`)
  console.log(`📝 支持的语言: ${languages.join(', ')}`)

  // 检查是否有明显的不常用语言
  const uncommonLanguages = ['abap', 'apex', 'azcli', 'bicep', 'cameligo', 'clojure', 'coffee']
  const foundUncommon = languages.filter(lang => uncommonLanguages.includes(lang))
  
  if (foundUncommon.length > 0) {
    console.warn(`⚠️ 发现不常用语言，可能需要进一步优化: ${foundUncommon.join(', ')}`)
  } else {
    console.log('✅ Monaco编辑器已优化，只保留常用语言')
  }

  return true
}

/**
 * 预估扩展包大小
 */
function estimatePackageSize() {
  console.log('📊 预估扩展包大小...')
  
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
        try {
          const files = fs.readdirSync(currentPath)
          files.forEach(file => {
            calculateSize(path.join(currentPath, file))
          })
        } catch (error) {
          // 忽略权限错误
        }
      }
    }

    calculateSize(dirPath)
    return totalSize
  }

  const distSize = getDirectorySize('dist')
  const mediaSize = getDirectorySize('media')
  const totalSize = distSize + mediaSize + 50 * 1024 // 加上其他文件的估算

  console.log(`📁 dist目录: ${(distSize / 1024).toFixed(2)} KB`)
  console.log(`🎨 media目录: ${(mediaSize / 1024).toFixed(2)} KB`)
  console.log(`📦 预估总大小: ${(totalSize / 1024 / 1024).toFixed(2)} MB`)

  if (totalSize > 50 * 1024 * 1024) { // 50MB
    console.warn('⚠️ 扩展包可能过大，建议进一步优化')
    return false
  } else if (totalSize > 20 * 1024 * 1024) { // 20MB
    console.warn('⚠️ 扩展包较大，请确认所有文件都是必要的')
  } else {
    console.log('✅ 扩展包大小合理')
  }

  return true
}

/**
 * 检查package.json配置
 */
function checkPackageJson() {
  console.log('🔍 检查package.json配置...')
  
  try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    
    // 检查必要字段
    const requiredFields = ['name', 'version', 'description', 'main', 'engines', 'categories']
    const missingFields = requiredFields.filter(field => !packageJson[field])
    
    if (missingFields.length > 0) {
      console.error(`❌ package.json缺少必要字段: ${missingFields.join(', ')}`)
      return false
    }

    // 检查版本格式
    const versionRegex = /^\d+\.\d+\.\d+(-.*)?$/
    if (!versionRegex.test(packageJson.version)) {
      console.error(`❌ 版本号格式不正确: ${packageJson.version}`)
      return false
    }

    // 检查主入口文件
    if (packageJson.main !== './dist/extension.js') {
      console.warn(`⚠️ 主入口文件不是 ./dist/extension.js: ${packageJson.main}`)
    }

    console.log(`✅ package.json配置正确 (版本: ${packageJson.version})`)
    return true
  } catch (error) {
    console.error('❌ 无法读取或解析package.json:', error.message)
    return false
  }
}

/**
 * 主检查函数
 */
async function main() {
  console.log('🚀 开始发布前检查...\n')

  const checks = [
    { name: '必要文件检查', fn: checkRequiredFiles },
    { name: '冗余文件检查', fn: checkRedundantFiles },
    { name: 'Monaco优化检查', fn: checkMonacoOptimization },
    { name: '包大小预估', fn: estimatePackageSize },
    { name: 'package.json检查', fn: checkPackageJson }
  ]

  let allPassed = true

  for (const check of checks) {
    console.log(`\n--- ${check.name} ---`)
    try {
      const result = check.fn()
      if (!result) {
        allPassed = false
      }
    } catch (error) {
      console.error(`❌ ${check.name}失败:`, error.message)
      allPassed = false
    }
  }

  console.log('\n' + '='.repeat(50))
  
  if (allPassed) {
    console.log('🎉 所有检查通过！扩展包已准备好发布。')
    console.log('\n💡 发布建议:')
    console.log('  1. 运行 vsce publish 发布到市场')
    console.log('  2. 或运行 vsce package 生成本地包')
    console.log('  3. 发布前请确认版本号和更新日志')
  } else {
    console.log('❌ 部分检查未通过，请修复后再发布。')
    process.exit(1)
  }
}

// 执行检查
main().catch(error => {
  console.error('❌ 检查过程出错:', error.message)
  process.exit(1)
}) 