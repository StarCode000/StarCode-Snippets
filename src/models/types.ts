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
