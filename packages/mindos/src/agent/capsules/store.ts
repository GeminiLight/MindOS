import crypto from 'node:crypto';
// Namespace import (not named bindings) so the fs calls stay observable to
// tests that spy on `fs.readFileSync` to prove the capsule cache skips reads.
import fs from 'node:fs';
import path from 'node:path';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import type { MindosDatabase } from '../../foundation/storage/sqlite.js';
import { redactSensitiveText } from '../redaction.js';
import {
  deleteCapsuleRow,
  forgetDir,
  getCapsuleRow,
  listCapsuleRows,
  listCapsuleRowsUnder,
  listIndexedDirs,
  openCapsuleIndex,
  readDirMtime,
  upsertCapsuleRow,
  writeDirMtime,
  type CapsuleIndexRow,
} from './capsule-index.js';
import type {
  AgentRunCapsule,
  AgentRunCapsuleProjection,
  AgentRunCapsuleRecoveryClaim,
  AgentRunCapsuleRecoveryPlan,
  CreateAgentRunCapsuleInput,
  CreateAgentRunCapsuleRecoveryPlanInput,
} from './types.js';
import {
  cancelQueuedCapsuleWrite,
  clearCapsuleWriteCancel,
  clearPendingCapsule,
  enqueueCapsuleWrite,
  getPendingCapsule,
  isCapsuleWriteCancelled,
  pendingCapsuleEntries,
  setCapsuleWriteSyncFallback,
  setPendingCapsule,
} from './write-queue.js';

export { CAPSULES_DB_RELATIVE_PATH } from './capsule-index.js';
export {
  flushAllCapsuleWrites,
  flushCapsuleWrites,
  writePendingCapsuleWritesSync,
} from './write-queue.js';

const CAPSULES_DIR = '.mindos/agent-run-capsules';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const MAX_CAPSULES = 500;
const MAX_INPUT_SUMMARY = 500;
const MAX_IDEMPOTENCY_KEY = 200;
const MAX_CAPSULE_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_TEXT = 64 * 1024;

type CapsuleFileCacheEntry = {
  /** `resolveExistingSafe()` result for this file; re-validated whenever its stat changes. */
  safePath: string;
  mtimeMs: number;
  size: number;
  /** Parsed capsule, or null when the file failed validation (see `corruptMessage`). */
  capsule: AgentRunCapsule | null;
  corruptMessage?: string;
};

type CapsuleStoreCache = {
  files: Map<string, CapsuleFileCacheEntry>;
};

/**
 * Per-mind-root parsed-file cache. `GET /api/agent-runs` polls roughly every
 * 900ms; files are revalidated by mtime + size so unchanged capsules are never
 * re-read or re-parsed. Cached capsules are handed out by reference; callers
 * must treat them as immutable.
 *
 * Where each capsule lives is remembered in the sqlite index
 * (`capsule-index.ts`): month directories are re-listed only when their mtime
 * changed, and lookups by id go straight to the indexed path.
 */
const capsuleCaches = new Map<string, CapsuleStoreCache>();
const MAX_CACHED_ROOTS = 16;

// ── Async write queue (implementation in ./write-queue.ts) ─────────────────
//
// Capsule persistence used to run structuredClone + JSON.stringify +
// writeFileSync + link synchronously inside `createAgentRunCapsule`, before the
// lane could emit the first SSE byte (10-25ms for a ~6MB chat). The public
// store functions stay synchronous — lane callers do not await them — but the
// disk work is queued on a per-capsule promise chain, and an in-memory overlay
// serves same-process reads while a write is pending. See write-queue.ts for
// the queue/overlay/flush/exit-fallback machinery.

setCapsuleWriteSyncFallback((pending) => {
  fs.mkdirSync(path.dirname(pending.file), { recursive: true, mode: 0o700 });
  writeJsonAtomic(pending.file, pending.capsule);
});

function rootKeyOf(mindRoot: string): string {
  return path.resolve(mindRoot);
}

/** Cache/index reconciliation after a write landed; keeps the newest state. */
function settlePendingCapsule(
  id: string,
  capsule: AgentRunCapsule,
  mindRoot: string,
  file: string,
): void {
  const current = getPendingCapsule(id);
  if (current && current.capsule !== capsule) return; // a newer finalize owns reconciliation
  rememberCapsuleFile(mindRoot, file, capsule);
  clearPendingCapsule(id, capsule);
}

