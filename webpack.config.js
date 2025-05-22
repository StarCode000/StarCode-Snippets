//@ts-check

'use strict';

const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

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
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode'
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
      }
    ]
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'node_modules/monaco-editor/min/vs/loader.js',
          to: 'monaco-editor/vs'
        },
        {
          from: 'node_modules/monaco-editor/min/vs/editor/**/*.js',
          to: 'monaco-editor'
        },
        {
          from: 'node_modules/monaco-editor/min/vs/base/**/*.js',
          to: 'monaco-editor'
        },
        {
          from: 'node_modules/monaco-editor/min/vs/basic-languages/javascript/**/*.js',
          to: 'monaco-editor'
        },
        {
          from: 'node_modules/monaco-editor/min/vs/basic-languages/typescript/**/*.js',
          to: 'monaco-editor'
        },
        {
          from: 'node_modules/monaco-editor/min/vs/basic-languages/html/**/*.js',
          to: 'monaco-editor'
        },
        {
          from: 'node_modules/monaco-editor/min/vs/basic-languages/css/**/*.js',
          to: 'monaco-editor'
        },
        {
          from: 'node_modules/monaco-editor/min/vs/basic-languages/json/**/*.js',
          to: 'monaco-editor'
        },
        {
          from: 'node_modules/monaco-editor/min/vs/language/typescript/**/*.js',
          to: 'monaco-editor'
        },
        {
          from: 'node_modules/monaco-editor/min/vs/language/json/**/*.js',
          to: 'monaco-editor'
        },
        {
          from: 'media',
          to: 'media'
        }
      ]
    })
  ],
  optimization: {
    minimize: true
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log",
  },
};

module.exports = [ extensionConfig ];