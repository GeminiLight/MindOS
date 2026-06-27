import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { effectiveMindRoot } from '../../foundation/mind-root/index.js';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import {
  AGENT_ARTIFACT_LEDGER_SHARD_KEY,
  AGENT_ARTIFACT_LEDGER_STORE_KEY,
  deleteProcessGlobal,
  getProcessGlobal,
} from '../global-state.js';
import { redactSensitiveObject, redactSensitiveText } from '../redaction.js';
import type { AcpContentBlock, AcpToolCallFull } from '../../protocols/acp/types.js';
import type { AgentNodeKind } from './run-ledger-types.js';

/**
 * Cross-runtime artifact ledger — pointer index only.
 *
 * Runtimes keep their own full transcript and blob/archive data. This ledger
 * persists safe pointers that let MindOS build preview, artifact, and file
 * change panels without copying transcripts, command output, env, headers, or
 * base64 blobs into a second store.
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

type ArtifactLedgerStore = {
  records: AgentArtifactLedgerRecord[];
  mindRoot?: string;
};

type ArtifactShardOperation =
  | { version: 1; type: 'artifact_upsert'; ts: number; record: AgentArtifactLedgerRecord };

const MAX_ARTIFACTS = 1000;
const MAX_TEXT_CHARS = 1000;
const MAX_PATH_CHARS = 1200;
const LEDGER_DIR_NAME = '.mindos';
const SHARD_FILE_PATTERN = /^agent-artifact-ledger\.(\d+)-(\d+)\.jsonl$/;
const IMAGE_EXTENSION_RE = /\.(?:png|jpe?g|webp|gif|svg)$/i;
const PATCH_EXTENSION_RE = /\.(?:patch|diff)$/i;
const BRANCH_URI_RE = /^(?:git:)?branch:/i;
const PR_URI_RE = /^(?:https?:\/\/|git:)?(?:pull-request|pr)[:/]/i;
const INLINE_BLOB_PREFIX_RE = /^(?:data:|iVBORw0KGgo|\/9j\/|UklGR)/;

function shardIdentity(): { pid: number; startTs: number } {
  return getProcessGlobal(AGENT_ARTIFACT_LEDGER_SHARD_KEY, () => ({
    pid: process.pid,
    startTs: Math.round(performance.timeOrigin),
  }));
}

function resolveLedgerRoot(): string | undefined {
  try {
    const root = effectiveMindRoot();
    return typeof root === 'string' && root.trim() ? root : undefined;
  } catch {
    return undefined;
  }
}

function ledgerDirPath(mindRoot: string): string {
  return resolveExistingSafe(mindRoot, LEDGER_DIR_NAME);
}

function ownShardPath(mindRoot: string): string {
  const { pid, startTs } = shardIdentity();
  return resolveExistingSafe(
    mindRoot,
    path.posix.join(LEDGER_DIR_NAME, `agent-artifact-ledger.${pid}-${startTs}.jsonl`),
  );
}

function emptyStore(mindRoot?: string): ArtifactLedgerStore {
  return { records: [], ...(mindRoot ? { mindRoot } : {}) };
}

function getStore(): ArtifactLedgerStore {
  const mindRoot = resolveLedgerRoot();
  const store = getProcessGlobal<ArtifactLedgerStore>(
    AGENT_ARTIFACT_LEDGER_STORE_KEY,
    () => (mindRoot ? readPersistedStore(mindRoot) : emptyStore()),
  );
  if (store.mindRoot !== mindRoot) {
    deleteProcessGlobal(AGENT_ARTIFACT_LEDGER_STORE_KEY);
    return getProcessGlobal<ArtifactLedgerStore>(
      AGENT_ARTIFACT_LEDGER_STORE_KEY,
      () => (mindRoot ? readPersistedStore(mindRoot) : emptyStore()),
    );
  }
  return store;
}

function listShardFiles(mindRoot: string): string[] {
  try {
    const dir = ledgerDirPath(mindRoot);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((name) => SHARD_FILE_PATTERN.test(name))
      .sort()
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

function readPersistedStore(mindRoot: string): ArtifactLedgerStore {
  const recordsById = new Map<string, AgentArtifactLedgerRecord>();
  for (const file of listShardFiles(mindRoot)) {
    try {
      for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let op: Partial<ArtifactShardOperation>;
        try { op = JSON.parse(trimmed) as Partial<ArtifactShardOperation>; } catch { continue; }
        if (op.version !== 1 || op.type !== 'artifact_upsert') continue;
        const record = normalizePersistedRecord(op.record);
        if (!record) continue;
        const existing = recordsById.get(record.id);
        if (!existing || record.updatedAt >= existing.updatedAt) recordsById.set(record.id, record);
      }
    } catch {
      // A torn or unreadable shard must never block artifact projection.
    }
  }
  return {
    mindRoot,
    records: [...recordsById.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_ARTIFACTS),
  };
}

function appendOwnShardOperation(store: ArtifactLedgerStore, record: AgentArtifactLedgerRecord): void {
  if (!store.mindRoot) return;
  try {
    const file = ownShardPath(store.mindRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const op: ArtifactShardOperation = {
      version: 1,
      type: 'artifact_upsert',
      ts: Date.now(),
      record,
    };
    fs.appendFileSync(file, `${JSON.stringify(op)}\n`, 'utf-8');
  } catch {
    // Artifact persistence is diagnostic; it must not affect runtime execution.
  }
}

export function appendAgentArtifact(input: AppendAgentArtifactInput): AgentArtifactLedgerRecord | undefined {
  const normalized = normalizeArtifactInput(input);
  if (!normalized) return undefined;

  const store = getStore();
  const existingIndex = store.records.findIndex((record) => record.id === normalized.id);
  const existing = existingIndex >= 0 ? store.records[existingIndex] : undefined;
  const record: AgentArtifactLedgerRecord = {
    ...existing,
    ...normalized,
    createdAt: existing?.createdAt ?? normalized.createdAt,
    updatedAt: normalized.updatedAt,
    metadata: mergeMetadata(existing?.metadata, normalized.metadata),
  };

  if (existingIndex >= 0) {
    store.records[existingIndex] = record;
  } else {
    store.records.unshift(record);
  }
  store.records = store.records
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_ARTIFACTS);
  appendOwnShardOperation(store, record);
  return record;
}

export function listAgentArtifacts(options: ListAgentArtifactsOptions = {}): AgentArtifactLedgerRecord[] {
  const limit = Math.max(1, Math.min(options.limit ?? MAX_ARTIFACTS, MAX_ARTIFACTS));
  return getStore().records
    .filter((record) => !options.runtimeId || record.runtimeId === options.runtimeId)
    .filter((record) => !options.sessionId || record.sessionId === options.sessionId)
    .filter((record) => !options.externalSessionId || record.externalSessionId === options.externalSessionId)
    .filter((record) => !options.runId || record.runId === options.runId)
    .filter((record) => !options.toolCallId || record.toolCallId === options.toolCallId)
    .filter((record) => !options.kind || record.kind === options.kind)
    .filter((record) => !options.source || record.source === options.source)
    .slice(0, limit);
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

export function reloadAgentArtifactsFromDiskForTest(): void {
  deleteProcessGlobal(AGENT_ARTIFACT_LEDGER_STORE_KEY);
  getStore();
}

export function resetAgentArtifactsForTest(): void {
  deleteProcessGlobal(AGENT_ARTIFACT_LEDGER_STORE_KEY);
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
