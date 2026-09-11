import { createHash } from 'node:crypto';
import type { MindosDatabase } from '../../foundation/storage/sqlite.js';
import {
  AGENT_ARTIFACT_LEDGER_STORE_KEY,
  deleteProcessGlobal,
  getProcessGlobal,
} from '../global-state.js';
import { redactSensitiveObject, redactSensitiveText } from '../../foundation/security/redaction.js';
import type { AcpContentBlock, AcpToolCallFull } from '../runtime/acp-types.js';
import {
  ARTIFACT_TRIM_SLACK,
  MAX_ARTIFACTS,
  hasLegacyArtifactShards,
  importLegacyArtifactShards,
  listArtifactRows,
  pruneArtifacts,
  readArtifactRow,
  removeLegacyArtifactFiles,
  upsertArtifact,
} from './artifact-ledger-db.js';
import {
  agentLedgerMindRoot,
  agentLedgerOwnerIdentity,
  getAgentLedgerDatabase,
  reloadAgentRunsFromDiskForTest,
} from './run-ledger.js';
import type { AgentNodeKind } from './run-ledger-types.js';

/**
 * Cross-runtime artifact ledger — pointer index only.
 *
 * Runtimes keep their own full transcript and blob/archive data. This ledger
 * persists safe pointers that let MindOS build preview, artifact, and file
 * change panels without copying transcripts, command output, env, headers, or
 * base64 blobs into a second store.
 *
 * Persistence (spec-ledger-write-cost P2): table `agent_artifacts` in the run
 * ledger database (`<mindRoot>/.mindos/db/agent_runs_1.sqlite`), so every
 * MindOS process sees every other process's artifacts on its next read.
 * Legacy per-process JSONL shards are imported once on first use.
 */

export type AgentArtifactKind =
  | 'file'
  | 'image'
  | 'diff'
  | 'patch'
  | 'checkpoint'
  | 'branch'
  | 'pr'
  | 'uri'
  | 'unknown';

export type AgentArtifactSource =
  | 'acp-tool-call'
  | 'runtime-output'
  | 'manual';

export type AgentArtifactStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'unknown';

export type AgentArtifactLedgerRecord = {
  schemaVersion: 1;
  id: string;
  runtimeId: string;
  agentKind: AgentNodeKind;
  source: AgentArtifactSource;
  kind: AgentArtifactKind;
  status: AgentArtifactStatus;
  createdAt: number;
  updatedAt: number;
  sessionId?: string;
  externalSessionId?: string;
  runId?: string;
  toolCallId?: string;
  toolName?: string;
  title?: string;
  summary?: string;
  cwd?: string;
  path?: string;
  line?: number;
  uri?: string;
  mimeType?: string;
  size?: number;
  metadata?: Record<string, unknown>;
};

export type AppendAgentArtifactInput = {
  id?: string;
  runtimeId: string;
  agentKind?: AgentNodeKind;
  source: AgentArtifactSource;
  kind?: AgentArtifactKind;
  status?: AgentArtifactStatus;
  sessionId?: string;
  externalSessionId?: string;
  runId?: string;
  toolCallId?: string;
  toolName?: string;
  title?: string;
  summary?: string;
  cwd?: string;
  path?: string;
  line?: number;
  uri?: string;
  mimeType?: string;
  size?: number;
  metadata?: Record<string, unknown>;
};

export type ListAgentArtifactsOptions = {
  runtimeId?: string;
  sessionId?: string;
  externalSessionId?: string;
  runId?: string;
  toolCallId?: string;
  kind?: AgentArtifactKind;
  source?: AgentArtifactSource;
  limit?: number;
};

export type RecordArtifactsFromAcpToolCallInput = {
  runtimeId: string;
  sessionId: string;
  externalSessionId?: string;
  runId?: string;
  cwd?: string;
  toolCall: AcpToolCallFull;
};

/** Per-process bookkeeping; the rows themselves live in the shared database. */
type ArtifactLedgerProcessState = {
  /** Handles whose legacy shards were already imported. */
  importedFor: WeakSet<MindosDatabase>;
  /** Appends since the last prune (amortized like run events). */
  appendsSincePrune: number;
};

const MAX_TEXT_CHARS = 1000;
const MAX_PATH_CHARS = 1200;
const IMAGE_EXTENSION_RE = /\.(?:png|jpe?g|webp|gif|svg)$/i;
const PATCH_EXTENSION_RE = /\.(?:patch|diff)$/i;
const BRANCH_URI_RE = /^(?:git:)?branch:/i;
const PR_URI_RE = /^(?:https?:\/\/|git:)?(?:pull-request|pr)[:/]/i;
const INLINE_BLOB_PREFIX_RE = /^(?:data:|iVBORw0KGgo|\/9j\/|UklGR)/;

