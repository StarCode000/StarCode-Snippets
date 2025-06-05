import * as vscode from 'vscode'
import { 
  validateFileSystemSafety, 
  checkSnippetDirectoryConflict, 
  checkDirectorySnippetConflict,
  sanitizeName 
} from '../utils/nameValidator'

/**
 * 注册名称验证测试命令
 */
export function registerNameValidationTestCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
  const testNameValidation = vscode.commands.registerCommand('starcode-snippets.testNameValidation', async () => {
    const testCases = [
      'normal_name',
      'name with spaces',
      'name<with>invalid:chars',
      'name/with/slash',
      'name\\with\\backslash',
      'name"with"quotes',
      'name|with|pipe',
      'name?with?question',
      'name*with*asterisk',
      '.hidden_file',
      'file.',
      'CON',
      'PRN',
      'AUX',
      'NUL',
      'COM1',
      'LPT1',
      '', // 空名称
      '   ', // 只有空格
      'a'.repeat(300), // 超长名称
      'name\twith\ttab',
      'name\nwith\nnewline',
    ]

    let results = '# 名称验证测试结果\n\n'
    
    for (const testName of testCases) {
      const validation = validateFileSystemSafety(testName)
      const sanitized = sanitizeName(testName)
      
      results += `## 测试: "${testName.replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"\n`
      results += `- **有效**: ${validation.isValid ? '✅' : '❌'}\n`
      if (!validation.isValid) {
        results += `- **错误**: ${validation.error}\n`
      }
      results += `- **清理后**: "${sanitized}"\n\n`
    }

    // 创建临时文档显示结果
    const doc = await vscode.workspace.openTextDocument({
      content: results,
      language: 'markdown',
    })

    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
    })
  })

  const testConflictDetection = vscode.commands.registerCommand('starcode-snippets.testConflictDetection', async () => {
    // 模拟数据
    const mockDirectories = [
      { name: 'utils', fullPath: '/utils/', parentId: null },
      { name: 'components', fullPath: '/components/', parentId: null },
      { name: 'helpers', fullPath: '/utils/helpers/', parentId: 'utils-id' }
    ]

    const mockSnippets = [
      { name: 'config', fullPath: '/config', parentId: null },
      { name: 'index', fullPath: '/utils/index', parentId: 'utils-id' },
      { name: 'button', fullPath: '/components/button', parentId: 'components-id' }
    ]

    let results = '# 冲突检测测试结果\n\n'
    
    // 测试V2格式
    results += '## V2格式测试\n\n'
    
    const testCasesV2 = [
      { name: 'utils', parentPath: '/', description: '根目录下创建与现有目录同名的代码片段' },
      { name: 'config', parentPath: '/', description: '根目录下创建与现有代码片段同名的目录' },
      { name: 'newfile', parentPath: '/', description: '根目录下创建新名称（无冲突）' },
      { name: 'helpers', parentPath: '/utils/', description: '在utils目录下创建与子目录同名的代码片段' },
      { name: 'index', parentPath: '/utils/', description: '在utils目录下创建与现有代码片段同名的目录' }
    ]

    for (const testCase of testCasesV2) {
      const snippetConflict = checkSnippetDirectoryConflict(testCase.name, mockDirectories, testCase.parentPath, 'v2')
      const directoryConflict = checkDirectorySnippetConflict(testCase.name, mockSnippets, testCase.parentPath, 'v2')
      
      results += `### ${testCase.description}\n`
      results += `- **名称**: "${testCase.name}"\n`
      results += `- **父路径**: "${testCase.parentPath}"\n`
      results += `- **代码片段与目录冲突**: ${snippetConflict ? '❌ 有冲突' : '✅ 无冲突'}\n`
      results += `- **目录与代码片段冲突**: ${directoryConflict ? '❌ 有冲突' : '✅ 无冲突'}\n\n`
    }

    // 测试V1格式
    results += '## V1格式测试\n\n'
    
    const testCasesV1 = [
      { name: 'utils', parentId: null, description: '根目录下创建与现有目录同名的代码片段' },
      { name: 'config', parentId: null, description: '根目录下创建与现有代码片段同名的目录' },
      { name: 'newfile', parentId: null, description: '根目录下创建新名称（无冲突）' },
      { name: 'helpers', parentId: 'utils-id', description: '在utils目录下创建与子目录同名的代码片段' },
      { name: 'index', parentId: 'utils-id', description: '在utils目录下创建与现有代码片段同名的目录' }
    ]

    for (const testCase of testCasesV1) {
      const snippetConflict = checkSnippetDirectoryConflict(testCase.name, mockDirectories, testCase.parentId, 'v1')
      const directoryConflict = checkDirectorySnippetConflict(testCase.name, mockSnippets, testCase.parentId, 'v1')
      
      results += `### ${testCase.description}\n`
      results += `- **名称**: "${testCase.name}"\n`
      results += `- **父ID**: "${testCase.parentId}"\n`
      results += `- **代码片段与目录冲突**: ${snippetConflict ? '❌ 有冲突' : '✅ 无冲突'}\n`
      results += `- **目录与代码片段冲突**: ${directoryConflict ? '❌ 有冲突' : '✅ 无冲突'}\n\n`
    }

    // 创建临时文档显示结果
    const doc = await vscode.workspace.openTextDocument({
      content: results,
      language: 'markdown',
    })

    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
    })
  })

  return [testNameValidation, testConflictDetection]
} 