export function createAgentRunCapsule(
  mindRoot: string,
  input: CreateAgentRunCapsuleInput,
): AgentRunCapsule {
  const id = requireSafeId(input.id, 'capsule id');
  requireSafeId(input.runId, 'run id');
  requireSafeId(input.rootRunId, 'root run id');
  if (input.chatSessionId !== undefined) requireSafeId(input.chatSessionId, 'chat session id');
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Capsule timestamp must be a valid date.');

  const capsule: AgentRunCapsule = {
    schemaVersion: 1,
    id,
    runId: input.runId,
    rootRunId: input.rootRunId,
    ...(input.chatSessionId ? { chatSessionId: input.chatSessionId } : {}),
    source: input.source,
    status: input.status ?? 'running',
    // No structuredClone here: the turn lane builds this request with its own
    // fresh clone (web `_lib/turn-runner.ts` capsuleSeed), so cloning again was
    // a pure double copy on the pre-first-byte critical path. Ownership of the
    // request transfers to the store; callers must not mutate it afterwards.
    request: input.request,
    provenance: structuredClone(input.provenance ?? {}),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  assertCapsuleShape(capsule);

  const file = capsuleFile(mindRoot, capsule);
  const pending = getPendingCapsule(id);
  if ((pending && pending.mindRootKey === rootKeyOf(mindRoot)) || fs.existsSync(file)) {
    throw new Error(`Agent run capsule already exists: ${id}`);
  }
  // Synchronous, tiny, exclusive STUB write. Keeps the two failure contracts
  // callers rely on before the lane starts — an unwritable mind root throws
  // (mkdir) and a duplicate id throws (exclusive link), across processes — at
  // microsecond cost independent of chat size. The stub is a schema-valid
  // capsule with an empty transcript; the full payload replaces it from the
  // write queue. The in-memory overlay serves the full state until it lands.
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (!writeJsonExclusive(file, capsuleStub(capsule))) {
    throw new Error(`Agent run capsule already exists: ${id}`);
  }
  clearCapsuleWriteCancel(id);
  setPendingCapsule(id, { mindRootKey: rootKeyOf(mindRoot), file, capsule, landed: false });
  enqueueCapsuleWrite(id, async () => {
    const current = getPendingCapsule(id);
    if (!current || current.file !== file) return;
    if (current.landed) {
      settlePendingCapsule(id, capsule, mindRoot, file);
      return;
    }
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      if (isCapsuleWriteCancelled(id)) throw new Error('cancelled');
      // Serialize first so an oversized payload fails before touching disk.
      const serialized = serializeJson(capsule);
      await fs.promises.writeFile(temp, serialized, { encoding: 'utf-8', mode: 0o600 });
      if (isCapsuleWriteCancelled(id)) throw new Error('cancelled');
      await fs.promises.rename(temp, file);
    } catch (error) {
      await fs.promises.unlink(temp).catch(() => { /* best-effort cleanup */ });
      // Never leave a stub behind pretending to be a durable capsule when the
      // full write failed (oversized payload, disk error, cancellation).
      removeCapsuleFileQuietly(file);
      if (String((error as Error)?.message) === 'cancelled') return;
      throw error;
    }
    settlePendingCapsule(id, capsule, mindRoot, file);
  });
  return capsule;
}

/** Schema-valid capsule skeleton written synchronously at capture time. */
function capsuleStub(capsule: AgentRunCapsule): AgentRunCapsule {
  return {
    ...capsule,
    request: {
      ...capsule.request,
      messages: [],
      context: { ...capsule.request.context, uploadedFiles: [] },
    },
  };
}

function removeCapsuleFileQuietly(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // Best effort: a leftover stub is revalidated by stat on the next read.
  }
}

export function getAgentRunCapsule(mindRoot: string, id: string): AgentRunCapsule | null {
  requireSafeId(id, 'capsule id');
  const pending = getPendingCapsule(id);
  if (pending && pending.mindRootKey === rootKeyOf(mindRoot)) return pending.capsule;
  const entry = locateCapsuleEntry(mindRoot, id);
  return entry ? requireCachedCapsule(entry) : null;
}

export function listAgentRunCapsules(
  mindRoot: string,
  options: { onCorrupt?(message: string): void } = {},
): AgentRunCapsule[] {
  const rootKey = rootKeyOf(mindRoot);
  const byId = new Map<string, AgentRunCapsule>();
  const db = syncCapsuleIndex(mindRoot);
  if (db) {
    for (const row of listCapsuleRows(db)) {
      const entry = readIndexedEntry(mindRoot, db, row);
      if (!entry) continue;
      if (entry.capsule) {
        byId.set(entry.capsule.id, entry.capsule);
      } else {
        options.onCorrupt?.(entry.corruptMessage ?? 'Unreadable capsule.');
      }
    }
  }
  // Overlay pending writes not yet on disk (newest state wins), so a same-process
  // list right after create/finalize still reflects the run.
  for (const [id, pending] of pendingCapsuleEntries()) {
    if (pending.mindRootKey !== rootKey) continue;
    byId.set(id, pending.capsule);
  }
  return [...byId.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_CAPSULES);
}

