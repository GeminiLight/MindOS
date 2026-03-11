// Re-export core types as single source of truth
export type { FileNode, SearchResult, BacklinkEntry } from './core/types';

export interface SearchMatch {
  indices: [number, number][];
  value: string;
  key: string;
}

/** Frontend-facing backlink shape returned by /api/backlinks (transformed from core BacklinkEntry) */
export interface BacklinkItem {
  filePath: string;
  snippets: string[];
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
