import crypto from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { getAgentRunCapsule } from '../../agent/capsules/store.js';
import { redactSensitiveText } from '../../agent/redaction.js';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { getRetrievalReceipt } from '../../retrieval/receipt.js';
import type { EchoPromotionCandidate } from '../context-assets/echo-promotion.js';
import { readContextAssetRegistry, updateContextAssetStatus } from '../context-assets/registry.js';
import { calculateContextFeedbackProfile } from './scoring.js';
import type {
  CapsuleEchoPromotionInput,
  ContextFeedback,
  ContextFeedbackLedger,
  ContextFeedbackProfile,
  ContextFeedbackRevision,
  ContextFeedbackSignal,
  ContextFeedbackStatus,
  ContextStaleReview,
  ListContextFeedbackOptions,
  ReviewStaleContextAssetInput,
  SubmitContextFeedbackInput,
} from './types.js';

export const CONTEXT_FEEDBACK_LEDGER_FILE = '.mindos/context-feedback/ledger.json';

const FEEDBACK_DIR = '.mindos/context-feedback';
const LOCK_DIR = `${FEEDBACK_DIR}/ledger.lock`;
const MAX_FEEDBACK = 10_000;
const MAX_REVISION_HISTORY = 20;
const MAX_STALE_REVIEWS = 1_000;
const LOCK_ATTEMPTS = 50;
const LOCK_WAIT_MS = 10;
const STALE_LOCK_MS = 30_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export function readContextFeedbackLedger(mindRoot: string): ContextFeedbackLedger {
  try {
    const file = resolveExistingSafe(mindRoot, CONTEXT_FEEDBACK_LEDGER_FILE);
    if (!existsSync(file)) return emptyLedger();
    return normalizeLedger(JSON.parse(readFileSync(file, 'utf-8')));
  } catch {
    return emptyLedger();
  }
}

export function submitContextFeedback(
  mindRoot: string,
  input: SubmitContextFeedbackInput,
  now = new Date(),
): ContextFeedback {
  // Validate this store's destination before reading linked observability data,
  // so a symlinked metadata root is rejected even when the receipt is absent.
  resolveExistingSafe(mindRoot, CONTEXT_FEEDBACK_LEDGER_FILE);
  const receiptId = requireSafeId(input.receiptId, 'receipt id');
  const signal = normalizeSignal(input.signal);
  const receipt = getRetrievalReceipt(mindRoot, receiptId);
  if (!receipt) throw new Error(`Retrieval receipt not found: ${receiptId}`);
  const assetId = input.assetId ? requireSafeId(input.assetId, 'asset id') : undefined;
  const asset = assetId
    ? readContextAssetRegistry(mindRoot).assets.find((item) => item.id === assetId)
    : undefined;
  if (signal === 'missing' && assetId) throw new Error('Missing-context feedback must not identify an existing asset.');
  if (signal !== 'missing' && !assetId) throw new Error(`${signal} feedback requires an asset id.`);
  if (assetId && !asset) throw new Error(`Context asset not found: ${assetId}`);
  if (assetId && !receiptSelectedAsset(receipt, assetId)) {
    throw new Error(`Retrieval receipt did not select context asset: ${assetId}`);
  }
  const timestamp = validNow(now);
  const note = boundedSensitiveText(input.note, 1_000);
  const expectedPath = signal === 'missing' ? boundedText(input.expectedPath, 500) : undefined;
  const id = `feedback-${sha256(`${receiptId}\0${assetId ?? 'missing'}`).slice(0, 24)}`;

  return withLedgerLock(mindRoot, () => {
    const ledger = readLedgerForMutation(mindRoot);
    const index = ledger.feedback.findIndex((item) => item.id === id);
    const current = index >= 0 ? ledger.feedback[index] : undefined;
    if (current && sameFeedback(current, { signal, note, expectedPath, status: 'active' })) return current;

    let next: ContextFeedback;
    if (current) {
      const base = { ...current };
      delete base.note;
      delete base.expectedPath;
      next = {
        ...base,
        signal,
        status: 'active',
        revision: current.revision + 1,
        updatedAt: timestamp,
        ...(note ? { note } : {}),
        ...(expectedPath ? { expectedPath } : {}),
        history: [...current.history, revisionOf(current)].slice(-MAX_REVISION_HISTORY),
      };
    } else {
      next = {
          id,
          receiptId,
          ...(typeof receipt.metadata?.runId === 'string' ? { runId: receipt.metadata.runId } : {}),
          ...(asset ? { assetId: asset.id, assetVersion: asset.version } : {}),
          signal,
          status: 'active',
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          ...(note ? { note } : {}),
          ...(expectedPath ? { expectedPath } : {}),
          history: [],
      };
    }
    if (index >= 0) ledger.feedback[index] = next;
    else ledger.feedback.unshift(next);
    ledger.feedback = ledger.feedback.slice(0, MAX_FEEDBACK);
    ledger.updatedAt = timestamp;
    writeLedger(mindRoot, ledger);
    return next;
  });
}

