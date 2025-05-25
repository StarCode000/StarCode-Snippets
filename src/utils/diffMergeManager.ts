import { CodeSnippet, Directory } from '../models/types';
import * as vscode from 'vscode';
import { diffLines, Change } from 'diff';
import { diff3Merge, MergeResult as Diff3MergeResult } from 'node-diff3';
import { ConflictResolutionWebviewProvider } from '../explorer/conflictResolutionWebviewProvider';

// 合并结果类型
export interface MergeResult {
  success: boolean;
  merged?: CodeSnippet;
  conflicts?: ConflictInfo[];
  requiresUserDecision?: boolean;
}

// 冲突信息
export interface ConflictInfo {
  field: string;
  localValue: any;
  remoteValue: any;
  description: string;
}

// 代码差异信息
export interface CodeDiff {
  type: 'addition' | 'deletion' | 'modification';
  lineNumber: number;
  content: string;
  conflictsWith?: CodeDiff;
}

export class DiffMergeManager {
  
  /**
   * 尝试自动合并两个代码片段
   */
  public static async mergeSnippets(
    localSnippet: CodeSnippet,
    remoteSnippet: CodeSnippet,
    baseSnippet?: CodeSnippet // 共同祖先版本，用于三路合并
  ): Promise<MergeResult> {
    
    // 1. 检查是否为同一个代码片段
    if (localSnippet.id !== remoteSnippet.id) {
      return {
        success: false,
        conflicts: [{
          field: 'id',
          localValue: localSnippet.id,
          remoteValue: remoteSnippet.id,
          description: '代码片段ID不匹配，无法合并'
        }]
      };
    }

    // 2. 检测字段级别的冲突
    const fieldConflicts = this.detectFieldConflicts(localSnippet, remoteSnippet, baseSnippet);
    
    // 3. 如果有代码内容冲突，尝试进行代码级别的合并
    const codeConflict = fieldConflicts.find(c => c.field === 'code');
    if (codeConflict) {
      const codeMergeResult = await this.mergeCodeContent(
        localSnippet.code,
        remoteSnippet.code,
        baseSnippet?.code
      );
      
      if (codeMergeResult.success) {
        // 代码合并成功，移除代码冲突
        const otherConflicts = fieldConflicts.filter(c => c.field !== 'code');
        
        if (otherConflicts.length === 0) {
          // 没有其他冲突，可以自动合并
          const mergedSnippet = this.createMergedSnippet(
            localSnippet,
            remoteSnippet,
            codeMergeResult.mergedCode!
          );
          
          return {
            success: true,
            merged: mergedSnippet
          };
        } else {
          // 还有其他字段冲突，需要用户决策
          return {
            success: false,
            conflicts: otherConflicts,
            requiresUserDecision: true
          };
        }
      } else {
        // 代码合并失败，需要用户决策
        return {
          success: false,
          conflicts: fieldConflicts,
          requiresUserDecision: true
        };
      }
    }

    // 4. 没有代码冲突，检查其他字段冲突
    if (fieldConflicts.length === 0) {
      // 没有冲突，可以自动合并
      const mergedSnippet = this.createMergedSnippet(localSnippet, remoteSnippet);
      return {
        success: true,
        merged: mergedSnippet
      };
    } else {
      // 有字段冲突，需要用户决策
      return {
        success: false,
        conflicts: fieldConflicts,
        requiresUserDecision: true
      };
    }
  }

