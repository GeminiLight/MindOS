export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  extension?: string;
  mtime?: number;
}

export interface SearchMatch {
  indices: [number, number][];
  value: string;
  key: string;
}

export interface SearchResult {
  path: string;
  snippet: string;
  score: number;
  matches?: SearchMatch[];
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface LocalAttachment {
  name: string;
  content: string;
}

export interface ChatSession {
  id: string;
  currentFile?: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

export interface BacklinkEntry {
  filePath: string;
  snippets: string[];
}
