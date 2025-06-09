import { CodeSnippet, Directory } from './types'

/**
 * 同步结果接口
 */
export interface SyncResult {
  success: boolean
  message: string
  conflictsDetected?: boolean
  conflictDetails?: string[]
  mergedData?: {
    snippets: CodeSnippet[]
    directories: Directory[]
  }
  autoMerged?: boolean
  requiresUserDecision?: boolean
  decisionType?: 'local_empty_remote_has_data' | 'remote_empty_local_has_data' | 'both_have_conflicts'
}

/**
 * Git 操作结果接口
 */
export interface GitOperationResult {
  success: boolean
  message: string
}

/**
 * 远程检查结果
 */
export interface RemoteCheckResult {
  isRemoteEmpty: boolean
  remotePullSuccess: boolean
  remoteHasData: boolean
}

/**
 * 冲突解决策略
 */
export type ConflictResolutionStrategy = 
  | 'use_local' 
  | 'use_remote' 
  | 'use_newer' 
  | 'auto_merge' 
  | 'manual_merge_required'

/**
 * 代码片段冲突信息
 */
export interface SnippetConflict {
  id: string
  fullPath: string
  local: CodeSnippet
  remote: CodeSnippet
  resolution: ConflictResolutionStrategy
  needsManualMerge?: boolean
  conflictData?: {
    localContent: string
    remoteContent: string
    mergedContent?: string
  }
}

/**
 * 目录冲突信息
 */
export interface DirectoryConflict {
  id: string
  fullPath: string
  local: Directory
  remote: Directory
  resolution: ConflictResolutionStrategy
  needsManualMerge?: boolean
}

/**
 * 冲突解决结果
 */
export interface ConflictResolutionResult {
  strategy: ConflictResolutionStrategy
  resolved: CodeSnippet | Directory
  needsManualMerge?: boolean
  conflictData?: {
    localContent: string
    remoteContent: string
    mergedContent?: string
  }
}

/**
 * 合并结果
 */
export interface MergeResult<T> {
  merged: T[]
  conflicts: Array<SnippetConflict | DirectoryConflict>
  additions: number
  manualMergeRequired: boolean
}

/**
 * 代码合并结果
 */
export interface CodeMergeResult {
  success: boolean
  merged?: string
  hasConflicts?: boolean
}

/**
 * 变更检测结果
 */
export interface ChangeDetectionResult {
  hasChanges: boolean
  type: 'none' | 'local_only' | 'repo_only' | 'both_differ'
  details: string
}

/**
 * 远程更新检测结果
 */
export interface RemoteUpdateResult {
  hasUpdates: boolean
  details: string
}

/**
 * 拉取结果
 */
export interface PullResult {
  success: boolean
  message: string
  data?: { 
    snippets: CodeSnippet[]
    directories: Directory[] 
  }
}

/**
 * 强制导入结果
 */
export interface ForceImportResult {
  success: boolean
  message: string
  imported: { 
    snippets: number
    directories: number 
  }
}

/**
 * 冲突应用结果
 */
export interface ConflictApplyResult {
  success: boolean
  message: string
  resolvedCount: number
  resolvedSnippets?: CodeSnippet[]
}

/**
 * 连接测试结果
 */
export interface ConnectionTestResult {
  success: boolean
  message: string
}

/**
 * 已解决的冲突文件信息
 */
export interface ResolvedConflictFile {
  filePath: string
  resolvedContent: string
  originalConflict: any
}

/**
 * 冲突解决检测结果
 */
export interface ConflictResolutionDetectionResult {
  hasResolved: boolean
  resolvedFiles: ResolvedConflictFile[]
}

/**
 * 内容提取结果
 */
export interface ContentExtractionResult {
  success: boolean
  content: string
  errors: string[]
} 