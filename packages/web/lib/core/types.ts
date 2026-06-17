export interface SpacePreview {
  instructionLines: string[];
  readmeLines: string[];
  /** True when both files still contain only the default scaffold template. */
  isTemplate?: boolean;
  /** True when README.md specifically contains scaffold template content. */
  readmeIsTemplate?: boolean;
  /** ISO timestamp of last AI-compiled overview, parsed from README footer comment. */
  lastCompiled?: string;
}

export type MindSystemNodeKey = 'dao' | 'fa' | 'shu' | 'qi';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  extension?: string;
  mtime?: number;
  isSpace?: boolean;
  /** Built-in Mind System space; shown as a tree node but protected from rename/delete UI. */
  isMindSystem?: boolean;
  /** Display-only key for built-in Mind System icons. */
  mindSystemKey?: MindSystemNodeKey;
  spacePreview?: SpacePreview;
}

export interface SearchResult {
  path: string;
  snippet: string;
  score: number;
  occurrences: number;
  /** True if this result came from semantic/embedding search but not keyword match. */
  semanticMatch?: boolean;
  /** Cosine similarity score (0-1) from embedding search. */
  similarity?: number;
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