function getArtifactState(): ArtifactLedgerProcessState {
  return getProcessGlobal<ArtifactLedgerProcessState>(
    AGENT_ARTIFACT_LEDGER_STORE_KEY,
    () => ({ importedFor: new WeakSet(), appendsSincePrune: 0 }),
  );
}

/**
 * The shared ledger handle, importing legacy shards the first time a handle
 * is used. Read paths pass `create: false` and get null while nothing has
 * been persisted yet — unless legacy shards are waiting to be imported.
 */
function getArtifactDb(options: { create: boolean }): MindosDatabase | null {
  const mindRoot = agentLedgerMindRoot();
  const create = options.create || (mindRoot !== undefined && hasLegacyArtifactShards(mindRoot));
  const db = getAgentLedgerDatabase({ create });
  if (!db) return null;
  const state = getArtifactState();
  if (!state.importedFor.has(db)) {
    state.importedFor.add(db);
    if (mindRoot) importLegacyArtifactShards(db, mindRoot, agentLedgerOwnerIdentity(), normalizePersistedRecord);
  }
  return db;
}

export function appendAgentArtifact(input: AppendAgentArtifactInput): AgentArtifactLedgerRecord | undefined {
  const normalized = normalizeArtifactInput(input);
  if (!normalized) return undefined;
  try {
    const db = getArtifactDb({ create: true });
    if (!db) return undefined;
    const existing = readArtifactRow(db, normalized.id);
    const record: AgentArtifactLedgerRecord = {
      ...existing,
      ...normalized,
      createdAt: existing?.createdAt ?? normalized.createdAt,
      updatedAt: normalized.updatedAt,
      metadata: mergeMetadata(existing?.metadata, normalized.metadata),
    };
    upsertArtifact(db, record);
    const state = getArtifactState();
    state.appendsSincePrune += 1;
    if (state.appendsSincePrune >= ARTIFACT_TRIM_SLACK) {
      state.appendsSincePrune = 0;
      pruneArtifacts(db);
    }
    return record;
  } catch {
    // Artifact persistence is diagnostic; it must not affect runtime execution.
    return undefined;
  }
}

export function listAgentArtifacts(options: ListAgentArtifactsOptions = {}): AgentArtifactLedgerRecord[] {
  const limit = Math.max(1, Math.min(options.limit ?? MAX_ARTIFACTS, MAX_ARTIFACTS));
  try {
    const db = getArtifactDb({ create: false });
    if (!db) return [];
    return listArtifactRows(db, options, limit);
  } catch {
    return [];
  }
}

export function recordArtifactsFromAcpToolCall(input: RecordArtifactsFromAcpToolCallInput): AgentArtifactLedgerRecord[] {
  const pointers = artifactPointersFromAcpToolCall(input.toolCall);
  const records: AgentArtifactLedgerRecord[] = [];
  for (const pointer of pointers) {
    const record = appendAgentArtifact({
      runtimeId: input.runtimeId,
      agentKind: 'acp',
      source: 'acp-tool-call',
      status: normalizeArtifactStatus(input.toolCall.status),
      sessionId: input.sessionId,
      externalSessionId: input.externalSessionId,
      runId: input.runId,
      cwd: input.cwd,
      toolCallId: input.toolCall.toolCallId,
      toolName: input.toolCall.kind ?? 'tool',
      title: input.toolCall.title,
      summary: pointer.summary,
      path: pointer.path,
      line: pointer.line,
      uri: pointer.uri,
      mimeType: pointer.mimeType,
      kind: pointer.kind ?? kindFromAcpToolCall(input.toolCall, pointer),
      metadata: {
        sourceStatus: input.toolCall.status,
        ...(input.toolCall.kind ? { acpToolKind: input.toolCall.kind } : {}),
      },
    });
    if (record) records.push(record);
  }
  return records;
}

/** Test-only: drop the shared handle so the next access re-opens the database and re-imports legacy shards. */
export function reloadAgentArtifactsFromDiskForTest(): void {
  deleteProcessGlobal(AGENT_ARTIFACT_LEDGER_STORE_KEY);
  reloadAgentRunsFromDiskForTest();
}

/**
 * Test-only: forget per-process artifact state (import markers, prune
 * counter) and delete legacy shard files under the current mind root. Rows
 * stay in the database; `resetAgentRunsForTest` empties the whole ledger.
 */
export function resetAgentArtifactsForTest(): void {
  deleteProcessGlobal(AGENT_ARTIFACT_LEDGER_STORE_KEY);
  const mindRoot = agentLedgerMindRoot();
  if (mindRoot) removeLegacyArtifactFiles(mindRoot);
}

