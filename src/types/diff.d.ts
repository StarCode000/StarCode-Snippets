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

declare module 'node-diff3' {
  export interface MergeOptions {
    excludeFalseConflicts?: boolean;
    stringSeparator?: string | RegExp;
  }

  export interface MergeBlock {
    ok?: string[];
    conflict?: {
      a: string[];
      aIndex: number;
      o: string[];
      oIndex: number;
      b: string[];
      bIndex: number;
    };
  }

  export type MergeResult = MergeBlock[];

  export function diff3Merge(
    a: string[] | string, 
    o: string[] | string, 
    b: string[] | string, 
    options?: MergeOptions
  ): MergeResult;
} 