// src/models/types.ts
export interface CodeSnippet {
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

export interface Directory {
  id: string
  name: string
  parentId: string | null
  order: number
}

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