function artifactPointersFromAcpToolCall(toolCall: AcpToolCallFull): Array<{
  path?: string;
  line?: number;
  uri?: string;
  mimeType?: string;
  kind?: AgentArtifactKind;
  summary?: string;
}> {
  const pointers: Array<{
    path?: string;
    line?: number;
    uri?: string;
    mimeType?: string;
    kind?: AgentArtifactKind;
    summary?: string;
  }> = [];

  for (const location of toolCall.locations ?? []) {
    if (!location?.path) continue;
    pointers.push({
      path: location.path,
      ...(Number.isFinite(location.line) ? { line: location.line } : {}),
      kind: kindFromPath(location.path),
      summary: toolCall.title,
    });
  }

  for (const block of toolCall.content ?? []) {
    const pointer = pointerFromContentBlock(block);
    if (pointer) pointers.push(pointer);
  }

  return dedupePointers(pointers);
}

function pointerFromContentBlock(block: AcpContentBlock): {
  path?: string;
  uri?: string;
  mimeType?: string;
  kind?: AgentArtifactKind;
  summary?: string;
} | null {
  if (block.type === 'resource_link') {
    return pointerFromUri(block.uri, block.name);
  }
  if (block.type === 'resource') {
    return pointerFromUri(block.resource.uri);
  }
  if (block.type === 'image' && block.mimeType && !INLINE_BLOB_PREFIX_RE.test(block.data)) {
    return {
      uri: truncateText(block.data, MAX_PATH_CHARS),
      mimeType: truncateText(block.mimeType, 120),
      kind: 'image',
    };
  }
  return null;
}

function pointerFromUri(uri: string, title?: string): {
  path?: string;
  uri?: string;
  mimeType?: string;
  kind?: AgentArtifactKind;
  summary?: string;
} | null {
  const normalized = sanitizePointerText(uri, MAX_PATH_CHARS);
  if (!normalized || INLINE_BLOB_PREFIX_RE.test(normalized)) return null;
  if (normalized.startsWith('file://')) {
    const filePath = normalized.slice('file://'.length);
    return {
      path: filePath,
      uri: normalized,
      kind: kindFromPath(filePath),
      ...(title ? { summary: sanitizePointerText(title, MAX_TEXT_CHARS) } : {}),
    };
  }
  return {
    uri: normalized,
    kind: kindFromUri(normalized),
    ...(title ? { summary: sanitizePointerText(title, MAX_TEXT_CHARS) } : {}),
  };
}

function normalizeArtifactInput(input: AppendAgentArtifactInput): AgentArtifactLedgerRecord | null {
  const runtimeId = sanitizePointerText(input.runtimeId, 160);
  if (!runtimeId) return null;
  const pathValue = sanitizePointerText(input.path, MAX_PATH_CHARS);
  const uriValue = sanitizePointerText(input.uri, MAX_PATH_CHARS);
  if (!pathValue && !uriValue && !input.id) return null;
  const now = Date.now();
  const baseForId = input.id ?? [
    runtimeId,
    input.sessionId,
    input.externalSessionId,
    input.runId,
    input.toolCallId,
    pathValue,
    input.line,
    uriValue,
  ].filter((part) => part !== undefined && part !== '').join('|');
  const id = sanitizePointerText(input.id, 240) ?? `artifact-${hashText(baseForId)}`;
  return {
    schemaVersion: 1,
    id,
    runtimeId,
    agentKind: input.agentKind ?? 'acp',
    source: input.source,
    kind: input.kind ?? kindFromPath(pathValue) ?? kindFromUri(uriValue) ?? 'unknown',
    status: normalizeArtifactStatus(input.status),
    createdAt: now,
    updatedAt: now,
    ...(sanitizePointerText(input.sessionId, 240) ? { sessionId: sanitizePointerText(input.sessionId, 240) } : {}),
    ...(sanitizePointerText(input.externalSessionId, 240) ? { externalSessionId: sanitizePointerText(input.externalSessionId, 240) } : {}),
    ...(sanitizePointerText(input.runId, 240) ? { runId: sanitizePointerText(input.runId, 240) } : {}),
    ...(sanitizePointerText(input.toolCallId, 240) ? { toolCallId: sanitizePointerText(input.toolCallId, 240) } : {}),
    ...(sanitizePointerText(input.toolName, 240) ? { toolName: sanitizePointerText(input.toolName, 240) } : {}),
    ...(sanitizePointerText(input.title, 300) ? { title: sanitizePointerText(input.title, 300) } : {}),
    ...(sanitizePointerText(input.summary, MAX_TEXT_CHARS) ? { summary: sanitizePointerText(input.summary, MAX_TEXT_CHARS) } : {}),
    ...(sanitizePointerText(input.cwd, MAX_PATH_CHARS) ? { cwd: sanitizePointerText(input.cwd, MAX_PATH_CHARS) } : {}),
    ...(pathValue ? { path: pathValue } : {}),
    ...(Number.isFinite(input.line) && input.line !== undefined ? { line: Math.max(1, Math.floor(input.line)) } : {}),
    ...(uriValue ? { uri: uriValue } : {}),
    ...(sanitizePointerText(input.mimeType, 120) ? { mimeType: sanitizePointerText(input.mimeType, 120) } : {}),
    ...(typeof input.size === 'number' && Number.isFinite(input.size) && input.size >= 0 ? { size: Math.floor(input.size) } : {}),
    ...(input.metadata ? { metadata: sanitizeMetadata(input.metadata) } : {}),
  };
}

