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

export interface ToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: string;
  state: 'pending' | 'running' | 'done' | 'error';
}

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ReasoningPart {
  type: 'reasoning';
  text: string;
}

export type MessagePart = TextPart | ToolCallPart | ReasoningPart;

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  /** Unix timestamp in milliseconds when this message was created */
  timestamp?: number;
  /** Structured parts for assistant messages (tool calls + text segments) */
  parts?: MessagePart[];
  /** Skill name used for this user message (rendered as a capsule in the UI) */
  skillName?: string;
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
