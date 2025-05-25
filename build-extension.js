#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 开始构建 StarCode Snippets 扩展...');

try {
  // 1. 清理旧的构建文件
  console.log('📁 清理旧的构建文件...');
  if (fs.existsSync('dist')) {
    fs.rmSync('dist', { recursive: true, force: true });
  }
  if (fs.existsSync('*.vsix')) {
    const vsixFiles = fs.readdirSync('.').filter(file => file.endsWith('.vsix'));
    vsixFiles.forEach(file => fs.unlinkSync(file));
  }

  // 2. 运行 webpack 构建
  console.log('⚙️  运行 webpack 构建...');
  execSync('npm run package', { stdio: 'inherit' });

  // 3. 验证构建结果
  console.log('🔍 验证构建结果...');
  const distPath = path.join(__dirname, 'dist', 'extension.js');
  if (!fs.existsSync(distPath)) {
    throw new Error('构建失败：dist/extension.js 不存在');
  }

  const stats = fs.statSync(distPath);
  console.log(`✅ 构建成功！文件大小: ${(stats.size / 1024).toFixed(2)} KB`);

  // 4. 运行 vsce package
  console.log('📦 打包扩展...');
  execSync('vsce package', { stdio: 'inherit' });

  console.log('🎉 扩展构建完成！');

} catch (error) {
  console.error('❌ 构建失败:', error.message);
  process.exit(1);
} 