/**
 * Shared types for MindOS mobile app.
 * Copied from packages/web/lib/types.ts + packages/web/lib/core/types.ts.
 * Keep in sync until these API types are promoted into the product package.
 */

// --- Core domain types (from packages/web/lib/core/types.ts) ---

export interface SpacePreview {
  instructionLines: string[];
  readmeLines: string[];
  isTemplate?: boolean;
  readmeIsTemplate?: boolean;
  lastCompiled?: string;
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

// --- UI / API types (from packages/web/lib/types.ts) ---

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
  data: string;
  mimeType: ImageMimeType;
  fileName?: string;
}

export type MessagePart = TextPart | ToolCallPart | ReasoningPart | ImagePart;

export interface Message {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  parts?: MessagePart[];
  images?: ImagePart[];
  skillName?: string;
  attachedFiles?: string[];
  uploadedFileNames?: string[];
}

export type AskMode = 'chat' | 'agent';

export interface ChatSession {
  id: string;
  title?: string;
  currentFile?: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  pinned?: boolean;
}

// --- API response types ---

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  authRequired: boolean;
}

export interface ConnectResponse {
  url: string;
  ip: string;
  port: number;
  hostname: string;
}

export interface FileSaveResponse {
  ok: boolean;
  mtime?: number;
  error?: string;
  serverMtime?: number;
}

export interface FileDeleteResponse {
  ok: boolean;
  trashId?: string;
}

export interface FileRenameResponse {
  ok: boolean;
  newPath?: string;
}
