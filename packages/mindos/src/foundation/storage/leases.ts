import crypto from 'node:crypto';
import { resolveExistingSafe } from '../security/index.js';
import {
  openMindosDatabase,
  type MindosDatabase,
  type MindosDatabaseMigration,
} from './sqlite.js';

/**
 * Cross-process leases backed by SQLite (spec-automations-lease-store).
 *
 * A lease is a row in `leases(kind, key)` that names an owner and the instant
 * it expires. Acquiring is one `INSERT ... ON CONFLICT DO UPDATE ... WHERE
 * lease_until <= now` inside `BEGIN IMMEDIATE`, so exactly one writer wins a
 * free or expired lease. Releasing and renewing match on the owner, so a
 * holder whose lease was taken over cannot disturb the new holder. Because
 * expiry is a timestamp, a killed process never leaves a permanent lock.
 *
 * All leases live in `.mindos/db/state_1.sqlite`, a small coordination
 * database separate from the per-domain derived stores.
 */

export const STATE_DB_RELATIVE_PATH = '.mindos/db/state_1.sqlite';

const MAX_KEY_LENGTH = 200;
const DEFAULT_WAIT_MS = 1_000;
const INITIAL_BACKOFF_MS = 5;
const MAX_BACKOFF_MS = 50;

const MIGRATIONS: MindosDatabaseMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE leases(
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        owner TEXT NOT NULL,
        lease_until INTEGER NOT NULL,
        acquired_at INTEGER NOT NULL,
        PRIMARY KEY(kind, key)
      );
    `,
  },
];

export interface LeaseKey {
  kind: string;
  key: string;
}

export interface Lease extends LeaseKey {
  owner: string;
  /** Epoch milliseconds after which any writer may take the lease over. */
  leaseUntil: number;
  acquiredAt: number;
}

export interface TryAcquireLeaseOptions extends LeaseKey {
  ttlMs: number;
  /** Defaults to `pid-<pid>-<uuid>`, unique per acquisition. */
  owner?: string;
  now?: () => number;
}

export type TryAcquireLeaseResult =
  | { ok: true; lease: Lease }
  | { ok: false; holder: Lease | null };

export interface AcquireLeaseOptions extends TryAcquireLeaseOptions {
  /** Total time to keep retrying before throwing `LeaseBusyError`. */
  waitMs?: number;
  /** Blocking sleep used between attempts; injectable for tests. */
  sleep?: (ms: number) => void;
  /**
   * When it returns true the attempt is skipped and counted as contention.
   * Lets a caller fold an external lock (for example a lock directory left by
   * an older version) into the same bounded wait.
   */
  isContended?: () => boolean;
}

export class LeaseBusyError extends Error {
  readonly kind: string;
  readonly key: string;
  readonly holder: Lease | null;

  constructor(kind: string, key: string, holder: Lease | null) {
    super(
      holder
        ? `Lease ${kind}/${key} is busy (held by ${holder.owner} until ${new Date(holder.leaseUntil).toISOString()}).`
        : `Lease ${kind}/${key} is busy.`,
    );
    this.name = 'LeaseBusyError';
    this.kind = kind;
    this.key = key;
    this.holder = holder;
  }
}

interface LeaseRow {
  kind: string;
  key: string;
  owner: string;
  lease_until: number | bigint;
  acquired_at: number | bigint;
}

const LEASE_COLUMNS = 'kind, key, owner, lease_until, acquired_at';

/** Opens (creating if needed) the coordination database for `mindRoot`. */
export function openStateDatabase(mindRoot: string): MindosDatabase {
  const file = resolveExistingSafe(mindRoot, STATE_DB_RELATIVE_PATH);
  return openMindosDatabase({ file, migrations: MIGRATIONS });
}

/**
 * One attempt to take the lease. Succeeds when no row exists or the existing
 * row has expired; otherwise reports the current holder without changing it.
 */
export function tryAcquireLease(db: MindosDatabase, options: TryAcquireLeaseOptions): TryAcquireLeaseResult {
  const kind = validKeyPart(options.kind, 'kind');
  const key = validKeyPart(options.key, 'key');
  const ttlMs = validPositiveMs(options.ttlMs, 'ttlMs');
  const owner = options.owner === undefined ? defaultOwner() : validKeyPart(options.owner, 'owner');
  const now = options.now ?? Date.now;
  const acquiredAt = Math.floor(now());
  const leaseUntil = acquiredAt + Math.floor(ttlMs);
  return db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO leases(${LEASE_COLUMNS}) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(kind, key) DO UPDATE SET
        owner = excluded.owner,
        lease_until = excluded.lease_until,
        acquired_at = excluded.acquired_at
      WHERE leases.lease_until <= excluded.acquired_at
    `).run(kind, key, owner, leaseUntil, acquiredAt);
    if (Number(result.changes) === 1) {
      return { ok: true, lease: { kind, key, owner, leaseUntil, acquiredAt } };
    }
    return { ok: false, holder: readLease(db, { kind, key }) };
  });
}

