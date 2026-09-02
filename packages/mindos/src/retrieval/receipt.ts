import crypto from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { redactSensitiveText } from '../agent/redaction.js';
import { resolveExistingSafe } from '../foundation/security/index.js';

export type RetrievalReceiptOutcome = 'selected' | 'empty' | 'timeout' | 'error' | 'skipped';

export type RetrievalReceiptBudget = {
  maxTokens: number;
  maxFiles: number;
  minScore: number;
  timeoutMs: number;
};

export type RetrievalReceiptCandidate = {
  assetId?: string;
  path: string;
  score: number;
  selected: boolean;
  reason: string;
};

export type RetrievalReceiptSelection = {
  assetId: string;
  path: string;
  score: number;
  startLine?: number;
  endLine?: number;
  headingPath?: string[];
  estimatedTokens: number;
  truncated: boolean;
  reason: string;
};

export type RetrievalReceipt = {
  schemaVersion: 1;
  id: string;
  queryHash: string;
  queryPreview: string;
  strategy: string;
  outcome: RetrievalReceiptOutcome;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  budget: RetrievalReceiptBudget;
  scope: {
    preferredPaths: string[];
    excludePaths: string[];
  };
  candidates: RetrievalReceiptCandidate[];
  selections: RetrievalReceiptSelection[];
  totals: {
    candidateCount: number;
    selectedCount: number;
    usedTokens: number;
  };
  error?: string;
  metadata?: {
    chatSessionId?: string;
    runId?: string;
    automationId?: string;
    trigger?: string;
  };
};

export type WriteRetrievalReceiptInput = Omit<RetrievalReceipt, 'schemaVersion' | 'queryHash' | 'queryPreview' | 'durationMs'> & {
  query: string;
  metadata?: Record<string, unknown>;
};

export type ListRetrievalReceiptsOptions = {
  outcome?: RetrievalReceiptOutcome;
  assetId?: string;
  chatSessionId?: string;
  limit?: number;
};

const RECEIPTS_ROOT = '.mindos/retrieval-receipts';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_CANDIDATES = 100;
const MAX_SELECTIONS = 20;
const MAX_PATHS = 50;
const MAX_ERROR_CHARS = 280;

export function writeRetrievalReceipt(mindRoot: string, input: WriteRetrievalReceiptInput): RetrievalReceipt {
  const receipt = normalizeReceiptInput(input);
  const started = new Date(receipt.startedAt);
  const relativeDir = `${RECEIPTS_ROOT}/${started.getUTCFullYear()}/${String(started.getUTCMonth() + 1).padStart(2, '0')}`;
  const directory = resolveExistingSafe(mindRoot, relativeDir);
  mkdirSync(directory, { recursive: true });
  const file = resolveExistingSafe(mindRoot, `${relativeDir}/${receipt.id}.json`);
  if (existsSync(file)) {
    const existing = readReceiptFile(file);
    if (existing && JSON.stringify(existing) === JSON.stringify(receipt)) return existing;
    throw new Error(`Retrieval receipt immutable id collision: ${receipt.id}`);
  }
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
    try {
      // A hard-link publish is atomic and exclusive. rename() would replace an
      // existing destination on POSIX, which can violate receipt immutability
      // when two processes publish the same id concurrently.
      linkSync(temp, file);
    } catch (error) {
      if (isAlreadyExists(error)) {
        const existing = readReceiptFile(file);
        if (existing && JSON.stringify(existing) === JSON.stringify(receipt)) {
          unlinkSync(temp);
          return existing;
        }
        throw new Error(`Retrieval receipt immutable id collision: ${receipt.id}`);
      }
      throw error;
    }
    unlinkSync(temp);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* best-effort cleanup */ }
    throw error;
  }
  return receipt;
}

export function getRetrievalReceipt(mindRoot: string, receiptId: string): RetrievalReceipt | null {
  if (!SAFE_ID.test(receiptId)) return null;
  return listReceiptFiles(mindRoot)
    .map(readReceiptFile)
    .find((receipt): receipt is RetrievalReceipt => receipt?.id === receiptId) ?? null;
}

