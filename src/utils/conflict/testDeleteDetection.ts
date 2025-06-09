import { ConflictResolver } from './conflictResolver'
import { CodeSnippet } from '../../types/types'

/**
 * 测试删除内容检测的逻辑
 */
export function testDeleteDetection() {
  const resolver = new ConflictResolver()
  
  console.log('🧪 测试删除内容检测逻辑...\n')
  
  // 模拟您的情况：本地删除了内容
  const originalContent = `test1
test1
test1
test2
vscode
cursor
javascript
typescript`

  const deletedContent = `test1`
  
  // 模拟时间戳：本地版本更新（更大的时间戳）
  const baseTime = Date.now()
  const localTime = baseTime + 5000  // 本地版本较新
  const remoteTime = baseTime        // 远程版本较旧
  
  console.log('测试场景：用户删除了代码内容')
  console.log('本地内容:', JSON.stringify(deletedContent))
  console.log('远程内容:', JSON.stringify(originalContent))
  console.log('本地时间戳:', localTime, '(较新)')
  console.log('远程时间戳:', remoteTime, '(较旧)\n')
  
  // 测试自动合并逻辑
  const result = resolver.attemptCodeMerge(deletedContent, originalContent, localTime, remoteTime)
  
  console.log('🔍 合并结果:')
  console.log('成功:', result.success)
  console.log('合并后的内容:', JSON.stringify(result.merged))
  console.log('是否有冲突:', result.hasConflicts)
  
  // 验证结果
  const expectedResult = deletedContent // 应该使用本地删除后的版本
  const isCorrect = result.merged === expectedResult
  
  console.log('\n✅ 验证结果:')
  console.log('期望结果:', JSON.stringify(expectedResult))
  console.log('实际结果:', JSON.stringify(result.merged))
  console.log('测试通过:', isCorrect ? '✅ 是' : '❌ 否')
  
  if (!isCorrect) {
    console.log('❌ 测试失败：系统没有正确识别删除操作！')
  } else {
    console.log('✅ 测试成功：系统正确识别了删除操作并保留了用户的删除意图！')
  }
  
  // 测试反向情况：远程删除了内容
  console.log('\n' + '='.repeat(50))
  console.log('测试场景：远程删除了代码内容')
  
  const result2 = resolver.attemptCodeMerge(originalContent, deletedContent, baseTime, baseTime + 5000)
  console.log('🔍 反向测试结果:')
  console.log('合并后的内容:', JSON.stringify(result2.merged))
  console.log('应该使用远程删除版本:', result2.merged === deletedContent ? '✅ 是' : '❌ 否')
  
  return { 
    userDeleteTest: isCorrect,
    remoteDeleteTest: result2.merged === deletedContent
  }
}

/**
 * 测试完整的代码片段冲突解决
 */
export function testFullSnippetConflictResolution() {
  const resolver = new ConflictResolver()
  
  console.log('\n🧪 测试完整的代码片段冲突解决...\n')
  
  const baseTime = Date.now()
  
  // 本地版本：用户删除了内容
  const localSnippet: CodeSnippet = {
    name: 'test1',
    code: 'test1',
    filePath: '',
    fileName: 'test1.txt',
    category: 'test',
    fullPath: '/test1',
    order: 0,
    createTime: baseTime + 5000, // 更新的时间戳
    language: 'text'
  }
  
  // 远程版本：保持原始内容
  const remoteSnippet: CodeSnippet = {
    name: 'test1',
    code: `test1
test1
test1
test2
vscode
cursor
javascript
typescript`,
    filePath: '',
    fileName: 'test1.txt',
    category: 'test',
    fullPath: '/test1',
    order: 0,
    createTime: baseTime, // 较旧的时间戳
    language: 'text'
  }
  
  console.log('本地代码片段（删除后）:', JSON.stringify(localSnippet.code))
  console.log('远程代码片段（原始）:', JSON.stringify(remoteSnippet.code))
  console.log('本地时间戳:', localSnippet.createTime)
  console.log('远程时间戳:', remoteSnippet.createTime)
  
  const result = resolver.resolveSnippetConflict(localSnippet, remoteSnippet)
  
  console.log('\n🔍 冲突解决结果:')
  console.log('策略:', result.strategy)
  console.log('解决后的代码:', JSON.stringify(result.resolved.code))
  console.log('需要手动处理:', result.needsManualMerge || false)
  
  const isCorrect = result.resolved.code === localSnippet.code
  console.log('\n✅ 验证结果:')
  console.log('保留了用户删除的意图:', isCorrect ? '✅ 是' : '❌ 否')
  
  return isCorrect
}

// 如果直接运行此文件，执行测试
if (require.main === module) {
  console.log('开始测试删除内容检测逻辑...\n')
  
  const test1 = testDeleteDetection()
  const test2 = testFullSnippetConflictResolution()
  
  console.log('\n' + '='.repeat(50))
  console.log('📋 测试总结:')
  console.log('用户删除测试:', test1.userDeleteTest ? '✅ 通过' : '❌ 失败')
  console.log('远程删除测试:', test1.remoteDeleteTest ? '✅ 通过' : '❌ 失败')
  console.log('完整冲突解决测试:', test2 ? '✅ 通过' : '❌ 失败')
  
  const allPassed = test1.userDeleteTest && test1.remoteDeleteTest && test2
  console.log('总体结果:', allPassed ? '✅ 所有测试通过' : '❌ 存在失败的测试')
} 