/**
 * Blocks until the lease is acquired or `waitMs` is spent, sleeping between
 * attempts with exponential backoff (5 ms doubling to 50 ms) and never past
 * the holder's own expiry. Meant for synchronous store code that already
 * blocks; the wait is bounded by `waitMs` (default 1 s).
 */
export function acquireLease(db: MindosDatabase, options: AcquireLeaseOptions): Lease {
  const waitMs = validPositiveMs(options.waitMs ?? DEFAULT_WAIT_MS, 'waitMs');
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepSync;
  const deadline = now() + waitMs;
  let delayMs = INITIAL_BACKOFF_MS;
  let holder: Lease | null = null;
  for (;;) {
    if (!options.isContended?.()) {
      const attempt = tryAcquireLease(db, options);
      if (attempt.ok) return attempt.lease;
      holder = attempt.holder;
    }
    const current = now();
    const remaining = deadline - current;
    if (remaining <= 0) throw new LeaseBusyError(options.kind, options.key, holder);
    let wait = Math.min(delayMs, remaining);
    if (holder) wait = Math.max(1, Math.min(wait, holder.leaseUntil - current));
    sleep(wait);
    delayMs = Math.min(delayMs * 2, MAX_BACKOFF_MS);
  }
}

/** Extends the lease by `ttlMs` from now; null when the caller no longer owns it or it expired. */
export function renewLease(db: MindosDatabase, lease: Lease, ttlMs: number, now: () => number = Date.now): Lease | null {
  const ttl = validPositiveMs(ttlMs, 'ttlMs');
  const current = Math.floor(now());
  const leaseUntil = current + Math.floor(ttl);
  const result = db.prepare(`
    UPDATE leases SET lease_until = ?
    WHERE kind = ? AND key = ? AND owner = ? AND lease_until > ?
  `).run(leaseUntil, lease.kind, lease.key, lease.owner, current);
  return Number(result.changes) === 1 ? { ...lease, leaseUntil } : null;
}

/** Deletes the lease when `lease.owner` still holds it. Returns whether a row was removed. */
export function releaseLease(db: MindosDatabase, lease: Lease): boolean {
  const result = db.prepare('DELETE FROM leases WHERE kind = ? AND key = ? AND owner = ?')
    .run(lease.kind, lease.key, lease.owner);
  return Number(result.changes) === 1;
}

/** Current row for the key, expired or not; null when nobody holds it. */
export function readLease(db: MindosDatabase, key: LeaseKey): Lease | null {
  const row = db.prepare(`SELECT ${LEASE_COLUMNS} FROM leases WHERE kind = ? AND key = ?`)
    .get(key.kind, key.key) as LeaseRow | undefined;
  if (!row) return null;
  return {
    kind: row.kind,
    key: row.key,
    owner: row.owner,
    leaseUntil: Number(row.lease_until),
    acquiredAt: Number(row.acquired_at),
  };
}

function defaultOwner(): string {
  return `pid-${process.pid}-${crypto.randomUUID()}`;
}

function validKeyPart(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_KEY_LENGTH) {
    throw new Error(`Lease ${name} must be a non-empty string of at most ${MAX_KEY_LENGTH} characters.`);
  }
  return value;
}

function validPositiveMs(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Lease ${name} must be a positive finite number of milliseconds.`);
  }
  return value;
}

/**
 * Blocks the current thread for `ms`. Only used from synchronous store paths
 * that already block on file I/O, and always bounded by `waitMs`.
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, Math.ceil(ms)));
}
