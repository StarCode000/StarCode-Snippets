declare module 'diff' {
  export interface Change {
    count?: number;
    value: string;
    added?: boolean;
    removed?: boolean;
  }

  export function diffLines(oldStr: string, newStr: string): Change[];
  export function diffWordsWithSpace(oldStr: string, newStr: string): Change[];
  export function diffChars(oldStr: string, newStr: string): Change[];
  export function diffWords(oldStr: string, newStr: string): Change[];
}

declare module 'diff3' {
  export interface MergeResult {
    conflict: boolean;
    result: string[];
  }

  export function diff3Merge(a: string, o: string, b: string): MergeResult;
} 