export function retractContextFeedback(mindRoot: string, feedbackId: string, now = new Date()): ContextFeedback {
  const id = requireSafeId(feedbackId, 'feedback id');
  const timestamp = validNow(now);
  return withLedgerLock(mindRoot, () => {
    const ledger = readLedgerForMutation(mindRoot);
    const index = ledger.feedback.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Context feedback not found: ${id}`);
    const current = ledger.feedback[index]!;
    if (current.status === 'retracted') return current;
    const next: ContextFeedback = {
      ...current,
      status: 'retracted',
      revision: current.revision + 1,
      updatedAt: timestamp,
      history: [...current.history, revisionOf(current)].slice(-MAX_REVISION_HISTORY),
    };
    ledger.feedback[index] = next;
    ledger.updatedAt = timestamp;
    writeLedger(mindRoot, ledger);
    return next;
  });
}

export function listContextFeedback(
  mindRoot: string,
  options: ListContextFeedbackOptions = {},
): ContextFeedback[] {
  const limit = finiteLimit(options.limit, 500);
  return readContextFeedbackLedger(mindRoot).feedback
    .filter((item) => !options.receiptId || item.receiptId === options.receiptId)
    .filter((item) => !options.assetId || item.assetId === options.assetId)
    .filter((item) => !options.runId || item.runId === options.runId)
    .filter((item) => !options.status || item.status === options.status)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export function getContextFeedbackProfile(mindRoot: string, assetId: string): ContextFeedbackProfile {
  const id = requireSafeId(assetId, 'asset id');
  const asset = readContextAssetRegistry(mindRoot).assets.find((item) => item.id === id);
  if (!asset) return calculateContextFeedbackProfile(id, 0, []);
  return calculateContextFeedbackProfile(id, asset.version, readContextFeedbackLedger(mindRoot).feedback);
}

export function listContextStaleReviews(
  mindRoot: string,
  options: { assetId?: string; status?: ContextStaleReview['status']; limit?: number } = {},
): ContextStaleReview[] {
  return readContextFeedbackLedger(mindRoot).staleReviews
    .filter((item) => !options.assetId || item.assetId === options.assetId)
    .filter((item) => !options.status || item.status === options.status)
    .sort((left, right) => right.reviewedAt.localeCompare(left.reviewedAt) || left.id.localeCompare(right.id))
    .slice(0, finiteLimit(options.limit, 200));
}

export function reviewStaleContextAsset(
  mindRoot: string,
  input: ReviewStaleContextAssetInput,
  now = new Date(),
): ContextStaleReview {
  const assetId = requireSafeId(input.assetId, 'asset id');
  const idempotencyKey = requireBoundedText(input.idempotencyKey, 200, 'idempotency key');
  const decision = input.decision === 'keep' || input.decision === 'deprecate' ? input.decision : null;
  if (!decision) throw new Error('Stale context review decision must be keep or deprecate.');
  const note = boundedSensitiveText(input.note, 1_000);
  const timestamp = validNow(now);
  const reviewId = `stale-review-${sha256(idempotencyKey).slice(0, 24)}`;

  return withLedgerLock(mindRoot, () => {
    const ledger = readLedgerForMutation(mindRoot);
    const existing = ledger.staleReviews.find((item) => item.id === reviewId);
    if (existing) {
      if (existing.assetId !== assetId || existing.decision !== decision || existing.note !== note) {
        throw new Error('Stale context review idempotency key was already used for another decision.');
      }
      if (existing.status === 'applied') return existing;
      return applyStaleReview(mindRoot, ledger, existing, timestamp);
    }
    const asset = readContextAssetRegistry(mindRoot).assets.find((item) => item.id === assetId);
    if (!asset) throw new Error(`Context asset not found: ${assetId}`);
    const hasStaleEvidence = ledger.feedback.some((item) => (
      item.status === 'active' && item.assetId === asset.id && item.assetVersion === asset.version && item.signal === 'stale'
    ));
    if (!hasStaleEvidence) throw new Error('Stale context review requires active stale feedback for the current asset version.');
    const review: ContextStaleReview = {
      id: reviewId,
      assetId,
      assetVersion: asset.version,
      decision,
      status: decision === 'keep' ? 'applied' : 'pending',
      reviewedAt: timestamp,
      ...(decision === 'keep' ? { appliedAt: timestamp } : {}),
      ...(note ? { note } : {}),
    };
    ledger.staleReviews.unshift(review);
    ledger.staleReviews = ledger.staleReviews.slice(0, MAX_STALE_REVIEWS);
    ledger.updatedAt = timestamp;
    writeLedger(mindRoot, ledger);
    return decision === 'deprecate' ? applyStaleReview(mindRoot, ledger, review, timestamp) : review;
  });
}

export function buildEchoPromotionCandidateFromCapsule(
  mindRoot: string,
  input: CapsuleEchoPromotionInput,
): EchoPromotionCandidate {
  const capsule = getAgentRunCapsule(mindRoot, requireSafeId(input.capsuleId, 'capsule id'));
  if (!capsule) throw new Error(`Agent run capsule not found: ${input.capsuleId}`);
  const evidence = Array.isArray(input.evidence) ? input.evidence.slice(0, 100) : [];
  if (evidence.length === 0) throw new Error('Capsule promotion requires message evidence.');
  const messageRefs = evidence.map((reference) => {
    const quote = requireBoundedText(reference.quote, 500, 'evidence quote');
    if (reference.source === 'output') {
      if (!capsule.result?.outputText?.includes(quote)) {
        throw new Error('Promotion evidence is not grounded in the capsule output.');
      }
      return { messageIndex: capsule.request.messages.length, role: 'assistant', quote };
    }
    const messageIndex = Number.isInteger(reference.messageIndex) ? reference.messageIndex : -1;
    const message = capsule.request.messages[messageIndex];
    const role = requireBoundedText(reference.role, 40, 'evidence role');
    if (!message || message.role !== role || !messageText(message).includes(quote)) {
      throw new Error(`Promotion evidence is not grounded in capsule message ${messageIndex}.`);
    }
    return { messageIndex, role, quote };
  });
  return {
    id: requireSafeId(input.candidateId, 'candidate id'),
    kind: input.kind,
    title: requireBoundedText(input.title, 200, 'candidate title'),
    content: requireBoundedText(input.content, 20_000, 'candidate content'),
    source: {
      label: `Agent run ${capsule.runId} · capsule ${capsule.id}`,
      sessions: [{
        id: capsule.chatSessionId ?? capsule.runId,
        runtime: capsule.request.runtime.name,
        messageRefs,
      }],
    },
  };
}

function applyStaleReview(
  mindRoot: string,
  ledger: ContextFeedbackLedger,
  review: ContextStaleReview,
  timestamp: string,
): ContextStaleReview {
  const asset = readContextAssetRegistry(mindRoot).assets.find((item) => item.id === review.assetId);
  if (!asset || asset.version !== review.assetVersion) {
    throw new Error('Stale context review no longer matches the current asset version.');
  }
  if (!updateContextAssetStatus(mindRoot, review.assetId, 'deprecated', new Date(timestamp))) {
    throw new Error(`Context asset not found: ${review.assetId}`);
  }
  const applied: ContextStaleReview = { ...review, status: 'applied', appliedAt: timestamp };
  const index = ledger.staleReviews.findIndex((item) => item.id === review.id);
  ledger.staleReviews[index] = applied;
  ledger.updatedAt = timestamp;
  writeLedger(mindRoot, ledger);
  return applied;
}

function receiptSelectedAsset(receipt: NonNullable<ReturnType<typeof getRetrievalReceipt>>, assetId: string): boolean {
  return receipt.selections.some((item) => item.assetId === assetId);
}

function sameFeedback(
  current: ContextFeedback,
  next: { signal: ContextFeedbackSignal; note?: string; expectedPath?: string; status: ContextFeedbackStatus },
): boolean {
  return current.signal === next.signal
    && current.note === next.note
    && current.expectedPath === next.expectedPath
    && current.status === next.status;
}

function revisionOf(item: ContextFeedback): ContextFeedbackRevision {
  return {
    revision: item.revision,
    signal: item.signal,
    status: item.status,
    changedAt: item.updatedAt,
    ...(item.note ? { note: item.note } : {}),
    ...(item.expectedPath ? { expectedPath: item.expectedPath } : {}),
  };
}

function readLedgerForMutation(mindRoot: string): ContextFeedbackLedger {
  const file = resolveExistingSafe(mindRoot, CONTEXT_FEEDBACK_LEDGER_FILE);
  if (!existsSync(file)) return emptyLedger();
  try {
    return normalizeLedger(JSON.parse(readFileSync(file, 'utf-8')));
  } catch {
    throw new Error('Context feedback ledger is corrupt; the original file was preserved.');
  }
}

function writeLedger(mindRoot: string, ledger: ContextFeedbackLedger): void {
  const file = resolveExistingSafe(mindRoot, CONTEXT_FEEDBACK_LEDGER_FILE);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(ledger, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    renameSync(temp, file);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* best-effort cleanup */ }
    throw error;
  }
}

function withLedgerLock<T>(mindRoot: string, operation: () => T): T {
  const directory = resolveExistingSafe(mindRoot, FEEDBACK_DIR);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = resolveExistingSafe(mindRoot, LOCK_DIR);
  acquireDirectoryLock(lock);
  try {
    return operation();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function acquireDirectoryLock(lock: string): void {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      mkdirSync(lock, { mode: 0o700 });
      writeFileSync(path.join(lock, 'owner'), `${process.pid}\n${Date.now()}\n`, { encoding: 'utf-8', mode: 0o600 });
      return;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (isStaleLock(lock)) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_WAIT_MS);
    }
  }
  throw new Error('Context feedback ledger is busy; retry shortly.');
}

function normalizeLedger(value: unknown): ContextFeedbackLedger {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.feedback) || !Array.isArray(value.staleReviews)) {
    throw new Error('Invalid context feedback ledger.');
  }
  const feedback = value.feedback.map(normalizeFeedback).filter((item): item is ContextFeedback => item !== null).slice(0, MAX_FEEDBACK);
  const staleReviews = value.staleReviews.map(normalizeStaleReview).filter((item): item is ContextStaleReview => item !== null).slice(0, MAX_STALE_REVIEWS);
  return { schemaVersion: 1, updatedAt: validIso(value.updatedAt) ?? new Date(0).toISOString(), feedback, staleReviews };
}

function normalizeFeedback(value: unknown): ContextFeedback | null {
  if (!isRecord(value)) return null;
  try {
    const signal = normalizeSignal(value.signal);
    const status = value.status === 'active' || value.status === 'retracted' ? value.status : 'active';
    const history = Array.isArray(value.history)
      ? value.history.map(normalizeRevision).filter((item): item is ContextFeedbackRevision => item !== null).slice(-MAX_REVISION_HISTORY)
      : [];
    return {
      id: requireSafeId(value.id, 'feedback id'),
      receiptId: requireSafeId(value.receiptId, 'receipt id'),
      ...(typeof value.runId === 'string' ? { runId: requireSafeId(value.runId, 'run id') } : {}),
      ...(typeof value.assetId === 'string' ? { assetId: requireSafeId(value.assetId, 'asset id') } : {}),
      ...(finitePositiveInteger(value.assetVersion) ? { assetVersion: finitePositiveInteger(value.assetVersion)! } : {}),
      signal,
      status,
      revision: finitePositiveInteger(value.revision) ?? 1,
      createdAt: validIso(value.createdAt) ?? new Date(0).toISOString(),
      updatedAt: validIso(value.updatedAt) ?? new Date(0).toISOString(),
      ...(boundedSensitiveText(value.note, 1_000) ? { note: boundedSensitiveText(value.note, 1_000) } : {}),
      ...(boundedText(value.expectedPath, 500) ? { expectedPath: boundedText(value.expectedPath, 500) } : {}),
      history,
    };
  } catch {
    return null;
  }
}

function normalizeRevision(value: unknown): ContextFeedbackRevision | null {
  if (!isRecord(value)) return null;
  try {
    return {
      revision: finitePositiveInteger(value.revision) ?? 1,
      signal: normalizeSignal(value.signal),
      status: value.status === 'retracted' ? 'retracted' : 'active',
      changedAt: validIso(value.changedAt) ?? new Date(0).toISOString(),
      ...(boundedSensitiveText(value.note, 1_000) ? { note: boundedSensitiveText(value.note, 1_000) } : {}),
      ...(boundedText(value.expectedPath, 500) ? { expectedPath: boundedText(value.expectedPath, 500) } : {}),
    };
  } catch {
    return null;
  }
}

function normalizeStaleReview(value: unknown): ContextStaleReview | null {
  if (!isRecord(value)) return null;
  try {
    const decision = value.decision === 'deprecate' ? 'deprecate' : value.decision === 'keep' ? 'keep' : null;
    if (!decision) return null;
    return {
      id: requireSafeId(value.id, 'stale review id'),
      assetId: requireSafeId(value.assetId, 'asset id'),
      assetVersion: finitePositiveInteger(value.assetVersion) ?? 1,
      decision,
      status: value.status === 'applied' ? 'applied' : 'pending',
      reviewedAt: validIso(value.reviewedAt) ?? new Date(0).toISOString(),
      ...(validIso(value.appliedAt) ? { appliedAt: validIso(value.appliedAt) } : {}),
      ...(boundedSensitiveText(value.note, 1_000) ? { note: boundedSensitiveText(value.note, 1_000) } : {}),
    };
  } catch {
    return null;
  }
}

function emptyLedger(): ContextFeedbackLedger {
  return { schemaVersion: 1, updatedAt: new Date(0).toISOString(), feedback: [], staleReviews: [] };
}

function normalizeSignal(value: unknown): ContextFeedbackSignal {
  if (value === 'helpful' || value === 'irrelevant' || value === 'stale' || value === 'missing') return value;
  throw new Error('Context feedback signal must be helpful, irrelevant, stale, or missing.');
}

function boundedSensitiveText(value: unknown, max: number): string | undefined {
  const text = boundedText(value, max * 2);
  return text
    ? redactSensitiveText(text).replace(/\bbearer\s+[^\s"',;]+/gi, 'Bearer [redacted]').slice(0, max)
    : undefined;
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text ? text.slice(0, max) : undefined;
}

function requireBoundedText(value: unknown, max: number, label: string): string {
  const text = boundedText(value, max);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function requireSafeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function messageText(message: Record<string, unknown>): string {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((part) => isRecord(part) && typeof part.text === 'string' ? part.text : '').join('\n');
  }
  return '';
}

function validNow(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new Error('Context feedback timestamp must be valid.');
  return value.toISOString();
}

function validIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function finitePositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined;
}

function finiteLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(fallback, Math.floor(value!))) : fallback;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isStaleLock(lock: string): boolean {
  try { return Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS; } catch { return false; }
}

function isAlreadyExists(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'EEXIST';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
