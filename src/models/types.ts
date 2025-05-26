// src/models/types.ts

// ===== V1 类型（向后兼容，基于ID和parentId） =====
export interface CodeSnippetV1 {
  id: string
  name: string
  code: string
  filePath: string
  fileName: string
  category: string
  parentId: string | null // 用于目录结构
  order: number
  createTime: number
  language?: string // 代码语言，可选属性
}

export interface DirectoryV1 {
  id: string
  name: string
  parentId: string | null
  order: number
}

// ===== V2 类型（新版本，基于路径） =====
export interface CodeSnippetV2 {
  name: string
  code: string
  filePath: string
  fileName: string
  category: string
  fullPath: string // 完整路径，如 "/lims/人员选择template"
  order: number
  createTime: number
  language?: string // 代码语言，可选属性
}

export interface DirectoryV2 {
  name: string
  fullPath: string // 完整路径，如 "/lims/"
  order: number
}

// ===== 当前使用的类型别名（指向V1以保持兼容性） =====
export type CodeSnippet = CodeSnippetV1
export type Directory = DirectoryV1

// ===== 导出数据格式 =====
export interface ExportDataV1 {
  version: "1.0.0"
  exportDate: string
  directories: DirectoryV1[]
  snippets: CodeSnippetV1[]
}

export interface ExportDataV2 {
  version: "2.0.0"
  exportDate: string
  directories: DirectoryV2[]
  snippets: CodeSnippetV2[]
}

export type ExportData = ExportDataV1 | ExportDataV2

// 云端同步配置接口
export interface CloudSyncConfig {
  endpoint: string
  accessKey: string
  secretKey: string
  bucket: string
  region: string
  timeout: number // 连接超时时间（秒）
  addressing: 'path-style' | 'virtual-hosted-style'
  autoSync: boolean
  syncInterval: number // 自动同步间隔（秒）
  concurrency: number // 请求并发数
}

// 云端同步状态
export interface CloudSyncStatus {
  isConnected: boolean
  lastSyncTime: number | null
  lastError: string | null
  isSyncing: boolean
}
