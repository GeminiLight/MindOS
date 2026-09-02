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
import { resolveExistingSafe } from '../../foundation/security/index.js';
import {
  listContextAssets,
  registerContextAsset,
  removeContextAsset,
} from './registry.js';

export type EchoPromotionKind = 'playbook' | 'practice';

export type EchoPromotionMessageRef = {
  messageIndex: number;
  role: string;
  quote: string;
};

export type EchoPromotionSourceSession = {
  id: string;
  title?: string;
  runtime?: string;
  messageRefs?: EchoPromotionMessageRef[];
};

export type EchoPromotionCandidate = {
  id: string;
  kind: EchoPromotionKind;
  title: string;
  content: string;
  source: {
    label?: string;
    sessions: EchoPromotionSourceSession[];
  };
};

export type EchoPromotionReview = {
  cardId: string;
  decision: 'approved' | 'rejected';
  reviewedAt: string;
  candidateHash: string;
  note?: string;
  assetId?: string;
  targetPath?: string;
};

export type ReviewEchoPromotionInput = {
  decision: 'approve' | 'reject';
  candidate: EchoPromotionCandidate;
  note?: string;
};

const REVIEW_DIR = '.mindos/echo/promotion-reviews';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const LOCK_ATTEMPTS = 50;
const LOCK_WAIT_MS = 10;
const STALE_LOCK_MS = 30_000;

