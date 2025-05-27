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
      }
    ]
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'node_modules/monaco-editor/min/vs/loader.js',
          to: 'monaco-editor/node_modules/monaco-editor/min/vs/loader.js'
        },
        {
          from: 'node_modules/monaco-editor/min',
          to: 'monaco-editor/node_modules/monaco-editor/min',
          globOptions: {
            ignore: ['**/*.d.ts']
          }
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
  stats: {
    warnings: false
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log",
  },
};

module.exports = [ extensionConfig ];