export function finalizeAgentRunCapsule(
  mindRoot: string,
  id: string,
  input: {
    status: AgentRunCapsule['status'];
    runtimeBinding?: AgentRunCapsule['request']['runtimeBinding'];
    checkpointArtifactId?: string;
    outputText?: string;
    now?: Date;
  },
): AgentRunCapsule {
  requireSafeId(id, 'capsule id');
  const rootKey = rootKeyOf(mindRoot);
  // Disk anchors existence: a capsule deleted behind the store's back must
  // still fail finalize (the lane degrades to CAPSULE_FINALIZE_FAILED). The
  // overlay supplies the freshest state while the full write is queued.
  const entry = locateCapsuleEntry(mindRoot, id);
  const pending = getPendingCapsule(id);
  const pendingHere = pending && pending.mindRootKey === rootKey ? pending : undefined;
  if (!entry) {
    if (pendingHere) {
      // The queued write is no longer grounded on disk; cancel it so an
      // in-flight job cannot resurrect the deleted capsule after this failure.
      cancelQueuedCapsuleWrite(id);
    }
    throw new Error(`Agent run capsule not found: ${id}`);
  }
  const current = pendingHere ? pendingHere.capsule : requireCachedCapsule(entry);
  const file = pendingHere ? pendingHere.file : entry.safePath;
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Capsule timestamp must be a valid date.');
  const next: AgentRunCapsule = {
    ...current,
    status: input.status,
    request: input.runtimeBinding !== undefined
      ? { ...current.request, runtimeBinding: structuredClone(input.runtimeBinding) }
      : current.request,
    provenance: input.checkpointArtifactId
      ? { ...current.provenance, checkpointArtifactId: requireSafeId(input.checkpointArtifactId, 'checkpoint artifact id') }
      : current.provenance,
    ...(input.outputText !== undefined
      ? { result: { ...current.result, outputText: input.outputText.slice(0, MAX_OUTPUT_TEXT) } }
      : current.result ? { result: current.result } : {}),
    updatedAt: now.toISOString(),
  };
  // Update the overlay synchronously so same-process reads see the finalized
  // state, then queue the atomic rewrite behind any pending create on the chain.
  setPendingCapsule(id, { mindRootKey: rootKey, file, capsule: next, landed: false });
  enqueueCapsuleWrite(id, async () => {
    const queued = getPendingCapsule(id);
    if (!queued || queued.file !== file) return;
    if (!queued.landed) {
      const serialized = serializeJson(next);
      await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await writeJsonAtomicAsync(file, serialized);
    }
    settlePendingCapsule(id, next, mindRoot, file);
  });
  return next;
}

export function createAgentRunCapsuleRecoveryPlan(
  mindRoot: string,
  id: string,
  input: CreateAgentRunCapsuleRecoveryPlanInput,
): AgentRunCapsuleRecoveryPlan {
  const capsule = getAgentRunCapsule(mindRoot, id);
  if (!capsule) throw new Error(`Agent run capsule not found: ${id}`);
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY) {
    throw new Error(`Recovery idempotency key must contain 1-${MAX_IDEMPOTENCY_KEY} characters.`);
  }
  const planId = recoveryPlanId(idempotencyKey);
  const planFile = recoveryPlanFile(mindRoot, planId);
  if (fs.existsSync(planFile)) {
    const existing = readRecoveryPlan(planFile);
    if (existing.sourceCapsuleId !== capsule.id || existing.action !== input.action) {
      throw new Error('Recovery idempotency key was already used for a different action.');
    }
    return existing;
  }

  const projection = projectAgentRunCapsule(capsule);
  const readiness = projection.recovery[input.action];
  if (!readiness.supported) {
    throw new Error(readiness.reason ?? `Recovery action is not supported: ${input.action}`);
  }
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Recovery timestamp must be a valid date.');
  const request = structuredClone(capsule.request);
  if (input.action === 'retry' || input.action === 'fork') request.runtimeBinding = null;
  const plan: AgentRunCapsuleRecoveryPlan = {
    schemaVersion: 1,
    id: planId,
    sourceCapsuleId: capsule.id,
    action: input.action,
    request,
    ...(input.action !== 'fork' && capsule.chatSessionId
      ? { targetChatSessionId: capsule.chatSessionId }
      : {}),
    ...(input.action === 'rollback' && capsule.provenance.checkpointArtifactId
      ? { checkpointArtifactId: capsule.provenance.checkpointArtifactId }
      : {}),
    createdAt: now.toISOString(),
  };
  fs.mkdirSync(path.dirname(planFile), { recursive: true, mode: 0o700 });
  if (writeJsonExclusive(planFile, plan)) return plan;
  const winner = readRecoveryPlan(planFile);
  if (winner.sourceCapsuleId !== capsule.id || winner.action !== input.action) {
    throw new Error('Recovery idempotency key was already used for a different action.');
  }
  return winner;
}