  /**
   * 检测字段级别的冲突
   */
  private static detectFieldConflicts(
    local: CodeSnippet,
    remote: CodeSnippet,
    base?: CodeSnippet
  ): ConflictInfo[] {
    const conflicts: ConflictInfo[] = [];
    
    // 检查各个字段
    const fieldsToCheck: (keyof CodeSnippet)[] = [
      'name', 'code', 'language', 'fileName', 'category', 'parentId'
    ];
    
    for (const field of fieldsToCheck) {
      const localValue = local[field];
      const remoteValue = remote[field];
      const baseValue = base?.[field];
      
      // 如果本地和远程值不同
      if (localValue !== remoteValue) {
        // 如果有基础版本，检查是否为真正的冲突
        if (base) {
          const localChanged = localValue !== baseValue;
          const remoteChanged = remoteValue !== baseValue;
          
          // 只有当双方都修改了同一字段时才算冲突
          if (localChanged && remoteChanged) {
            conflicts.push({
              field,
              localValue,
              remoteValue,
              description: `字段 "${field}" 在本地和远程都被修改`
            });
          }
        } else {
          // 没有基础版本，任何不同都算冲突
          conflicts.push({
            field,
            localValue,
            remoteValue,
            description: `字段 "${field}" 在本地和远程有不同的值`
          });
        }
      }
    }
    
    return conflicts;
  }

  /**
   * 合并代码内容
   */
  private static async mergeCodeContent(
    localCode: string,
    remoteCode: string,
    baseCode?: string
  ): Promise<{ success: boolean; mergedCode?: string; conflicts?: CodeDiff[] }> {
    
    // 如果代码完全相同，直接返回
    if (localCode === remoteCode) {
      return { success: true, mergedCode: localCode };
    }
    
    // 简单的行级合并策略
    const localLines = localCode.split('\n');
    const remoteLines = remoteCode.split('\n');
    const baseLines = baseCode ? baseCode.split('\n') : [];
    
    // 如果有基础版本，尝试三路合并
    if (baseCode) {
      return this.performThreeWayMerge(localLines, remoteLines, baseLines);
    } else {
      // 没有基础版本，尝试简单的两路合并
      return this.performTwoWayMerge(localLines, remoteLines);
    }
  }

  /**
   * 三路合并（基于共同祖先）- 使用专业的diff3算法
   */
  private static performThreeWayMerge(
    localLines: string[],
    remoteLines: string[],
    baseLines: string[]
  ): { success: boolean; mergedCode?: string; conflicts?: CodeDiff[] } {
    
    try {
      // 使用node-diff3进行三路合并
      const mergeResult = diff3Merge(localLines, baseLines, remoteLines, {
        excludeFalseConflicts: true
      });
      
      // 处理合并结果
      const mergedLines: string[] = [];
      const conflicts: CodeDiff[] = [];
      let hasConflicts = false;
      let lineNumber = 1;
      
      for (const block of mergeResult) {
        if (block.ok) {
          // 无冲突的块，直接添加
          mergedLines.push(...block.ok);
          lineNumber += block.ok.length;
        } else if (block.conflict) {
          // 有冲突的块
          hasConflicts = true;
          const conflictStart = lineNumber;
          
          conflicts.push({
            type: 'modification',
            lineNumber: conflictStart,
            content: `代码冲突：第${conflictStart}行附近`,
          });
          
          // 添加冲突标记
          mergedLines.push('<<<<<<< 本地');
          mergedLines.push(...block.conflict.a);
          mergedLines.push('=======');
          mergedLines.push(...block.conflict.b);
          mergedLines.push('>>>>>>> 远程');
          
          lineNumber += Math.max(block.conflict.a.length, block.conflict.b.length);
        }
      }
      
      if (!hasConflicts) {
        // 没有冲突，合并成功
        return {
          success: true,
          mergedCode: mergedLines.join('\n')
        };
      } else {
        // 有冲突
        return {
          success: false,
          conflicts,
          mergedCode: mergedLines.join('\n') // 包含冲突标记的结果
        };
      }
    } catch (error) {
      console.error('三路合并失败:', error);
      
      // 回退到简单的行级比较
      return this.performSimpleThreeWayMerge(localLines, remoteLines, baseLines);
    }
  }

