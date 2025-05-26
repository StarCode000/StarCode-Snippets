import * as vscode from 'vscode';
import { StorageContext } from '../utils/storageContext';

/**
 * 注册迁移命令
 * @param context vscode扩展上下文
 * @param storageContext 存储上下文
 */
export function registerMigrateCommands(
  context: vscode.ExtensionContext,
  storageContext: StorageContext
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];
  
  // 注册迁移到V2的命令
  const migrateToV2Command = vscode.commands.registerCommand(
    'starcode-snippets.migrateToV2',
    async () => {
      try {
        // 显示确认对话框
        const result = await vscode.window.showInformationMessage(
          '确定要将数据从V1(基于ID)迁移到V2(基于路径)格式吗？此操作将保留原有数据。',
          { modal: true },
          '确定', '取消'
        );
        
        if (result === '确定') {
          // 显示进度
          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '正在迁移数据...',
            cancellable: false
          }, async (progress) => {
            // 执行迁移
            progress.report({ increment: 0, message: '开始迁移...' });
            
            await storageContext.convertToV2(true);
            
            progress.report({ increment: 50, message: '更新设置...' });
            
            // 更新设置
            await vscode.workspace.getConfiguration('starcode-snippets').update(
              'storageVersion', 'v2', vscode.ConfigurationTarget.Global
            );
            
            progress.report({ increment: 100, message: '迁移完成！' });
          });
          
          // 显示成功消息
          const reload = await vscode.window.showInformationMessage(
            '数据迁移成功！需要重新加载窗口以应用更改。',
            '立即重新加载', '稍后重新加载'
          );
          
          // 根据用户选择重新加载窗口
          if (reload === '立即重新加载') {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        }
      } catch (error) {
        console.error('迁移失败:', error);
        vscode.window.showErrorMessage(`迁移失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    }
  );
  
  // 注册迁移回V1的命令（用于调试或回退）
  const migrateToV1Command = vscode.commands.registerCommand(
    'starcode-snippets.migrateToV1',
    async () => {
      try {
        // 显示确认对话框
        const result = await vscode.window.showWarningMessage(
          '确定要将数据从V2(基于路径)迁移回V1(基于ID)格式吗？此操作通常用于调试或回退。',
          { modal: true },
          '确定', '取消'
        );
        
        if (result === '确定') {
          // 显示进度
          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '正在迁移数据...',
            cancellable: false
          }, async (progress) => {
            // 执行迁移
            progress.report({ increment: 0, message: '开始迁移...' });
            
            await storageContext.convertToV1(true);
            
            progress.report({ increment: 50, message: '更新设置...' });
            
            // 更新设置
            await vscode.workspace.getConfiguration('starcode-snippets').update(
              'storageVersion', 'v1', vscode.ConfigurationTarget.Global
            );
            
            progress.report({ increment: 100, message: '迁移完成！' });
          });
          
          // 显示成功消息
          const reload = await vscode.window.showInformationMessage(
            '数据迁移成功！需要重新加载窗口以应用更改。',
            '立即重新加载', '稍后重新加载'
          );
          
          // 根据用户选择重新加载窗口
          if (reload === '立即重新加载') {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        }
      } catch (error) {
        console.error('迁移失败:', error);
        vscode.window.showErrorMessage(`迁移失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    }
  );
  
  disposables.push(migrateToV2Command, migrateToV1Command);
  
  return disposables;
} 