export function getAgentRunCapsuleRecoveryPlan(
  mindRoot: string,
  planId: string,
): AgentRunCapsuleRecoveryPlan | null {
  requireSafeId(planId, 'recovery plan id');
  const file = recoveryPlanFile(mindRoot, planId);
  return fs.existsSync(file) ? readRecoveryPlan(file) : null;
}

export function claimAgentRunCapsuleRecoveryPlan(
  mindRoot: string,
  planId: string,
  runId: string,
  now = new Date(),
): AgentRunCapsuleRecoveryClaim {
  const plan = getAgentRunCapsuleRecoveryPlan(mindRoot, planId);
  if (!plan) throw new Error(`Agent run recovery plan not found: ${planId}`);
  requireSafeId(runId, 'recovery run id');
  if (Number.isNaN(now.getTime())) throw new Error('Recovery claim timestamp must be a valid date.');
  const claim: AgentRunCapsuleRecoveryClaim = {
    schemaVersion: 1,
    planId: plan.id,
    runId,
    claimedAt: now.toISOString(),
  };
  const file = recoveryClaimFile(mindRoot, plan.id);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (writeJsonExclusive(file, claim)) return claim;
  const existing = readRecoveryClaim(file);
  throw new Error(`Recovery plan was already claimed by run ${existing.runId}.`);
}

export function projectAgentRunCapsule(capsule: AgentRunCapsule): AgentRunCapsuleProjection {
  const active = ['queued', 'running', 'streaming'].includes(capsule.status);
  const activeReason = 'The source run is still active; stop it before starting recovery.';
  const binding = capsule.request.runtimeBinding;
  const resumeSessionId = capsule.request.runtimeBinding?.externalSessionId?.trim();
  const expectedBinding = { mindos: 'mindos-pi-session', codex: 'codex-thread', claude: 'claude-session', acp: 'acp-session' };
  const canResume = capsule.request.runtime.kind !== 'acp'
    && binding?.runtime === capsule.request.runtime.kind
    && binding.runtimeId === capsule.request.runtime.id
    && binding.type === expectedBinding[capsule.request.runtime.kind]
    && (!binding.status || binding.status === 'active');
  const checkpointArtifactId = capsule.provenance.checkpointArtifactId?.trim();
  return {
    schemaVersion: 1,
    id: capsule.id,
    runId: capsule.runId,
    rootRunId: capsule.rootRunId,
    ...(capsule.chatSessionId ? { chatSessionId: capsule.chatSessionId } : {}),
    source: capsule.source,
    status: capsule.status,
    inputSummary: redactForProjection(firstUserMessage(capsule)).slice(0, MAX_INPUT_SUMMARY),
    runtime: { ...capsule.request.runtime },
    ...(capsule.request.model ? { model: capsule.request.model } : {}),
    ...(capsule.request.thinkingEffort ? { thinkingEffort: capsule.request.thinkingEffort } : {}),
    context: {
      ...(capsule.request.context.currentFile
        ? { currentFile: capsule.request.context.currentFile }
        : {}),
      attachedFileCount: capsule.request.context.attachedFiles.length,
      uploadedFileCount: capsule.request.context.uploadedFiles.length,
      receiptIds: [...capsule.request.context.receiptIds],
      assetIds: [...capsule.request.context.assetIds],
    },
    recovery: {
      retry: { supported: !active, mode: 'from-start', ...(active ? { reason: activeReason } : {}) },
      fork: { supported: !active, mode: 'new-session', ...(active ? { reason: activeReason } : {}) },
      resume: active ? { supported: false, reason: activeReason } : resumeSessionId && canResume
        ? { supported: true, sessionId: resumeSessionId }
        : { supported: false, reason: 'This run has no reusable runtime session.' },
      rollback: checkpointArtifactId
        ? {
            supported: false,
            checkpointArtifactId,
            reason: 'A checkpoint was recorded, but no verified rollback executor is available.',
          }
        : { supported: false, reason: 'This run has no checkpoint artifact.' },
    },
    createdAt: capsule.createdAt,
    updatedAt: capsule.updatedAt,
  };
}