  /**
   * 简单的三路合并（回退方案）
   */
  private static performSimpleThreeWayMerge(
    localLines: string[],
    remoteLines: string[],
    baseLines: string[]
  ): { success: boolean; mergedCode?: string; conflicts?: CodeDiff[] } {
    
    const mergedLines: string[] = [];
    const conflicts: CodeDiff[] = [];
    
    const maxLength = Math.max(localLines.length, remoteLines.length, baseLines.length);
    
    for (let i = 0; i < maxLength; i++) {
      const localLine = localLines[i] || '';
      const remoteLine = remoteLines[i] || '';
      const baseLine = baseLines[i] || '';
      
      const localChanged = localLine !== baseLine;
      const remoteChanged = remoteLine !== baseLine;
      
      if (!localChanged && !remoteChanged) {
        // 双方都没有修改，使用原始行
        mergedLines.push(baseLine);
      } else if (localChanged && !remoteChanged) {
        // 只有本地修改，使用本地版本
        mergedLines.push(localLine);
      } else if (!localChanged && remoteChanged) {
        // 只有远程修改，使用远程版本
        mergedLines.push(remoteLine);
      } else {
        // 双方都修改了，检查是否修改为相同内容
        if (localLine === remoteLine) {
          // 修改为相同内容，使用任一版本
          mergedLines.push(localLine);
        } else {
          // 真正的冲突
          conflicts.push({
            type: 'modification',
            lineNumber: i + 1,
            content: `<<<<<<< 本地\n${localLine}\n=======\n${remoteLine}\n>>>>>>> 远程`,
            conflictsWith: {
              type: 'modification',
              lineNumber: i + 1,
              content: remoteLine
            }
          });
          
          // 暂时使用冲突标记
          mergedLines.push(`<<<<<<< 本地`);
          mergedLines.push(localLine);
          mergedLines.push(`=======`);
          mergedLines.push(remoteLine);
          mergedLines.push(`>>>>>>> 远程`);
        }
      }
    }
    
    if (conflicts.length === 0) {
      return {
        success: true,
        mergedCode: mergedLines.join('\n')
      };
    } else {
      return {
        success: false,
        conflicts
      };
    }
  }

  /**
   * 两路合并（没有共同祖先）- 使用专业的diff算法
   */
  private static performTwoWayMerge(
    localLines: string[],
    remoteLines: string[]
  ): { success: boolean; mergedCode?: string; conflicts?: CodeDiff[] } {
    
    try {
      // 使用diff库进行行级比较
      const localText = localLines.join('\n');
      const remoteText = remoteLines.join('\n');
      
      const changes = diffLines(localText, remoteText);
      
      const mergedLines: string[] = [];
      const conflicts: CodeDiff[] = [];
      let lineNumber = 1;
      let hasConflicts = false;
      
      for (const change of changes) {
        if (!change.added && !change.removed) {
          // 未修改的行，直接添加
          const lines = change.value.split('\n');
          // 移除最后的空行（split会产生）
          if (lines[lines.length - 1] === '') {
            lines.pop();
          }
          mergedLines.push(...lines);
          lineNumber += lines.length;
        } else if (change.removed && !change.added) {
          // 只在本地删除的行，保持删除状态
          const lines = change.value.split('\n');
          if (lines[lines.length - 1] === '') {
            lines.pop();
          }
          lineNumber += lines.length;
        } else if (change.added && !change.removed) {
          // 只在远程添加的行，接受添加
          const lines = change.value.split('\n');
          if (lines[lines.length - 1] === '') {
            lines.pop();
          }
          mergedLines.push(...lines);
          lineNumber += lines.length;
        } else {
          // 同时有添加和删除，这是冲突
          hasConflicts = true;
          conflicts.push({
            type: 'modification',
            lineNumber: lineNumber,
            content: `代码冲突：第${lineNumber}行附近`,
          });
          
          // 添加冲突标记
          mergedLines.push(`<<<<<<< 本地`);
          const removedLines = change.value.split('\n');
          if (removedLines[removedLines.length - 1] === '') {
            removedLines.pop();
          }
          mergedLines.push(...removedLines);
          mergedLines.push(`=======`);
          
          // 查找对应的添加部分
          const nextChange = changes[changes.indexOf(change) + 1];
          if (nextChange && nextChange.added) {
            const addedLines = nextChange.value.split('\n');
            if (addedLines[addedLines.length - 1] === '') {
              addedLines.pop();
            }
            mergedLines.push(...addedLines);
          }
          
          mergedLines.push(`>>>>>>> 远程`);
          lineNumber += removedLines.length;
        }
      }
      
      // 如果没有冲突或冲突较少，可以尝试自动合并
      if (!hasConflicts) {
        return {
          success: true,
          mergedCode: mergedLines.join('\n')
        };
      } else if (conflicts.length <= 3) {
        // 冲突较少，提供合并结果但需要用户确认
        return {
          success: false,
          conflicts,
          mergedCode: mergedLines.join('\n')
        };
      } else {
        // 冲突太多，建议用户手动处理
        return {
          success: false,
          conflicts: [{
            type: 'modification',
            lineNumber: 1,
            content: `检测到${conflicts.length}个冲突，建议手动合并`,
          }]
        };
      }
      
    } catch (error) {
      console.error('两路合并失败:', error);
      
      // 回退到简单比较
      return this.performSimpleTwoWayMerge(localLines, remoteLines);
    }
  }

