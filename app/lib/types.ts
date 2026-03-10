export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  extension?: string;
  mtime?: number;
}

export interface SearchResult {
  path: string;
  snippet: string;
  score: number;
}
