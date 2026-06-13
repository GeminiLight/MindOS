import { describe, expect, it } from 'vitest';
import { redactSensitiveObject, redactSensitiveText } from './redaction.js';

describe('redactSensitiveText', () => {
  it('redacts bearer headers, key=value pairs, and query-string credentials', () => {
    expect(redactSensitiveText('Authorization: Bearer sk-ledger-secret-1234567890'))
      .toBe('Authorization: Bearer [redacted]');
    expect(redactSensitiveText('token=abc123secret done')).toBe('token=[redacted] done');
    expect(redactSensitiveText('https://api.test/v1?api_key=abcd1234&page=2'))
      .toBe('https://api.test/v1?api_key=[redacted]&page=2');
  });

  it('redacts well-known credential token shapes', () => {
    expect(redactSensitiveText('sk-ant-api03-abcdefgh12345678')).toBe('[redacted]');
    expect(redactSensitiveText('sk-abcdefghijklmnop1234')).toBe('[redacted]');
    expect(redactSensitiveText('ghp_abcdefghijklmnopqrstuvwxyz123456')).toBe('[redacted]');
    expect(redactSensitiveText('github_pat_abcdefghijklmnopqrstuv')).toBe('[redacted]');
    expect(redactSensitiveText('xoxb-abcdefghijklmnop-qrst')).toBe('[redacted]');
    expect(redactSensitiveText('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      .toBe('[redacted]');
  });

  it('leaves ordinary prose and look-alike short strings untouched', () => {
    const text = 'The sk-tool renamed file ghp.md; see https://example.test/docs?page=3';
    expect(redactSensitiveText(text)).toBe(text);
  });
});

describe('redactSensitiveObject', () => {
  it('redacts by key name at any nesting level and inside arrays', () => {
    expect(redactSensitiveObject({
      apiKey: 'super-secret',
      nested: { auth_token: 'also-secret', note: 'keep me' },
      list: [{ password: 'hunter2' }, 'plain'],
    })).toEqual({
      apiKey: '[redacted]',
      nested: { auth_token: '[redacted]', note: 'keep me' },
      list: [{ password: '[redacted]' }, 'plain'],
    });
  });

  it('redacts string values by pattern even under innocent keys', () => {
    expect(redactSensitiveObject({ command: 'curl -H "Authorization: Bearer sk-live-secret-12345678"' }))
      .toEqual({ command: 'curl -H "Authorization: Bearer [redacted]"' });
  });

  it('caps recursion depth and breaks circular references instead of throwing', () => {
    type Deep = { child?: Deep; level: number };
    const deep: Deep = { level: 0 };
    let cursor = deep;
    for (let level = 1; level <= 10; level += 1) {
      cursor.child = { level };
      cursor = cursor.child;
    }
    const redactedDeep = redactSensitiveObject(deep);
    expect(JSON.stringify(redactedDeep)).toContain('"[max-depth]"');

    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;
    expect(redactSensitiveObject(circular)).toEqual({ name: 'loop', self: '[circular]' });
  });

  it('passes through primitives and null unchanged', () => {
    expect(redactSensitiveObject(42)).toBe(42);
    expect(redactSensitiveObject(null)).toBeNull();
    expect(redactSensitiveObject(true)).toBe(true);
  });
});