export function listRetrievalReceipts(
  mindRoot: string,
  options: ListRetrievalReceiptsOptions = {},
): RetrievalReceipt[] {
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(500, Math.floor(options.limit!)))
    : 100;
  return listReceiptFiles(mindRoot)
    .map(readReceiptFile)
    .filter((receipt): receipt is RetrievalReceipt => receipt !== null)
    .filter((receipt) => !options.outcome || receipt.outcome === options.outcome)
    .filter((receipt) => !options.assetId || receipt.selections.some((selection) => selection.assetId === options.assetId))
    .filter((receipt) => !options.chatSessionId || receipt.metadata?.chatSessionId === options.chatSessionId)
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt) || right.id.localeCompare(left.id))
    .slice(0, limit);
}

function listReceiptFiles(mindRoot: string): string[] {
  try {
    const root = resolveExistingSafe(mindRoot, RECEIPTS_ROOT);
    if (!existsSync(root) || !statSync(root).isDirectory()) return [];
    const files: string[] = [];
    for (const year of safeDirectories(root)) {
      for (const month of safeDirectories(path.join(root, year))) {
        const directory = path.join(root, year, month);
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith('.json')) files.push(path.join(directory, entry.name));
        }
      }
    }
    return files;
  } catch {
    return [];
  }
}

function safeDirectories(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name);
}

function readReceiptFile(file: string): RetrievalReceipt | null {
  try {
    return normalizeStoredReceipt(JSON.parse(readFileSync(file, 'utf-8')));
  } catch {
    return null;
  }
}

