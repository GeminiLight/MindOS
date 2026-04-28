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

export type SearchPrewarmCacheState = 'hit' | 'built';

export interface SearchPrewarmResponse {
  warmed: true;
  cacheState: SearchPrewarmCacheState;
  documentCount: number;
}

export type SearchWarmState = 'idle' | 'warming' | 'ready' | 'fallback';

export interface SearchWarmHintMessages {
  preparing: string;
  fallbackWarmHint: string;
}

export interface SearchPrewarmEligibility {
  active: boolean;
  hasAttemptedPrewarm: boolean;
  warmState: SearchWarmState;
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
  /** Original file name, if available */
  fileName?: string;
}

export type MessagePart = TextPart | ToolCallPart | ReasoningPart | ImagePart;

export interface AgentIdentity {
  id: string;
  name: string;
}

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
  /** KB file paths (@mentions) sent with this message */
  attachedFiles?: string[];
  /** Names of uploaded files (PDFs etc.) sent with this message */
  uploadedFileNames?: string[];
  /** Agent attribution for this message when routed via ACP or rendered by MindOS */
  agentId?: string;
  agentName?: string;
}

export interface LocalAttachment {
  name: string;
  content: string;
  /** Extraction status for PDF uploads. Absent / undefined = legacy (treated as success). */
  status?: 'loading' | 'success' | 'error';
  /** Human-readable error message (only when status = 'error'). */
  error?: string;
  /** Present when the full text was too long and had to be truncated. */
  truncatedInfo?: {
    totalChars: number;
    includedChars: number;
    totalPages: number;
    warning?: string;
  };
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
  /** Session-level ACP agent selection restored when the session becomes active */
  defaultAcpAgent?: AgentIdentity | null;
}
