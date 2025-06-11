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
  needsUserConfirmation?: boolean
  localDataInfo?: {
    snippets: number
    directories: number
  }
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

/**
 * 详细的同步状态信息
 */
export interface DetailedSyncStatus {
  /** 是否正在同步 */
  isSyncing: boolean
  /** 当前正在执行的操作 */
  currentOperation?: SyncOperation
  /** 操作进度（0-100） */
  progress?: number
  /** 当前操作的描述 */
  operationDescription?: string
  /** 操作开始时间 */
  operationStartTime?: number
  /** 是否已连接 */
  isConnected: boolean
  /** 上次同步时间 */
  lastSyncTime: number | null
  /** 最后一次错误信息 */
  lastError: string | null
}

/**
 * 同步操作类型
 */
export enum SyncOperation {
  /** 检查本地变更 */
  CHECKING_LOCAL_CHANGES = 'checking_local_changes',
  /** 检查远程状态 */
  CHECKING_REMOTE_STATUS = 'checking_remote_status',
  /** 拉取远程变更 */
  PULLING_REMOTE_CHANGES = 'pulling_remote_changes',
  /** 执行三路合并 */
  PERFORMING_MERGE = 'performing_merge',
  /** 处理合并冲突 */
  RESOLVING_CONFLICTS = 'resolving_conflicts',
  /** 暂存变更 */
  STAGING_CHANGES = 'staging_changes',
  /** 提交变更 */
  COMMITTING_CHANGES = 'committing_changes',
  /** 推送到远程 */
  PUSHING_TO_REMOTE = 'pushing_to_remote',
  /** 更新本地存储 */
  UPDATING_LOCAL_STORAGE = 'updating_local_storage',
  /** 验证同步结果 */
  VALIDATING_RESULT = 'validating_result',
  /** 清理临时文件 */
  CLEANING_UP = 'cleaning_up'
}

/**
 * 获取操作的中文描述
 */
export function getSyncOperationDescription(operation: SyncOperation): string {
  switch (operation) {
    case SyncOperation.CHECKING_LOCAL_CHANGES:
      return '检查本地变更...'
    case SyncOperation.CHECKING_REMOTE_STATUS:
      return '检查远程仓库状态...'
    case SyncOperation.PULLING_REMOTE_CHANGES:
      return '拉取远程变更...'
    case SyncOperation.PERFORMING_MERGE:
      return '执行数据合并...'
    case SyncOperation.RESOLVING_CONFLICTS:
      return '处理合并冲突...'
    case SyncOperation.STAGING_CHANGES:
      return '暂存变更...'
    case SyncOperation.COMMITTING_CHANGES:
      return '提交变更...'
    case SyncOperation.PUSHING_TO_REMOTE:
      return '推送到远程仓库...'
    case SyncOperation.UPDATING_LOCAL_STORAGE:
      return '更新本地存储...'
    case SyncOperation.VALIDATING_RESULT:
      return '验证同步结果...'
    case SyncOperation.CLEANING_UP:
      return '清理临时文件...'
    default:
      return '正在同步...'
  }
} 