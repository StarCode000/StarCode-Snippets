const fs = require('fs')
const path = require('path')

/**
 * 检查Monaco编辑器的优化状态
 */
function checkMonacoOptimization() {
  const monacoPath = path.join(__dirname, '..', 'media', 'monaco-editor')
  
  if (!fs.existsSync(monacoPath)) {
    console.log('❌ Monaco编辑器未安装')
    return false
  }
  
  const languagesPath = path.join(monacoPath, 'min', 'vs', 'basic-languages')
  
  if (!fs.existsSync(languagesPath)) {
    console.log('❌ Monaco语言包目录不存在')
    return false
  }
  
  const languages = fs.readdirSync(languagesPath)
  console.log(`📁 当前语言包数量: ${languages.length}`)
  
  // 检查是否包含不常用语言
  const uncommonLanguages = [
    'abap', 'apex', 'azcli', 'bicep', 'cameligo', 'clojure', 
    'coffee', 'cypher', 'dart', 'elixir', 'flow9', 'fsharp',
    'graphql', 'hcl', 'julia', 'lexon', 'liquid', 'm3',
    'mips', 'msdax', 'pascal', 'pascaligo', 'postiats',
    'powerquery', 'protobuf', 'qsharp', 'redis', 'solidity',
    'sophia', 'sparql', 'st', 'systemverilog', 'tcl', 'twig',
    'typespec', 'vb', 'wgsl'
  ]
  
  const foundUncommon = languages.filter(lang => uncommonLanguages.includes(lang))
  
  if (foundUncommon.length > 0) {
    console.log(`⚠️  发现未优化的不常用语言: ${foundUncommon.join(', ')}`)
    console.log('📝 建议运行 npm run build 重新优化')
    return false
  }
  
  // 检查常用语言是否存在
  const commonLanguages = [
    'javascript', 'typescript', 'html', 'css', 'json',
    'python', 'java', 'cpp', 'csharp', 'go', 'rust',
    'php', 'ruby', 'swift', 'kotlin', 'scala',
    'r', 'sql', 'shell', 'markdown', 'xml', 'yaml'
  ]
  
  const foundCommon = languages.filter(lang => commonLanguages.includes(lang))
  console.log(`✅ 包含常用语言: ${foundCommon.join(', ')}`)
  
  if (foundCommon.length >= 20) {
    console.log('🎉 Monaco编辑器已优化，保留常用语言')
    return true
  } else {
    console.log('⚠️  常用语言数量不足，可能需要重新下载')
    return false
  }
}

// 执行检查
if (require.main === module) {
  console.log('🔍 检查Monaco编辑器优化状态...\n')
  const isOptimized = checkMonacoOptimization()
  console.log(`\n📊 优化状态: ${isOptimized ? '已优化' : '未优化'}`)
  process.exit(isOptimized ? 0 : 1)
}

module.exports = { checkMonacoOptimization } 