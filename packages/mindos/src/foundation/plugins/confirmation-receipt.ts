/**
 * Fingerprint-based confirmation receipts for plugin-shaped installs.
 *
 * Reference model: the Obsidian capability gate
 * (`web/lib/obsidian-compat/capability-gate.ts`) — a canonical-JSON sha256
 * fingerprint of the reviewed artifact plus `{ confirmedAt, fingerprint }`
 * records that stop authorizing as soon as the artifact changes. This module
 * generalizes that into transport-agnostic primitives:
 *
 * - `canonicalJsonStable` / `computeArtifactFingerprint`: stable fingerprints
 *   for any JSON-serializable artifact (manifest, package digest, ...);
 * - `createConfirmationReceipt` / `verifyConfirmationReceipt`: stored
 *   confirmations with optional ttl;
 * - `evaluateInstallConfirmation` / `matchInstallConfirmationFingerprint`:
 *   request-shape handling for install endpoints that are migrating from a
 *   boolean `confirm: true` to `confirmFingerprint` echo (the boolean stays
 *   accepted for exactly one release, flagged by a deprecation warning).
 */

import { createHash } from 'crypto';

export interface ConfirmationReceipt {
  fingerprint: string;
  /** ISO timestamp of when the user confirmed the artifact. */
  confirmedAt: string;
  /** Optional lifetime in ms; absent means the receipt does not expire by time. */
  ttlMs?: number;
}

export type ConfirmationReceiptVerifyReason =
  | 'ok'
  | 'fingerprint-mismatch'
  | 'expired'
  | 'invalid-confirmed-at';

export interface ConfirmationReceiptVerifyResult {
  valid: boolean;
  reason: ConfirmationReceiptVerifyReason;
}

const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DEFAULT_FINGERPRINT_LENGTH = 32;

/**
 * Canonical JSON: object keys sorted at every level, arrays order-preserving,
 * `undefined` members dropped, prototype-pollution keys never emitted.
 */
export function canonicalJsonStable(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonStable(item) ?? 'null').join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const members = Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) => !PROTOTYPE_KEYS.has(key) && item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJsonStable(item) ?? 'null'}`);
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computeArtifactFingerprint(
  payload: unknown,
  options: { length?: number } = {},
): string {
  const length = options.length ?? DEFAULT_FINGERPRINT_LENGTH;
  const canonical = canonicalJsonStable(payload) ?? 'null';
  return createHash('sha256').update(canonical).digest('hex').slice(0, length);
}

export function createConfirmationReceipt(
  fingerprint: string,
  options: { confirmedAt?: string; ttlMs?: number } = {},
): ConfirmationReceipt {
  return {
    fingerprint,
    confirmedAt: options.confirmedAt ?? new Date().toISOString(),
    ...(options.ttlMs !== undefined ? { ttlMs: options.ttlMs } : {}),
  };
}

export function verifyConfirmationReceipt(
  receipt: ConfirmationReceipt | undefined,
  options: {
    expectedFingerprint: string;
    now?: () => Date;
    /** How far a future `confirmedAt` may sit ahead of `now` (clock skew). Default 0. */
    graceMs?: number;
  },
): ConfirmationReceiptVerifyResult {
  if (!receipt || typeof receipt !== 'object' || typeof receipt.fingerprint !== 'string') {
    return { valid: false, reason: 'fingerprint-mismatch' };
  }
  if (receipt.fingerprint !== options.expectedFingerprint) {
    return { valid: false, reason: 'fingerprint-mismatch' };
  }

  const confirmedAt = Date.parse(receipt.confirmedAt);
  if (typeof receipt.confirmedAt !== 'string' || Number.isNaN(confirmedAt)) {
    return { valid: false, reason: 'invalid-confirmed-at' };
  }
  const now = (options.now ?? (() => new Date()))().getTime();
  const graceMs = options.graceMs ?? 0;
  if (confirmedAt > now + graceMs) {
    return { valid: false, reason: 'invalid-confirmed-at' };
  }
  if (receipt.ttlMs !== undefined) {
    if (typeof receipt.ttlMs !== 'number' || !Number.isFinite(receipt.ttlMs) || receipt.ttlMs < 0) {
      return { valid: false, reason: 'expired' };
    }
    if (now - confirmedAt > receipt.ttlMs) {
      return { valid: false, reason: 'expired' };
    }
  }
  return { valid: true, reason: 'ok' };
}

/* ── Install-request confirmation shape ────────────────────────────────── */

export const LEGACY_BOOLEAN_CONFIRM_WARNING =
  'confirm: true is deprecated; send confirmFingerprint from the preflight response. '
  + 'Boolean confirmation will be removed in the next release.';

export type InstallConfirmationShapeResult =
  | { kind: 'fingerprint'; fingerprint: string }
  | { kind: 'legacy-boolean'; warning: string }
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'ambiguous' };

/**
 * Classify the confirmation fields on an install request body *before* the
 * fingerprint is known. String `confirmFingerprint` wins; `confirm: true`
 * alone is the deprecated legacy path; carrying both is ambiguous (a client
 * must not be able to hedge a downgrade); anything else is missing/invalid.
 */
export function evaluateInstallConfirmation(body: unknown): InstallConfirmationShapeResult {
  const record = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const hasFingerprint = 'confirmFingerprint' in record && record.confirmFingerprint !== undefined && record.confirmFingerprint !== null;
  const legacyTrue = record.confirm === true;
  if (hasFingerprint && legacyTrue) return { kind: 'ambiguous' };
  if (hasFingerprint) {
    return typeof record.confirmFingerprint === 'string' && record.confirmFingerprint.trim()
      ? { kind: 'fingerprint', fingerprint: record.confirmFingerprint.trim() }
      : { kind: 'invalid' };
  }
  if (legacyTrue) return { kind: 'legacy-boolean', warning: LEGACY_BOOLEAN_CONFIRM_WARNING };
  return { kind: 'missing' };
}

export type InstallConfirmationMatchResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

/**
 * Match a classified confirmation against the server-recomputed fingerprint.
 * Legacy boolean confirmations always "match" (the release-window deprecation)
 * but carry their warning into the response.
 */
export function matchInstallConfirmationFingerprint(
  shape: InstallConfirmationShapeResult,
  expectedFingerprint: string,
  options: { mismatchMessage: string },
): InstallConfirmationMatchResult {
  if (shape.kind === 'fingerprint') {
    return shape.fingerprint === expectedFingerprint
      ? { ok: true }
      : { ok: false, error: options.mismatchMessage };
  }
  if (shape.kind === 'legacy-boolean') return { ok: true, warning: shape.warning };
  return { ok: false, error: options.mismatchMessage };
}