export function reviewEchoPromotionCandidate(
  mindRoot: string,
  input: ReviewEchoPromotionInput,
  now = new Date(),
): EchoPromotionReview {
  const candidate = normalizeCandidate(input.candidate);
  const requestedDecision = input.decision === 'approve' ? 'approved' : input.decision === 'reject' ? 'rejected' : null;
  if (!requestedDecision) throw new Error('Echo promotion decision must be approve or reject.');
  const note = normalizeText(input.note, 1_000);
  const reviewPath = reviewRelativePath(candidate.id);
  const candidateHash = hashJson(candidate);

  return withReviewLock(mindRoot, candidate.id, () => {
    const existing = readReviewFile(mindRoot, reviewPath);
    if (existing) {
      if (existing.decision === requestedDecision && existing.candidateHash === candidateHash) return existing;
      if (existing.decision === requestedDecision) {
        throw new Error('Echo promotion candidate changed after its review became immutable.');
      }
      throw new Error(`Echo promotion card was already ${existing.decision}.`);
    }

    const reviewedAt = now.toISOString();
    if (requestedDecision === 'rejected') {
      const review: EchoPromotionReview = {
        cardId: candidate.id,
        decision: 'rejected',
        reviewedAt,
        candidateHash,
        ...(note ? { note } : {}),
      };
      writeReviewFile(mindRoot, reviewPath, review);
      return review;
    }

    const evidence = collectEvidence(candidate);
    if (evidence.length === 0) {
      throw new Error('Echo promotion approval requires at least one grounded message reference as evidence.');
    }

    const sourceRef = `echo-card:${candidate.id}`;
    const assetId = `asset-${sha256(sourceRef).slice(0, 20)}`;
    const targetPath = promotionTargetPath(candidate);
    const markdown = renderPromotionMarkdown(candidate, evidence, assetId, reviewedAt);
    const assetKind = candidate.kind === 'playbook' ? 'echo-playbook' : 'echo-practice';
    const target = resolveExistingSafe(mindRoot, targetPath);
    mkdirSync(path.dirname(target), { recursive: true });

    const priorAssets = listContextAssets(mindRoot, { sourceRef });
    if (priorAssets.some((asset) => (
      asset.id !== assetId
      || asset.kind !== assetKind
      || asset.path !== targetPath
      || asset.contentHash !== sha256(markdown)
    ))) {
      throw new Error(`Echo promotion context asset conflicts with candidate: ${candidate.id}`);
    }
    let createdNote = false;
    try {
      if (existsSync(target)) {
        if (!statSync(target).isFile() || readFileSync(target, 'utf-8') !== markdown) {
          throw new Error(`Echo promotion target already exists with different content: ${targetPath}`);
        }
      } else {
        writeFileSync(target, markdown, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
        createdNote = true;
      }

      const asset = registerContextAsset(mindRoot, {
        id: assetId,
        kind: assetKind,
        status: 'active',
        title: candidate.title,
        path: targetPath,
        contentHash: sha256(markdown),
        source: { kind: 'echo-card', ref: sourceRef },
        metadata: {
          sourceCardId: candidate.id,
          sourceSessionIds: candidate.source.sessions.map((session) => session.id),
          evidenceCount: evidence.length,
        },
      }, now);
      const review: EchoPromotionReview = {
        cardId: candidate.id,
        decision: 'approved',
        reviewedAt,
        candidateHash,
        ...(note ? { note } : {}),
        assetId: asset.id,
        targetPath,
      };
      writeReviewFile(mindRoot, reviewPath, review);
      return review;
    } catch (error) {
      if (createdNote) {
        try { unlinkSync(target); } catch { /* best-effort rollback */ }
      }
      if (priorAssets.length === 0) {
        try { removeContextAsset(mindRoot, assetId, now); } catch { /* best-effort rollback */ }
      }
      throw error;
    }
  });
}

export function readEchoPromotionReview(
  mindRoot: string,
  cardId: string,
): EchoPromotionReview | null {
  return readReviewFile(mindRoot, reviewRelativePath(normalizeId(cardId)));
}

function readReviewFile(mindRoot: string, relativePath: string): EchoPromotionReview | null {
  try {
    const file = resolveExistingSafe(mindRoot, relativePath);
    if (!existsSync(file) || !statSync(file).isFile()) return null;
    return normalizeStoredReview(JSON.parse(readFileSync(file, 'utf-8')));
  } catch {
    return null;
  }
}

function writeReviewFile(mindRoot: string, relativePath: string, review: EchoPromotionReview): void {
  const file = resolveExistingSafe(mindRoot, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(review, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    renameSync(temp, file);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* best-effort cleanup */ }
    throw error;
  }
}

function withReviewLock<T>(mindRoot: string, cardId: string, operation: () => T): T {
  const directory = resolveExistingSafe(mindRoot, REVIEW_DIR);
  mkdirSync(directory, { recursive: true });
  const lock = resolveExistingSafe(mindRoot, `${REVIEW_DIR}/${sha256(cardId).slice(0, 24)}.lock`);
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
      mkdirSync(lock);
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
  throw new Error('Echo promotion review is busy; retry shortly.');
}

function isStaleLock(lock: string): boolean {
  try {
    return Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS;
  } catch {
    return false;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'EEXIST';
}

function reviewRelativePath(cardId: string): string {
  return `${REVIEW_DIR}/${sha256(cardId).slice(0, 32)}.json`;
}

function promotionTargetPath(candidate: EchoPromotionCandidate): string {
  const directory = candidate.kind === 'playbook' ? 'Playbooks' : 'Practices';
  return `Echo/${directory}/${slugify(candidate.title)}-${sha256(candidate.id).slice(0, 8)}.md`;
}

function renderPromotionMarkdown(
  candidate: EchoPromotionCandidate,
  evidence: Array<EchoPromotionMessageRef & { sessionId: string; sessionTitle?: string; runtime?: string }>,
  assetId: string,
  reviewedAt: string,
): string {
  const type = candidate.kind === 'playbook' ? 'echo.playbook' : 'echo.practice';
  const sessionIds = [...new Set(candidate.source.sessions.map((session) => session.id))];
  const lines = [
    '---',
    `type: ${type}`,
    `contextAssetId: ${assetId}`,
    `sourceCardId: ${candidate.id}`,
    `promotedAt: ${reviewedAt}`,
    'sourceSessionIds:',
    ...sessionIds.map((id) => `  - ${yamlString(id)}`),
    '---',
    '',
    `# ${candidate.title}`,
    '',
    candidate.content,
    '',
    '## Evidence',
    '',
    ...evidence.map((item) => {
      const session = item.sessionTitle || item.sessionId;
      const runtime = item.runtime ? ` · ${item.runtime}` : '';
      return `- ${session}${runtime} · ${item.role} message #${item.messageIndex + 1}: ${item.quote}`;
    }),
    '',
  ];
  return lines.join('\n');
}

function collectEvidence(candidate: EchoPromotionCandidate) {
  return candidate.source.sessions.flatMap((session) => (
    (session.messageRefs ?? []).map((messageRef) => ({
      ...messageRef,
      sessionId: session.id,
      ...(session.title ? { sessionTitle: session.title } : {}),
      ...(session.runtime ? { runtime: session.runtime } : {}),
    }))
  ));
}

function normalizeCandidate(value: EchoPromotionCandidate): EchoPromotionCandidate {
  if (!value || typeof value !== 'object') throw new Error('Echo promotion candidate is required.');
  const id = normalizeId(value.id);
  if (value.kind !== 'playbook' && value.kind !== 'practice') {
    throw new Error('Echo promotion candidate kind must be playbook or practice.');
  }
  const title = requiredText(value.title, 200, 'title');
  const content = requiredText(value.content, 8_000, 'content');
  if (!value.source || !Array.isArray(value.source.sessions)) {
    throw new Error('Echo promotion candidate source sessions are required.');
  }
  const sessions = value.source.sessions.slice(0, 50).map((session) => ({
    id: requiredText(session?.id, 200, 'source session id'),
    ...(normalizeText(session?.title, 200) ? { title: normalizeText(session.title, 200) } : {}),
    ...(normalizeText(session?.runtime, 100) ? { runtime: normalizeText(session.runtime, 100) } : {}),
    messageRefs: Array.isArray(session?.messageRefs)
      ? session.messageRefs.slice(0, 100).map(normalizeMessageRef).filter((item): item is EchoPromotionMessageRef => item !== null)
      : [],
  }));
  return {
    id,
    kind: value.kind,
    title,
    content,
    source: {
      ...(normalizeText(value.source.label, 300) ? { label: normalizeText(value.source.label, 300) } : {}),
      sessions,
    },
  };
}

function normalizeMessageRef(value: unknown): EchoPromotionMessageRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const messageIndex = typeof record.messageIndex === 'number' && Number.isFinite(record.messageIndex)
    ? Math.floor(record.messageIndex)
    : -1;
  const role = normalizeText(record.role, 40);
  const quote = normalizeText(record.quote, 1_000);
  return messageIndex >= 0 && role && quote ? { messageIndex, role, quote } : null;
}

function normalizeStoredReview(value: unknown): EchoPromotionReview | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  try {
    const decision = record.decision === 'approved' || record.decision === 'rejected' ? record.decision : null;
    const reviewedAt = typeof record.reviewedAt === 'string' && Number.isFinite(Date.parse(record.reviewedAt))
      ? new Date(record.reviewedAt).toISOString()
      : null;
    const candidateHash = typeof record.candidateHash === 'string' && /^[a-f0-9]{64}$/.test(record.candidateHash)
      ? record.candidateHash
      : null;
    if (!decision || !reviewedAt || !candidateHash) return null;
    const note = normalizeText(record.note, 1_000);
    const assetId = normalizeText(record.assetId, 120);
    const targetPath = normalizeText(record.targetPath, 1_000);
    return {
      cardId: normalizeId(record.cardId),
      decision,
      reviewedAt,
      candidateHash,
      ...(note ? { note } : {}),
      ...(decision === 'approved' && assetId ? { assetId } : {}),
      ...(decision === 'approved' && targetPath ? { targetPath } : {}),
    };
  } catch {
    return null;
  }
}

function normalizeId(value: unknown): string {
  const id = normalizeText(value, 120);
  if (!SAFE_ID.test(id)) throw new Error('Echo promotion card id is invalid.');
  return id;
}

function requiredText(value: unknown, max: number, label: string): string {
  const text = normalizeText(value, max);
  if (!text) throw new Error(`Echo promotion candidate ${label} is required.`);
  return text;
}

function normalizeText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'promoted-experience';
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function hashJson(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