function normalizeReceiptInput(input: WriteRetrievalReceiptInput): RetrievalReceipt {
  const startedAt = normalizeIso(input.startedAt, 'startedAt');
  const completedAt = normalizeIso(input.completedAt, 'completedAt');
  const query = typeof input.query === 'string' ? input.query : '';
  const metadata = normalizeMetadata(input.metadata);
  return {
    schemaVersion: 1,
    id: normalizeId(input.id),
    queryHash: crypto.createHash('sha256').update(query).digest('hex'),
    queryPreview: redactPreview(query),
    strategy: normalizeText(input.strategy, 120) || 'unknown',
    outcome: normalizeOutcome(input.outcome),
    startedAt,
    completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    budget: normalizeBudget(input.budget),
    scope: {
      preferredPaths: normalizeStringList(input.scope?.preferredPaths, MAX_PATHS, 500),
      excludePaths: normalizeStringList(input.scope?.excludePaths, MAX_PATHS, 500),
    },
    candidates: (Array.isArray(input.candidates) ? input.candidates : [])
      .map(normalizeCandidate)
      .filter((candidate): candidate is RetrievalReceiptCandidate => candidate !== null)
      .slice(0, MAX_CANDIDATES),
    selections: (Array.isArray(input.selections) ? input.selections : [])
      .map(normalizeSelection)
      .filter((selection): selection is RetrievalReceiptSelection => selection !== null)
      .slice(0, MAX_SELECTIONS),
    totals: {
      candidateCount: normalizeCount(input.totals?.candidateCount),
      selectedCount: normalizeCount(input.totals?.selectedCount),
      usedTokens: normalizeCount(input.totals?.usedTokens),
    },
    ...(input.error ? { error: redactPreview(String(input.error), MAX_ERROR_CHARS) } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function normalizeStoredReceipt(value: unknown): RetrievalReceipt | null {
  if (!isRecord(value)) return null;
  try {
    const normalized = normalizeReceiptInput({
      id: value.id as string,
      query: typeof value.queryPreview === 'string' ? value.queryPreview : '',
      strategy: value.strategy as string,
      outcome: value.outcome as RetrievalReceiptOutcome,
      startedAt: value.startedAt as string,
      completedAt: value.completedAt as string,
      budget: value.budget as RetrievalReceiptBudget,
      scope: value.scope as RetrievalReceipt['scope'],
      candidates: value.candidates as RetrievalReceiptCandidate[],
      selections: value.selections as RetrievalReceiptSelection[],
      totals: value.totals as RetrievalReceipt['totals'],
      ...(typeof value.error === 'string' ? { error: value.error } : {}),
      ...(isRecord(value.metadata) ? { metadata: value.metadata } : {}),
    });
    return {
      ...normalized,
      queryHash: typeof value.queryHash === 'string' && SHA256.test(value.queryHash)
        ? value.queryHash
        : normalized.queryHash,
      queryPreview: redactPreview(typeof value.queryPreview === 'string' ? value.queryPreview : ''),
      durationMs: normalizeCount(value.durationMs),
    };
  } catch {
    return null;
  }
}

function normalizeCandidate(value: unknown): RetrievalReceiptCandidate | null {
  if (!isRecord(value)) return null;
  const filePath = normalizeText(value.path, 1_000);
  if (!filePath) return null;
  return {
    ...(typeof value.assetId === 'string' && SAFE_ID.test(value.assetId) ? { assetId: value.assetId } : {}),
    path: filePath,
    score: normalizeScore(value.score),
    selected: value.selected === true,
    reason: normalizeText(value.reason, 240) || 'not selected',
  };
}

function normalizeSelection(value: unknown): RetrievalReceiptSelection | null {
  if (!isRecord(value)) return null;
  const assetId = typeof value.assetId === 'string' && SAFE_ID.test(value.assetId) ? value.assetId : '';
  const filePath = normalizeText(value.path, 1_000);
  if (!assetId || !filePath) return null;
  const startLine = normalizeOptionalPositiveInt(value.startLine);
  const endLine = normalizeOptionalPositiveInt(value.endLine);
  return {
    assetId,
    path: filePath,
    score: normalizeScore(value.score),
    ...(startLine ? { startLine } : {}),
    ...(endLine ? { endLine } : {}),
    ...(Array.isArray(value.headingPath) ? { headingPath: normalizeStringList(value.headingPath, 12, 160) } : {}),
    estimatedTokens: normalizeCount(value.estimatedTokens),
    truncated: value.truncated === true,
    reason: normalizeText(value.reason, 240) || 'selected',
  };
}

function normalizeMetadata(value: unknown): RetrievalReceipt['metadata'] | undefined {
  if (!isRecord(value)) return undefined;
  const metadata = {
    ...(typeof value.chatSessionId === 'string' ? { chatSessionId: normalizeText(value.chatSessionId, 160) } : {}),
    ...(typeof value.runId === 'string' ? { runId: normalizeText(value.runId, 160) } : {}),
    ...(typeof value.automationId === 'string' ? { automationId: normalizeText(value.automationId, 160) } : {}),
    ...(typeof value.trigger === 'string' ? { trigger: normalizeText(value.trigger, 80) } : {}),
  };
  return Object.values(metadata).some(Boolean) ? metadata : undefined;
}

function normalizeBudget(value: unknown): RetrievalReceiptBudget {
  const record = isRecord(value) ? value : {};
  return {
    maxTokens: normalizeCount(record.maxTokens),
    maxFiles: normalizeCount(record.maxFiles),
    minScore: normalizeScore(record.minScore),
    timeoutMs: normalizeCount(record.timeoutMs),
  };
}

function normalizeOutcome(value: unknown): RetrievalReceiptOutcome {
  if (value === 'selected' || value === 'empty' || value === 'timeout' || value === 'error' || value === 'skipped') return value;
  throw new Error('Unsupported retrieval receipt outcome.');
}

function normalizeId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!SAFE_ID.test(id)) throw new Error('Retrieval receipt id is invalid.');
  return id;
}

function normalizeIso(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`Retrieval receipt ${label} is invalid.`);
  return new Date(value).toISOString();
}

function redactPreview(value: string, max = 220): string {
  return redactSensitiveText(value)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function normalizeStringList(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalizeText(item, maxChars)).filter(Boolean))].slice(0, maxItems);
}

function normalizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeScore(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeOptionalPositiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isAlreadyExists(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'EEXIST';
}
