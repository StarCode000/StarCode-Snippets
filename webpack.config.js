//@ts-check

'use strict';

const path = require('path');
// const CopyWebpackPlugin = require('copy-webpack-plugin'); // 不再需要完整复制
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @type WebpackConfig */
const extensionConfig = {
  target: 'node',
  mode: 'none',

  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    // 需要为 Monaco Editor 的 web worker 设置一个公共路径
    // 这通常指向你最终打包后存放 worker 文件的目录
    publicPath: '' // 根据你的实际部署情况可能需要调整
  },
  externals: {
    vscode: 'commonjs vscode'
  },
  node: {
    __dirname: false,
    __filename: false
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.ttf$/,
        type: 'asset/resource'
      }
    ]
  },
  plugins: [
    // 如果你仍然有其他需要复制的非 Monaco 资源，可以保留 CopyWebpackPlugin 并调整其配置
    // new CopyWebpackPlugin({
    //   patterns: [
    //     {
    //       from: 'media',
    //       to: 'media'
    //     }
    //   ]
    // }),
    new MonacoWebpackPlugin({
      // 根据你的实际需求调整语言列表
      languages: ['javascript', 'typescript', 'json', 'html', 'css', 'go', 'cpp', 'csharp', 'java', 'yaml', 'rust', 'swift', 'sql'], 
      features: [
        'bracketMatching', // 括号匹配
        'caretOperations', // 光标操作
        'clipboard',       // 剪贴板功能
        'codeAction',      // 代码操作 (用于格式化等)
        'codelens',        // CodeLens
        'colorDetector',   // 颜色拾取器
        'comment',         // 注释功能
        'contextmenu',     // 右键菜单
        'cursorUndo',      // 光标撤销
        'documentSymbol',  // 文档符号 (大纲视图等)
        'find',            // 查找与替换
        'folding',         // 代码折叠
        'fontZoom',        // 字体缩放
        'format',          // 格式化
        'gotoError',       // 跳转到错误
        'gotoLine',        // 跳转到行
        'hover',           // 悬停提示
        'inPlaceReplace',  // 原地替换
        'linesOperations', //行操作
        'links',           //链接检测
        'multicursor',     // 多光标
        'quickCommand',    // 快速命令
        'quickHelp',       // 快速帮助
        'quickOutline',    // 快速大纲
        'suggest',         // 建议/自动补全
        'wordHighlighter', // 词高亮
        'wordOperations',  // 词操作
      ],
      //  确保 worker 文件名和路径正确
      filename: '[name].worker.js'
    })
  ],
  optimization: {
    minimize: true // 保持最小化以减小体积
  },
  stats: {
    warnings: true // 打开警告，方便排查问题
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log",
  },
};

module.exports = [ extensionConfig ];