// --- paths ---

function capsuleRelativePath(capsule: Pick<AgentRunCapsule, 'id' | 'createdAt'>): string {
  const createdAt = new Date(capsule.createdAt);
  return path.posix.join(
    CAPSULES_DIR,
    String(createdAt.getUTCFullYear()),
    String(createdAt.getUTCMonth() + 1).padStart(2, '0'),
    `${capsule.id}.json`,
  );
}

function capsuleFile(mindRoot: string, capsule: AgentRunCapsule): string {
  return resolveExistingSafe(mindRoot, capsuleRelativePath(capsule));
}

function recoveryPlanId(idempotencyKey: string): string {
  const digest = crypto.createHash('sha256').update(idempotencyKey).digest('hex');
  return `recovery-${digest.slice(0, 48)}`;
}

function recoveryPlanFile(mindRoot: string, planId: string): string {
  return resolveExistingSafe(
    mindRoot,
    path.posix.join(CAPSULES_DIR, 'recoveries', `${planId}.json`),
  );
}

function recoveryClaimFile(mindRoot: string, planId: string): string {
  return resolveExistingSafe(
    mindRoot,
    path.posix.join(CAPSULES_DIR, 'claims', `${planId}.json`),
  );
}

function capsulesRoot(mindRoot: string): string {
  return resolveExistingSafe(mindRoot, CAPSULES_DIR);
}

/** Relative posix path of `absolute` inside `mindRoot`, as stored in the index. */
function relativeTo(mindRoot: string, absolute: string): string {
  return path.relative(mindRoot, absolute).split(path.sep).join('/');
}

function absoluteFrom(mindRoot: string, relative: string): string {
  return path.join(mindRoot, ...relative.split('/'));
}

// --- parsed-file cache ---

function cacheFor(mindRoot: string): CapsuleStoreCache {
  const key = path.resolve(mindRoot);
  let cache = capsuleCaches.get(key);
  if (!cache) {
    cache = { files: new Map() };
    capsuleCaches.set(key, cache);
    while (capsuleCaches.size > MAX_CACHED_ROOTS) {
      const oldest = capsuleCaches.keys().next().value;
      if (oldest === undefined) break;
      capsuleCaches.delete(oldest);
    }
  }
  return cache;
}

/**
 * Stat-validated read of one capsule file. Returns null when the file is gone.
 * The symlink / root-containment check runs again whenever the file changed,
 * and a corrupt file is cached as corrupt so the poller does not re-parse it.
 */
function readCapsuleEntry(mindRoot: string, candidate: string): CapsuleFileCacheEntry | null {
  const cache = cacheFor(mindRoot);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(candidate);
  } catch {
    cache.files.delete(candidate);
    return null;
  }
  const cached = cache.files.get(candidate);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached;

  const safePath = resolveExistingSafe(mindRoot, relativeTo(mindRoot, candidate));
  const entry: CapsuleFileCacheEntry = { safePath, mtimeMs: stat.mtimeMs, size: stat.size, capsule: null };
  try {
    entry.capsule = readCapsule(safePath);
  } catch (error) {
    entry.corruptMessage = error instanceof Error ? error.message : 'Unreadable capsule.';
  }
  cache.files.set(candidate, entry);
  return entry;
}

/** Seed the cache and the index from a write this process just performed, so the next poll does not re-read it. */
function rememberCapsuleFile(mindRoot: string, file: string, capsule: AgentRunCapsule): void {
  const cache = cacheFor(mindRoot);
  let entry: CapsuleFileCacheEntry;
  try {
    const stat = fs.statSync(file);
    entry = { safePath: file, mtimeMs: stat.mtimeMs, size: stat.size, capsule };
    cache.files.set(file, entry);
  } catch {
    cache.files.delete(file);
    return;
  }
  try {
    const db = openCapsuleIndex(mindRoot, { create: true });
    if (db) upsertCapsuleRow(db, indexRowFor(mindRoot, file, entry));
  } catch {
    // The file is the source of truth; a missing index row is rebuilt on the next scan.
  }
}

function requireCachedCapsule(entry: CapsuleFileCacheEntry): AgentRunCapsule {
  if (entry.capsule) return entry.capsule;
  throw new Error(
    entry.corruptMessage
      ?? `Agent run capsule is corrupt; the original file was preserved: ${path.basename(entry.safePath)}`,
  );
}

