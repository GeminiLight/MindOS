export interface SpacePreview {
  instructionLines: string[];
  readmeLines: string[];
  /** True when both files still contain only the default scaffold template. */
  isTemplate?: boolean;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  extension?: string;
  mtime?: number;
  isSpace?: boolean;
  spacePreview?: SpacePreview;
}

export interface SearchResult {
  path: string;
  snippet: string;
  score: number;
  occurrences: number;
}

export interface BacklinkEntry {
  source: string;
  line: number;
  context: string;
}

export interface SearchOptions {
  limit?: number;
  scope?: string;
  file_type?: 'md' | 'csv' | 'all';
  modified_after?: string;
}

export interface GitLogEntry {
  hash: string;
  date: string;
  message: string;
  author: string;
}

export interface MoveResult {
  newPath: string;
  affectedFiles: string[];
}
