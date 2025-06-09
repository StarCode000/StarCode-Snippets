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

// ===== 已弃用的类型别名（指向V1） =====
export type CodeSnippetDeprecatedType = CodeSnippetV1
export type DirectoryDeprecatedType = DirectoryV1

// ===== 当前使用的类型别名（指向V2） =====
export type CodeSnippet = CodeSnippetV2
export type Directory = DirectoryV2

// ===== 导出数据格式 =====
export interface ExportDataV1 {
  version: '1.0.0'
  exportDate: string
  directories: DirectoryV1[]
  snippets: CodeSnippetV1[]
}

export interface ExportDataV2 {
  version: '2.0.0'
  exportDate: string
  directories: DirectoryV2[]
  snippets: CodeSnippetV2[]
}

export type ExportData = ExportDataV1 | ExportDataV2

// 云端同步配置接口 (Updated for Git) - 向后兼容接口
export interface CloudSyncConfig {
  provider: 'github' | 'gitlab' | 'gitee' // Git 平台
  repositoryUrl: string // 仓库 URL
  token: string // 访问令牌
  localPath: string // 本地Git仓库路径
  defaultBranch: string // 默认分支名
  authenticationMethod: 'token' | 'ssh' // 认证方式
  sshKeyPath: string // SSH密钥路径 (当使用SSH认证时)
  autoSync: boolean // 是否启用自动同步
  syncInterval: number // 自动同步间隔（分钟）
  commitMessageTemplate: string // 提交信息模板
}

// 云端同步状态
export interface CloudSyncStatus {
  isConnected: boolean
  lastSyncTime: number | null
  lastError: string | null
  isSyncing: boolean
}

// 新增：支持多平台配置存储
export interface GitPlatformConfig {
  id: string // 配置唯一标识符
  provider: 'github' | 'gitlab' | 'gitee' // Git 平台
  repositoryUrl: string // 仓库 URL
  token: string // 访问令牌
  localPath: string // 本地Git仓库路径，可为空使用默认路径
  defaultBranch: string // 默认分支名
  authenticationMethod: 'token' | 'ssh' // 认证方式
  sshKeyPath: string // SSH密钥路径 (当使用SSH认证时)
  commitMessageTemplate: string // 提交信息模板
  name: string // 配置名称，用于在UI中显示
  isActive: boolean // 是否为当前激活的配置
}

// 更新云端同步配置接口，支持多平台
export interface MultiPlatformCloudSyncConfig {
  platforms: GitPlatformConfig[] // 多平台配置列表
  autoSync: boolean // 是否启用自动同步
  syncInterval: number // 自动同步间隔（分钟）
  activeConfigId: string | null // 当前激活的配置ID
}