// --- sqlite index maintenance ---

function indexRowFor(mindRoot: string, file: string, entry: CapsuleFileCacheEntry): CapsuleIndexRow {
  const capsule = entry.capsule;
  return {
    id: path.basename(file, '.json'),
    run_id: capsule?.runId ?? null,
    root_run_id: capsule?.rootRunId ?? null,
    chat_session_id: capsule?.chatSessionId ?? null,
    status: capsule?.status ?? null,
    created_at: capsule?.createdAt ?? null,
    updated_at: capsule?.updatedAt ?? null,
    path: relativeTo(mindRoot, file),
    size: entry.size,
    mtime_ms: entry.mtimeMs,
    corrupt_message: entry.corruptMessage ?? null,
  };
}

/** A row is only trusted when its path is a capsule file for its own id inside the capsules tree. */
function isPlausibleRow(row: CapsuleIndexRow): boolean {
  return SAFE_ID.test(row.id)
    && row.path.startsWith(`${CAPSULES_DIR}/`)
    && !row.path.includes('..')
    && path.posix.basename(row.path) === `${row.id}.json`;
}

/**
 * Reads the capsule an index row points at, refreshing the row when the file
 * changed underneath it and dropping the row when the file is gone.
 */
function readIndexedEntry(mindRoot: string, db: MindosDatabase, row: CapsuleIndexRow): CapsuleFileCacheEntry | null {
  if (!isPlausibleRow(row)) {
    deleteCapsuleRow(db, row.id);
    return null;
  }
  const candidate = absoluteFrom(mindRoot, row.path);
  let entry: CapsuleFileCacheEntry | null;
  try {
    entry = readCapsuleEntry(mindRoot, candidate);
  } catch {
    entry = null;
  }
  if (!entry) {
    deleteCapsuleRow(db, row.id);
    return null;
  }
  if (entry.mtimeMs !== Number(row.mtime_ms) || entry.size !== Number(row.size)) {
    upsertCapsuleRow(db, indexRowFor(mindRoot, candidate, entry));
  }
  return entry;
}

function safeDirectories(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{2,4}$/.test(entry.name))
    .map((entry) => path.join(directory, entry.name));
}

/**
 * Re-lists one month directory and reconciles its rows: new or changed files
 * are (re)indexed, rows for vanished files are dropped.
 */
function reindexMonth(mindRoot: string, db: MindosDatabase, month: string, mtimeMs: number): void {
  const relativeDir = relativeTo(mindRoot, month);
  const present = new Set<string>();
  for (const dirent of fs.readdirSync(month, { withFileTypes: true })) {
    if (!dirent.isFile() || !dirent.name.endsWith('.json')) continue;
    const id = path.basename(dirent.name, '.json');
    if (!SAFE_ID.test(id)) continue;
    const candidate = path.join(month, dirent.name);
    present.add(id);
    let entry: CapsuleFileCacheEntry | null;
    try {
      entry = readCapsuleEntry(mindRoot, candidate);
    } catch {
      continue;
    }
    if (entry) upsertCapsuleRow(db, indexRowFor(mindRoot, candidate, entry));
  }
  for (const row of listCapsuleRowsUnder(db, relativeDir)) {
    if (!present.has(row.id)) deleteCapsuleRow(db, row.id);
  }
  writeDirMtime(db, relativeDir, mtimeMs);
}

/**
 * Brings the index in line with the directory tree. Year and month
 * directories are tiny and always re-listed; a month's files are re-listed
 * only when its directory mtime differs from the recorded one (creates,
 * atomic rewrites and deletes all touch it). Returns null when there are no
 * capsules at all, without creating a database.
 */
function syncCapsuleIndex(mindRoot: string): MindosDatabase | null {
  const root = capsulesRoot(mindRoot);
  if (!fs.existsSync(root)) {
    cacheFor(mindRoot).files.clear();
    const stale = openCapsuleIndex(mindRoot, { create: false });
    if (stale) for (const dir of listIndexedDirs(stale)) forgetDir(stale, dir);
    return stale;
  }
  const db = openCapsuleIndex(mindRoot, { create: true });
  if (!db) return null;
  const seen = new Set<string>();
  db.transaction(() => {
    for (const year of safeDirectories(root)) {
      for (const month of safeDirectories(year)) {
        const relativeDir = relativeTo(mindRoot, month);
        seen.add(relativeDir);
        let mtimeMs: number;
        try {
          mtimeMs = fs.statSync(month).mtimeMs;
        } catch {
          continue;
        }
        if (readDirMtime(db, relativeDir) !== mtimeMs) reindexMonth(mindRoot, db, month, mtimeMs);
      }
    }
    for (const dir of listIndexedDirs(db)) {
      if (!seen.has(dir)) forgetDir(db, dir);
    }
  });
  return db;
}