function normalizePersistedRecord(value: unknown): AgentArtifactLedgerRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<AgentArtifactLedgerRecord>;
  if (record.schemaVersion !== 1) return null;
  if (typeof record.id !== 'string' || typeof record.runtimeId !== 'string') return null;
  if (!isArtifactSource(record.source) || !isArtifactKind(record.kind) || !isArtifactStatus(record.status)) return null;
  if (typeof record.createdAt !== 'number' || typeof record.updatedAt !== 'number') return null;
  const normalized = normalizeArtifactInput({
    ...record,
    id: record.id,
    runtimeId: record.runtimeId,
    source: record.source,
    kind: record.kind,
    status: record.status,
  });
  if (!normalized) return null;
  return {
    ...normalized,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function normalizeArtifactStatus(status: unknown): AgentArtifactStatus {
  if (status === 'pending' || status === 'in_progress' || status === 'completed' || status === 'failed') return status;
  return 'unknown';
}

function isArtifactSource(source: unknown): source is AgentArtifactSource {
  return source === 'acp-tool-call' || source === 'runtime-output' || source === 'manual';
}

function isArtifactKind(kind: unknown): kind is AgentArtifactKind {
  return kind === 'file'
    || kind === 'image'
    || kind === 'diff'
    || kind === 'patch'
    || kind === 'checkpoint'
    || kind === 'branch'
    || kind === 'pr'
    || kind === 'uri'
    || kind === 'unknown';
}

function isArtifactStatus(status: unknown): status is AgentArtifactStatus {
  return status === 'pending'
    || status === 'in_progress'
    || status === 'completed'
    || status === 'failed'
    || status === 'unknown';
}

function kindFromAcpToolCall(
  toolCall: AcpToolCallFull,
  pointer: { path?: string; uri?: string; kind?: AgentArtifactKind },
): AgentArtifactKind {
  if (pointer.kind) return pointer.kind;
  const pathKind = kindFromPath(pointer.path);
  if (pathKind) return pathKind;
  const uriKind = kindFromUri(pointer.uri);
  if (uriKind) return uriKind;
  if (toolCall.kind === 'edit' || toolCall.kind === 'read' || toolCall.kind === 'delete' || toolCall.kind === 'move' || toolCall.kind === 'search') {
    return 'file';
  }
  return 'unknown';
}

function kindFromPath(value: string | undefined): AgentArtifactKind | undefined {
  if (!value) return undefined;
  if (IMAGE_EXTENSION_RE.test(value)) return 'image';
  if (PATCH_EXTENSION_RE.test(value)) return value.toLowerCase().endsWith('.patch') ? 'patch' : 'diff';
  return 'file';
}

function kindFromUri(value: string | undefined): AgentArtifactKind | undefined {
  if (!value) return undefined;
  if (BRANCH_URI_RE.test(value)) return 'branch';
  if (PR_URI_RE.test(value)) return 'pr';
  if (IMAGE_EXTENSION_RE.test(value)) return 'image';
  if (PATCH_EXTENSION_RE.test(value)) return value.toLowerCase().endsWith('.patch') ? 'patch' : 'diff';
  return 'uri';
}

function dedupePointers<T extends { path?: string; line?: number; uri?: string }>(pointers: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const pointer of pointers) {
    const key = `${pointer.path ?? ''}:${pointer.line ?? ''}:${pointer.uri ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(pointer);
  }
  return deduped;
}

function sanitizePointerText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = redactSensitiveText(value).trim();
  if (!text || INLINE_BLOB_PREFIX_RE.test(text)) return undefined;
  return truncateText(text, maxLength);
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return redactSensitiveObject(metadata) as Record<string, unknown>;
}

function mergeMetadata(
  existing: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!existing && !next) return undefined;
  return sanitizeMetadata({ ...(existing ?? {}), ...(next ?? {}) });
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}