  /**
   * 简单的两路合并（回退方案）
   */
  private static performSimpleTwoWayMerge(
    localLines: string[],
    remoteLines: string[]
  ): { success: boolean; mergedCode?: string; conflicts?: CodeDiff[] } {
    
    // 简单的策略：如果行数相同且大部分行相同，尝试合并
    if (localLines.length === remoteLines.length) {
      const mergedLines: string[] = [];
      const conflicts: CodeDiff[] = [];
      
      for (let i = 0; i < localLines.length; i++) {
        if (localLines[i] === remoteLines[i]) {
          mergedLines.push(localLines[i]);
        } else {
          // 发现不同的行
          conflicts.push({
            type: 'modification',
            lineNumber: i + 1,
            content: `<<<<<<< 本地\n${localLines[i]}\n=======\n${remoteLines[i]}\n>>>>>>> 远程`
          });
          
          mergedLines.push(`<<<<<<< 本地`);
          mergedLines.push(localLines[i]);
          mergedLines.push(`=======`);
          mergedLines.push(remoteLines[i]);
          mergedLines.push(`>>>>>>> 远程`);
        }
      }
      
      // 如果冲突行数少于总行数的30%，认为可以合并
      if (conflicts.length < localLines.length * 0.3) {
        return {
          success: false, // 仍需要用户确认
          conflicts
        };
      }
    }
    
    // 无法自动合并
    return {
      success: false,
      conflicts: [{
        type: 'modification',
        lineNumber: 1,
        content: '代码结构差异过大，无法自动合并',
      }]
    };
  }

  /**
   * 创建合并后的代码片段
   */
  private static createMergedSnippet(
    local: CodeSnippet,
    remote: CodeSnippet,
    mergedCode?: string
  ): CodeSnippet {
    return {
      id: local.id,
      name: this.chooseBestValue(local.name, remote.name),
      code: mergedCode || this.chooseBestValue(local.code, remote.code),
      language: this.chooseBestValue(local.language, remote.language),
      fileName: this.chooseBestValue(local.fileName, remote.fileName),
      filePath: this.chooseBestValue(local.filePath, remote.filePath),
      category: this.chooseBestValue(local.category, remote.category),
      parentId: this.chooseBestValue(local.parentId, remote.parentId),
      order: Math.max(local.order, remote.order),
      createTime: Math.min(local.createTime, remote.createTime) // 使用较早的创建时间
    };
  }

  /**
   * 选择最佳值（优先选择非空、更新的值）
   */
  private static chooseBestValue<T>(localValue: T, remoteValue: T): T {
    // 如果值相同，返回任一
    if (localValue === remoteValue) {
      return localValue;
    }
    
    // 优先选择非空值
    if (!localValue && remoteValue) {
      return remoteValue;
    }
    if (localValue && !remoteValue) {
      return localValue;
    }
    
    // 如果都有值但不同，优先选择远程值（假设远程更新）
    return remoteValue;
  }