/**
 * Find a capsule by id without scanning when possible: the indexed path
 * first, then the current and previous month directories (capsules are filed
 * by createdAt and finalized shortly after), and only then a full index sync
 * for capsules another process filed elsewhere.
 */
function locateCapsuleEntry(mindRoot: string, id: string): CapsuleFileCacheEntry | null {
  const indexed = openCapsuleIndex(mindRoot, { create: false });
  if (indexed) {
    const row = getCapsuleRow(indexed, id);
    if (row) {
      const entry = readIndexedEntry(mindRoot, indexed, row);
      if (entry) return entry;
    }
  }
  for (const candidate of recentMonthCandidates(mindRoot, id)) {
    if (!fs.existsSync(candidate)) continue;
    const entry = readCapsuleEntry(mindRoot, candidate);
    if (entry) {
      try {
        const db = openCapsuleIndex(mindRoot, { create: true });
        if (db) upsertCapsuleRow(db, indexRowFor(mindRoot, candidate, entry));
      } catch {
        // Index is best-effort; the file was found and validated.
      }
      return entry;
    }
  }
  const db = syncCapsuleIndex(mindRoot);
  if (!db) return null;
  const row = getCapsuleRow(db, id);
  return row ? readIndexedEntry(mindRoot, db, row) : null;
}

function recentMonthCandidates(mindRoot: string, id: string): string[] {
  const root = capsulesRoot(mindRoot);
  const now = new Date();
  return [0, -1].map((offset) => {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    return path.join(
      root,
      String(month.getUTCFullYear()),
      String(month.getUTCMonth() + 1).padStart(2, '0'),
      `${id}.json`,
    );
  });
}

// --- validation ---

function readCapsule(file: string): AgentRunCapsule {
  try {
    const value = readBoundedJson(file);
    assertCapsuleShape(value);
    return value;
  } catch {
    throw new Error(`Agent run capsule is corrupt; the original file was preserved: ${path.basename(file)}`);
  }
}

function assertCapsuleShape(value: unknown): asserts value is AgentRunCapsule {
  if (!isRecord(value)) throw new Error('invalid capsule shape');
  const request = value.request;
  const provenance = value.provenance;
  if (
    value.schemaVersion !== 1
    || !isSafeId(value.id)
    || !isSafeId(value.runId)
    || !isSafeId(value.rootRunId)
    || (value.chatSessionId !== undefined && !isSafeId(value.chatSessionId))
    || !['interactive', 'automation', 'event', 'recovery'].includes(String(value.source))
    || !['queued', 'running', 'streaming', 'completed', 'failed', 'canceled', 'timed_out'].includes(String(value.status))
    || !isIsoTimestamp(value.createdAt)
    || !isIsoTimestamp(value.updatedAt)
    || !isCapsuleRequest(request)
    || !isRecord(provenance)
    || !isOptionalString(provenance.cwd)
    || !isOptionalString(provenance.gitRevision)
    || !isOptionalString(provenance.checkpointArtifactId)
    || !isOptionalString(provenance.parentCapsuleId)
    || (provenance.recoveryAction !== undefined && !['retry', 'fork', 'resume', 'rollback'].includes(String(provenance.recoveryAction)))
    || (value.result !== undefined && (!isRecord(value.result) || !isOptionalString(value.result.outputText)))
  ) {
    throw new Error('invalid capsule shape');
  }
}

function isCapsuleRequest(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Array.isArray(value.messages)
    && value.messages.every(isRecord)
    && isRuntime(value.runtime)
    && isCapsuleContext(value.context)
    && (value.runtimeBinding === undefined || value.runtimeBinding === null || isRuntimeBinding(value.runtimeBinding))
    && (value.options === undefined || isRecord(value.options))
    && isOptionalString(value.agentMode)
    && isOptionalString(value.permissionMode)
    && isOptionalString(value.model)
    && isOptionalString(value.thinkingEffort);
}

function isRuntime(value: unknown): boolean {
  return isRecord(value)
    && ['mindos', 'acp', 'codex', 'claude'].includes(String(value.kind))
    && typeof value.id === 'string'
    && typeof value.name === 'string';
}

