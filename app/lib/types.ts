// Re-export core types as single source of truth
export type { FileNode, SearchResult, BacklinkEntry } from './core/types';

/** System configuration files that should be hidden from file tree by default */
export const SYSTEM_FILES = new Set([
  'INSTRUCTION.md',
  'README.md',
  'CONFIG.json',
  'CHANGELOG.md',
]);

/** Root-level files that users can see but cannot delete */
export const UNDELETABLE_FILES = new Set([
  'TODO.md',
]);

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

export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface ImagePart {
  type: 'image';
  /** Base64-encoded image data (no data: prefix) */
  data: string;
  mimeType: ImageMimeType;
}

export type MessagePart = TextPart | ToolCallPart | ReasoningPart | ImagePart;

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  /** Unix timestamp in milliseconds when this message was created */
  timestamp?: number;
  /** Structured parts for assistant messages (tool calls + text segments) */
  parts?: MessagePart[];
  /** Images attached to this message (user messages only) */
  images?: ImagePart[];
  /** Skill name used for this user message (rendered as a capsule in the UI) */
  skillName?: string;
}

export interface LocalAttachment {
  name: string;
  content: string;
}

/** User-facing Ask modes. 'organize' is internal-only (not selectable by users). */
export type AskMode = 'chat' | 'agent';

/** All Ask modes including internal ones sent to the API */
export type AskModeApi = AskMode | 'organize';

export interface ChatSession {
  id: string;
  title?: string;
  currentFile?: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  pinned?: boolean;
}
