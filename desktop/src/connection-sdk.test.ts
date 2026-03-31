/**
 * Tests for shared/connection.ts — normalizeAddress and testConnection
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeAddress, testConnection } from './connection-sdk';

describe('normalizeAddress', () => {
  // ── Normal paths ──
  it('returns full URL as-is', () => {
    expect(normalizeAddress('http://192.168.1.100:3456')).toBe('http://192.168.1.100:3456');
  });

  it('preserves https', () => {
    expect(normalizeAddress('https://example.com')).toBe('https://example.com');
  });

  it('preserves port in URL', () => {
    expect(normalizeAddress('http://localhost:3456')).toBe('http://localhost:3456');
  });

  // ── Auto-prefix http:// ──
  it('adds http:// when no protocol', () => {
    expect(normalizeAddress('192.168.1.100:3456')).toBe('http://192.168.1.100:3456');
  });

  it('adds http:// for hostname only', () => {
    expect(normalizeAddress('myserver.local')).toBe('http://myserver.local');
  });

  // ── Trailing slash removal ──
  it('removes trailing slash', () => {
    expect(normalizeAddress('http://example.com/')).toBe('http://example.com');
  });

  it('removes multiple trailing slashes', () => {
    expect(normalizeAddress('http://example.com///')).toBe('http://example.com');
  });

  // ── Trim whitespace ──
  it('trims whitespace', () => {
    expect(normalizeAddress('  http://example.com  ')).toBe('http://example.com');
  });

  // ── IPv6 ──
  it('handles IPv6 address', () => {
    expect(normalizeAddress('http://[::1]:3456')).toBe('http://[::1]:3456');
  });

  it('adds http:// for bare IPv6', () => {
    expect(normalizeAddress('[::1]:3456')).toBe('http://[::1]:3456');
  });

  // ── Edge cases ──
  it('returns empty for empty input', () => {
    expect(normalizeAddress('')).toBe('');
  });

  it('returns empty for whitespace-only input', () => {
    expect(normalizeAddress('   ')).toBe('');
  });
});

describe('testConnection', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('returns online for valid MindOS health response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        service: 'mindos',
        version: '0.5.38',
        authRequired: true,
      }),
    });

    const result = await testConnection('http://localhost:3456');
    expect(result.status).toBe('online');
    expect(result.version).toBe('0.5.38');
    expect(result.authRequired).toBe(true);
  });

  it('returns not-mindos for non-MindOS server', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok' }),
    });

    const result = await testConnection('http://localhost:3456');
    expect(result.status).toBe('not-mindos');
  });

  it('returns error for non-200 response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await testConnection('http://localhost:3456');
    expect(result.status).toBe('error');
    expect(result.error).toContain('500');
  });

  it('returns offline for network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await testConnection('http://localhost:9999');
    expect(result.status).toBe('offline');
    expect(result.error).toBe('ECONNREFUSED');
  });

  it('returns error for empty address', async () => {
    const result = await testConnection('');
    expect(result.status).toBe('error');
    expect(result.error).toBe('Empty address');
  });

  it('normalizes address before fetching', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, service: 'mindos', version: '1.0.0' }),
    });
    globalThis.fetch = mockFetch;

    await testConnection('192.168.1.100:3456');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://192.168.1.100:3456/api/health',
      expect.any(Object),
    );
  });

  it('returns online with authRequired false when no password', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        service: 'mindos',
        version: '0.5.38',
        authRequired: false,
      }),
    });

    const result = await testConnection('http://localhost:3456');
    expect(result.status).toBe('online');
    expect(result.authRequired).toBe(false);
  });
});
