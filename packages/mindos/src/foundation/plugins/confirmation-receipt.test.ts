import { describe, expect, it } from 'vitest';
import {
  canonicalJsonStable,
  computeArtifactFingerprint,
  createConfirmationReceipt,
  evaluateInstallConfirmation,
  matchInstallConfirmationFingerprint,
  verifyConfirmationReceipt,
} from './confirmation-receipt.js';

describe('canonicalJsonStable', () => {
  it('sorts object keys recursively so key order does not change the output', () => {
    expect(canonicalJsonStable({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: 'x' } }))
      .toBe(canonicalJsonStable({ a: { c: 'x', d: [1, { e: 3, f: 2 }] }, b: 1 }));
    expect(canonicalJsonStable({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('keeps array order significant and preserves scalar shapes', () => {
    expect(canonicalJsonStable([1, 2])).not.toBe(canonicalJsonStable([2, 1]));
    expect(canonicalJsonStable('a')).toBe('"a"');
    expect(canonicalJsonStable(null)).toBe('null');
    expect(canonicalJsonStable(undefined)).toBeUndefined();
    expect(canonicalJsonStable({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('drops prototype-pollution keys instead of serializing them', () => {
    expect(canonicalJsonStable({ __proto__: { admin: true }, ok: 1 })).toBe('{"ok":1}');
    const payload = JSON.parse('{"constructor":{"x":1},"safe":true}');
    expect(canonicalJsonStable(payload)).toBe('{"safe":true}');
  });
});

describe('computeArtifactFingerprint', () => {
  it('is deterministic across key order and stable across calls', () => {
    const a = computeArtifactFingerprint({ id: 'demo', commands: ['x'] });
    const b = computeArtifactFingerprint({ commands: ['x'], id: 'demo' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it('changes when any semantic field changes', () => {
    const base = computeArtifactFingerprint({ id: 'demo', command: 'codebuddy' });
    expect(computeArtifactFingerprint({ id: 'demo', command: 'codebuddy-next' })).not.toBe(base);
    expect(computeArtifactFingerprint({ id: 'demo2', command: 'codebuddy' })).not.toBe(base);
    expect(computeArtifactFingerprint({ id: 'demo', command: 'codebuddy', replace: true })).not.toBe(base);
  });

  it('honours a custom fingerprint length', () => {
    expect(computeArtifactFingerprint({ id: 'demo' }, { length: 16 })).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('confirmation receipts', () => {
  const fingerprint = computeArtifactFingerprint({ id: 'demo' });

  it('creates a receipt with confirmedAt and optional ttl', () => {
    const receipt = createConfirmationReceipt(fingerprint, { confirmedAt: '2026-09-11T00:00:00.000Z' });
    expect(receipt).toEqual({ fingerprint, confirmedAt: '2026-09-11T00:00:00.000Z' });
    const withTtl = createConfirmationReceipt(fingerprint, { confirmedAt: '2026-09-11T00:00:00.000Z', ttlMs: 60_000 });
    expect(withTtl.ttlMs).toBe(60_000);
  });

  it('verifies a matching, unexpired receipt', () => {
    const receipt = createConfirmationReceipt(fingerprint, { confirmedAt: '2026-09-11T00:00:00.000Z', ttlMs: 60_000 });
    const result = verifyConfirmationReceipt(receipt, {
      expectedFingerprint: fingerprint,
      now: () => new Date('2026-09-11T00:00:30.000Z'),
    });
    expect(result).toMatchObject({ valid: true, reason: 'ok' });
  });

  it('rejects a mismatched fingerprint', () => {
    const receipt = createConfirmationReceipt(fingerprint, { confirmedAt: '2026-09-11T00:00:00.000Z' });
    const result = verifyConfirmationReceipt(receipt, {
      expectedFingerprint: computeArtifactFingerprint({ id: 'other' }),
      now: () => new Date('2026-09-11T00:00:00.000Z'),
    });
    expect(result).toMatchObject({ valid: false, reason: 'fingerprint-mismatch' });
  });

  it('rejects an expired receipt at the ttl boundary', () => {
    const receipt = createConfirmationReceipt(fingerprint, { confirmedAt: '2026-09-11T00:00:00.000Z', ttlMs: 60_000 });
    const atBoundary = verifyConfirmationReceipt(receipt, {
      expectedFingerprint: fingerprint,
      now: () => new Date('2026-09-11T00:01:00.000Z'),
    });
    expect(atBoundary).toMatchObject({ valid: true, reason: 'ok' });
    const pastBoundary = verifyConfirmationReceipt(receipt, {
      expectedFingerprint: fingerprint,
      now: () => new Date('2026-09-11T00:01:00.001Z'),
    });
    expect(pastBoundary).toMatchObject({ valid: false, reason: 'expired' });
  });

  it('treats a receipt without ttl as non-expiring', () => {
    const receipt = createConfirmationReceipt(fingerprint, { confirmedAt: '2026-09-11T00:00:00.000Z' });
    const result = verifyConfirmationReceipt(receipt, {
      expectedFingerprint: fingerprint,
      now: () => new Date('2030-01-01T00:00:00.000Z'),
    });
    expect(result).toMatchObject({ valid: true, reason: 'ok' });
  });

  it('rejects invalid confirmedAt values and future timestamps beyond grace', () => {
    const receipt = createConfirmationReceipt(fingerprint, { confirmedAt: 'not-a-date' });
    expect(verifyConfirmationReceipt(receipt, {
      expectedFingerprint: fingerprint,
      now: () => new Date('2026-09-11T00:00:00.000Z'),
    })).toMatchObject({ valid: false, reason: 'invalid-confirmed-at' });

    const future = createConfirmationReceipt(fingerprint, { confirmedAt: '2026-09-11T01:00:00.000Z' });
    expect(verifyConfirmationReceipt(future, {
      expectedFingerprint: fingerprint,
      now: () => new Date('2026-09-11T00:00:00.000Z'),
    })).toMatchObject({ valid: false, reason: 'invalid-confirmed-at' });
    expect(verifyConfirmationReceipt(future, {
      expectedFingerprint: fingerprint,
      now: () => new Date('2026-09-11T00:00:00.000Z'),
      graceMs: 60 * 60 * 1000,
    })).toMatchObject({ valid: true, reason: 'ok' });
  });

  it('rejects structurally broken receipts', () => {
    const now = () => new Date('2026-09-11T00:00:00.000Z');
    expect(verifyConfirmationReceipt(undefined, { expectedFingerprint: fingerprint, now })).toMatchObject({ valid: false });
    expect(verifyConfirmationReceipt({ fingerprint: 42 } as never, { expectedFingerprint: fingerprint, now })).toMatchObject({ valid: false, reason: 'fingerprint-mismatch' });
    expect(verifyConfirmationReceipt({ fingerprint, confirmedAt: 5 } as never, { expectedFingerprint: fingerprint, now })).toMatchObject({ valid: false, reason: 'invalid-confirmed-at' });
    expect(verifyConfirmationReceipt({ fingerprint, confirmedAt: '2026-09-11T00:00:00.000Z', ttlMs: -1 }, { expectedFingerprint: fingerprint, now })).toMatchObject({ valid: false, reason: 'expired' });
  });
});

describe('evaluateInstallConfirmation', () => {
  const fingerprint = computeArtifactFingerprint({ id: 'demo' });

  it('recognizes a fingerprint confirmation', () => {
    expect(evaluateInstallConfirmation({ confirmFingerprint: fingerprint })).toEqual({ kind: 'fingerprint', fingerprint });
  });

  it('recognizes the legacy boolean confirm with a deprecation warning', () => {
    const result = evaluateInstallConfirmation({ confirm: true });
    expect(result.kind).toBe('legacy-boolean');
    if (result.kind === 'legacy-boolean') {
      expect(result.warning).toMatch(/confirm: true is deprecated/);
      expect(result.warning).toMatch(/confirmFingerprint/);
      expect(result.warning).toMatch(/next release/);
    }
  });

  it('rejects missing, falsy, ambiguous, and malformed confirmations', () => {
    expect(evaluateInstallConfirmation({})).toEqual({ kind: 'missing' });
    expect(evaluateInstallConfirmation({ confirm: false })).toEqual({ kind: 'missing' });
    expect(evaluateInstallConfirmation({ confirm: 'yes' })).toEqual({ kind: 'missing' });
    expect(evaluateInstallConfirmation({ confirmFingerprint: fingerprint, confirm: true })).toEqual({ kind: 'ambiguous' });
    expect(evaluateInstallConfirmation({ confirmFingerprint: true })).toEqual({ kind: 'invalid' });
    expect(evaluateInstallConfirmation({ confirmFingerprint: 123 })).toEqual({ kind: 'invalid' });
    expect(evaluateInstallConfirmation({ confirmFingerprint: '   ' })).toEqual({ kind: 'invalid' });
    expect(evaluateInstallConfirmation({ confirmFingerprint: { value: fingerprint } })).toEqual({ kind: 'invalid' });
  });
});

describe('matchInstallConfirmationFingerprint', () => {
  const fingerprint = computeArtifactFingerprint({ id: 'demo' });
  const mismatchMessage = 'Confirmation does not match the submitted manifest.';

  it('accepts a matching fingerprint', () => {
    expect(matchInstallConfirmationFingerprint({ kind: 'fingerprint', fingerprint }, fingerprint, { mismatchMessage }))
      .toEqual({ ok: true });
  });

  it('rejects a mismatched fingerprint with the caller message', () => {
    const other = computeArtifactFingerprint({ id: 'changed' });
    expect(matchInstallConfirmationFingerprint({ kind: 'fingerprint', fingerprint: other }, fingerprint, { mismatchMessage }))
      .toEqual({ ok: false, error: mismatchMessage });
  });

  it('carries the legacy warning through', () => {
    const legacy = evaluateInstallConfirmation({ confirm: true });
    const result = matchInstallConfirmationFingerprint(legacy, fingerprint, { mismatchMessage });
    expect(result).toEqual({ ok: true, warning: legacy.kind === 'legacy-boolean' ? legacy.warning : '' });
  });
});
