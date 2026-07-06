export type ImportedRuntimeSessionRole = 'user' | 'assistant';

export type ImportedRuntimeSessionMessage = {
  role: ImportedRuntimeSessionRole;
  content: string;
  timestamp?: number;
};

export type RuntimeSessionTranscriptSource =
  | 'kimi-code'
  | 'gemini-cli'
  | 'opencode'
  | 'claude-code'
  | 'qwen-code'
  | 'codebuddy-code'
  | 'openclaw'
  | 'cursor'
  | 'hermes';

export type RuntimeSessionTranscriptSupportStatus =
  | 'supported'
  | 'unverified'
  | 'unsupported';

export type ExternalRuntimeSessionRecord = {
  id: string;
  title?: string | null;
  preview?: string;
  cwd?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
  status?: string;
  messageCount?: number;
  turnCount?: number;
  turns?: ImportedRuntimeSessionMessage[];
  source: 'native-transcript';
  transcriptSource: RuntimeSessionTranscriptSource;
};

export type ExternalRuntimeSessionListOptions = {
  runtimeId: string;
  cwd?: string;
  sessionId?: string;
  limit?: number;
  homeDir?: string;
};

export type RuntimeSessionTranscriptAdapter = {
  id: string;
  aliases: readonly string[];
  transcriptSource: RuntimeSessionTranscriptSource;
  status: RuntimeSessionTranscriptSupportStatus;
  durable: boolean;
  summary: string;
  listSessions(options: ExternalRuntimeSessionListOptions): Promise<ExternalRuntimeSessionRecord[]>;
};

export type RuntimeSessionTranscriptRuntimeKind = 'acp' | 'claude';

export type RuntimeSessionTranscriptRuntimeIdentity = {
  id: string;
  name: string;
  kind: RuntimeSessionTranscriptRuntimeKind;
};

export type RuntimeSessionTranscriptTarget = {
  cli: string;
  runtime: RuntimeSessionTranscriptRuntimeIdentity;
  adapter: RuntimeSessionTranscriptAdapter;
};

export type MaybeRecord = Record<string, unknown>;