  /**
   * 显示冲突解决界面
   */
  public static async showConflictResolutionUI(
    conflicts: ConflictInfo[],
    localSnippet: CodeSnippet,
    remoteSnippet: CodeSnippet
  ): Promise<CodeSnippet | null> {
    
    // 首先尝试使用新的WebView界面
    try {
      return await ConflictResolutionWebviewProvider.showConflictResolution(
        conflicts,
        localSnippet,
        remoteSnippet
      );
    } catch (error) {
      console.warn('WebView冲突解决界面不可用，回退到快速选择:', error);
    }
    
    // 回退到原有的快速选择界面
    const options: vscode.QuickPickItem[] = [
      {
        label: '$(arrow-left) 保留本地版本',
        description: '使用本地的修改，丢弃远程修改',
        detail: '本地优先策略'
      },
      {
        label: '$(arrow-right) 保留远程版本',
        description: '使用远程的修改，丢弃本地修改',
        detail: '远程优先策略'
      },
      {
        label: '$(git-merge) 手动合并',
        description: '打开编辑器手动解决冲突',
        detail: '需要用户手动编辑'
      },
      {
        label: '$(x) 跳过此文件',
        description: '暂时跳过，稍后处理',
        detail: '保持当前状态'
      }
    ];

    const conflictDescription = conflicts.map(c => 
      `• ${c.field}: ${c.description}`
    ).join('\n');

    const selected = await vscode.window.showQuickPick(options, {
      placeHolder: `代码片段 "${localSnippet.name}" 存在冲突，请选择解决方式`,
      ignoreFocusOut: true,
      matchOnDescription: true,
      matchOnDetail: true
    });

    if (!selected) {
      return null; // 用户取消
    }

    switch (selected.label) {
      case '$(arrow-left) 保留本地版本':
        return localSnippet;
      
      case '$(arrow-right) 保留远程版本':
        return remoteSnippet;
      
      case '$(git-merge) 手动合并':
        return await this.openManualMergeEditor(localSnippet, remoteSnippet, conflicts);
      
      default:
        return null; // 跳过
    }
  }

