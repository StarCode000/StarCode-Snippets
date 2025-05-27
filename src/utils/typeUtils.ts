import { Directory, CodeSnippet } from '../types/types'

export const isString = (value: any): value is string => typeof value === 'string'
export const isNumber = (value: any): value is number => typeof value === 'number'
export const isBoolean = (value: any): value is boolean => typeof value === 'boolean'
export const isObject = (value: any): value is object => typeof value === 'object' && value !== null
export const isArray = (value: any): value is any[] => Array.isArray(value)
export const isFunction = (value: any): value is Function => typeof value === 'function'
export const isUndefined = (value: any): value is undefined => typeof value === 'undefined'
export const isNull = (value: any): value is null => value === null
export const isRegExp = (value: any): value is RegExp => value instanceof RegExp
export const isDate = (value: any): value is Date => value instanceof Date
export const isError = (value: any): value is Error => value instanceof Error
export const isSymbol = (value: any): value is symbol => typeof value === 'symbol'
export const isPromise = (value: any): value is Promise<any> => value instanceof Promise
export const isArrayBuffer = (value: any): value is ArrayBuffer => value instanceof ArrayBuffer
export const isDataView = (value: any): value is DataView => value instanceof DataView
export const isMap = (value: any): value is Map<any, any> => value instanceof Map
export const isSet = (value: any): value is Set<any> => value instanceof Set

export function isDirectory(item: any): item is Directory {
  return (
    item &&
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    (item.parentId === null || typeof item.parentId === 'string') &&
    typeof item.order === 'number'
  )
}

export function isCodeSnippet(item: any): item is CodeSnippet {
  return (
    item &&
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.code === 'string' &&
    typeof item.filePath === 'string' &&
    typeof item.fileName === 'string' &&
    typeof item.category === 'string' &&
    (item.parentId === null || typeof item.parentId === 'string') &&
    typeof item.order === 'number' &&
    typeof item.createTime === 'number'
  )
}