function isRuntimeBinding(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['mindos-pi-session', 'codex-thread', 'claude-session', 'acp-session'].includes(String(value.type))
    && ['mindos', 'acp', 'codex', 'claude'].includes(String(value.runtime))
    && typeof value.runtimeId === 'string'
    && isOptionalString(value.externalSessionId)
    && isOptionalString(value.cwd)
    && (value.status === undefined || ['active', 'missing', 'signed-out', 'archived', 'failed'].includes(String(value.status)))
    && (value.updatedAt === undefined || (typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)));
}

function isCapsuleContext(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isOptionalString(value.currentFile)
    && isStringArray(value.attachedFiles)
    && isStringArray(value.receiptIds)
    && isStringArray(value.assetIds)
    && Array.isArray(value.uploadedFiles)
    && value.uploadedFiles.every((file) => (
      isRecord(file)
      && typeof file.name === 'string'
      && typeof file.content === 'string'
      && isOptionalString(file.mimeType)
      && isOptionalString(file.dataBase64)
      && (file.size === undefined || (typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0))
    ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function readRecoveryPlan(file: string): AgentRunCapsuleRecoveryPlan {
  try {
    const value = readBoundedJson(file);
    if (
      !isRecord(value)
      || value.schemaVersion !== 1
      || !isSafeId(value.id)
      || !isSafeId(value.sourceCapsuleId)
      || !['retry', 'fork', 'resume', 'rollback'].includes(String(value.action))
      || !isCapsuleRequest(value.request)
      || (value.targetChatSessionId !== undefined && !isSafeId(value.targetChatSessionId))
      || (value.checkpointArtifactId !== undefined && !isSafeId(value.checkpointArtifactId))
      || !isIsoTimestamp(value.createdAt)
    ) {
      throw new Error('invalid recovery plan shape');
    }
    return value as unknown as AgentRunCapsuleRecoveryPlan;
  } catch {
    throw new Error(`Agent run recovery plan is corrupt; the original file was preserved: ${path.basename(file)}`);
  }
}

function readRecoveryClaim(file: string): AgentRunCapsuleRecoveryClaim {
  try {
    const value = readBoundedJson(file);
    if (
      !isRecord(value)
      || value.schemaVersion !== 1
      || !isSafeId(value.planId)
      || !isSafeId(value.runId)
      || !isIsoTimestamp(value.claimedAt)
    ) {
      throw new Error('invalid recovery claim shape');
    }
    return value as unknown as AgentRunCapsuleRecoveryClaim;
  } catch {
    throw new Error(`Agent run recovery claim is corrupt; the original file was preserved: ${path.basename(file)}`);
  }
}

// --- bounded JSON I/O ---

function readBoundedJson(file: string): unknown {
  if (fs.statSync(file).size > MAX_CAPSULE_BYTES) {
    throw new Error(`stored payload exceeds ${MAX_CAPSULE_BYTES} bytes`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
}

function writeJsonAtomic(file: string, value: AgentRunCapsule | AgentRunCapsuleRecoveryPlan): void {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, serializeJson(value), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* best-effort cleanup */ }
    throw error;
  }
}

function writeJsonExclusive(
  file: string,
  value: AgentRunCapsule | AgentRunCapsuleRecoveryPlan | AgentRunCapsuleRecoveryClaim,
): boolean {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, serializeJson(value), { encoding: 'utf-8', mode: 0o600 });
    try {
      fs.linkSync(temp, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
    return true;
  } finally {
    try { fs.unlinkSync(temp); } catch { /* best-effort cleanup */ }
  }
}

// ── async variants used by the queued capsule writes ──

async function writeJsonAtomicAsync(file: string, serialized: string): Promise<void> {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(temp, serialized, { encoding: 'utf-8', mode: 0o600 });
    await fs.promises.rename(temp, file);
  } catch (error) {
    await fs.promises.unlink(temp).catch(() => { /* best-effort cleanup */ });
    throw error;
  }
}

function serializeJson(
  value: AgentRunCapsule | AgentRunCapsuleRecoveryPlan | AgentRunCapsuleRecoveryClaim,
): string {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf-8') > MAX_CAPSULE_BYTES) {
    throw new Error(`Agent run capsule payload is too large; the limit is ${MAX_CAPSULE_BYTES} bytes.`);
  }
  return serialized;
}

function requireSafeId(value: string, label: string): string {
  if (!SAFE_ID.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function firstUserMessage(capsule: AgentRunCapsule): string {
  for (const message of capsule.request.messages) {
    if (message.role !== 'user') continue;
    if (typeof message.content === 'string') return message.content.trim();
  }
  return '';
}

function redactForProjection(value: string): string {
  return redactSensitiveText(value)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replaceAll('[redacted]', '[REDACTED]');
}