  /**
   * 打开手动合并编辑器
   */
  private static async openManualMergeEditor(
    localSnippet: CodeSnippet,
    remoteSnippet: CodeSnippet,
    conflicts: ConflictInfo[]
  ): Promise<CodeSnippet | null> {
    
    // 创建合并内容
    let mergeContent = `// 代码片段合并 - ${localSnippet.name}\n`;
    mergeContent += `// 请解决以下冲突后保存文件\n\n`;
    
    // 添加冲突信息
    mergeContent += `/*\n冲突字段:\n`;
    conflicts.forEach(conflict => {
      mergeContent += `- ${conflict.field}: ${conflict.description}\n`;
      mergeContent += `  本地值: ${JSON.stringify(conflict.localValue)}\n`;
      mergeContent += `  远程值: ${JSON.stringify(conflict.remoteValue)}\n\n`;
    });
    mergeContent += `*/\n\n`;
    
    // 添加代码内容
    if (conflicts.some(c => c.field === 'code')) {
      mergeContent += `<<<<<<< 本地版本\n`;
      mergeContent += localSnippet.code;
      mergeContent += `\n=======\n`;
      mergeContent += remoteSnippet.code;
      mergeContent += `\n>>>>>>> 远程版本\n`;
    } else {
      mergeContent += localSnippet.code;
    }

    // 创建临时文档
    const doc = await vscode.workspace.openTextDocument({
      content: mergeContent,
      language: localSnippet.language || 'plaintext'
    });

    // 打开编辑器
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: false
    });

    // 等待用户编辑完成
    const result = await vscode.window.showInformationMessage(
      '请在编辑器中解决冲突，然后选择操作',
      { modal: true },
      '应用合并',
      '取消'
    );

    if (result === '应用合并') {
      // 获取编辑后的内容
      const editedContent = editor.document.getText();
      
      // 解析合并后的代码（移除冲突标记）
      const cleanedCode = this.cleanMergeMarkers(editedContent);
      
      // 创建合并后的代码片段
      const mergedSnippet: CodeSnippet = {
        ...localSnippet,
        code: cleanedCode,
        // 对于其他冲突字段，使用远程值作为默认
        name: remoteSnippet.name !== localSnippet.name ? remoteSnippet.name : localSnippet.name,
        language: remoteSnippet.language !== localSnippet.language ? remoteSnippet.language : localSnippet.language,
        fileName: remoteSnippet.fileName !== localSnippet.fileName ? remoteSnippet.fileName : localSnippet.fileName,
        category: remoteSnippet.category !== localSnippet.category ? remoteSnippet.category : localSnippet.category,
        parentId: remoteSnippet.parentId !== localSnippet.parentId ? remoteSnippet.parentId : localSnippet.parentId
      };

      // 关闭临时文档
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      
      return mergedSnippet;
    }

    // 关闭临时文档
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    return null;
  }

  /**
   * 生成详细的差异报告（用于调试和用户查看）
   */
  public static generateDiffReport(
    localCode: string,
    remoteCode: string,
    baseCode?: string
  ): string {
    let report = '# 代码差异报告\n\n';
    
    try {
      if (baseCode) {
        // 三路差异分析
        report += '## 三路差异分析\n\n';
        
        const localChanges = diffLines(baseCode, localCode);
        const remoteChanges = diffLines(baseCode, remoteCode);
        
        report += '### 本地修改:\n';
        localChanges.forEach((change, index) => {
          if (change.added) {
            report += `+ ${change.value.replace(/\n/g, '\\n')}\n`;
          } else if (change.removed) {
            report += `- ${change.value.replace(/\n/g, '\\n')}\n`;
          }
        });
        
        report += '\n### 远程修改:\n';
        remoteChanges.forEach((change, index) => {
          if (change.added) {
            report += `+ ${change.value.replace(/\n/g, '\\n')}\n`;
          } else if (change.removed) {
            report += `- ${change.value.replace(/\n/g, '\\n')}\n`;
          }
        });
        
        // 尝试三路合并
        const mergeResult = diff3Merge(localCode.split('\n'), baseCode.split('\n'), remoteCode.split('\n'), {
          excludeFalseConflicts: true
        });
        
        const hasConflicts = mergeResult.some(block => block.conflict);
        report += `\n### 合并结果: ${hasConflicts ? '有冲突' : '无冲突'}\n`;
        
      } else {
        // 两路差异分析
        report += '## 两路差异分析\n\n';
        
        const changes = diffLines(localCode, remoteCode);
        changes.forEach((change, index) => {
          if (change.added) {
            report += `+ 远程添加: ${change.value.replace(/\n/g, '\\n')}\n`;
          } else if (change.removed) {
            report += `- 本地删除: ${change.value.replace(/\n/g, '\\n')}\n`;
          } else {
            report += `= 相同: ${change.value.replace(/\n/g, '\\n')}\n`;
          }
        });
      }
      
    } catch (error) {
      report += `\n错误: 生成差异报告失败 - ${error}\n`;
    }
    
    return report;
  }

  /**
   * 清理合并标记
   */
  private static cleanMergeMarkers(content: string): string {
    // 移除注释部分
    const lines = content.split('\n');
    const codeStartIndex = lines.findIndex(line => line.includes('*/')) + 1;
    
    if (codeStartIndex > 0) {
      const codeLines = lines.slice(codeStartIndex);
      
      // 移除合并冲突标记
      return codeLines
        .filter(line => 
          !line.startsWith('<<<<<<<') && 
          !line.startsWith('=======') && 
          !line.startsWith('>>>>>>>')
        )
        .join('\n')
        .trim();
    }
    
    return content;
  }
} 