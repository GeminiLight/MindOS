import { describe, expect, it } from 'vitest';
import {
  formatForcedLoopbackWarning,
  isAuthorizedBearer,
  isLoopbackHost,
  parseBearerToken,
  resolveMcpBindHost,
} from './http-security.js';

describe('resolveMcpBindHost', () => {
  it('binds to loopback when no auth token is configured and no host is requested', () => {
    expect(resolveMcpBindHost(undefined, undefined)).toEqual({ host: '127.0.0.1', forcedLoopback: false });
    expect(resolveMcpBindHost('', '')).toEqual({ host: '127.0.0.1', forcedLoopback: false });
    expect(resolveMcpBindHost('   ', null)).toEqual({ host: '127.0.0.1', forcedLoopback: false });
  });

  it('forces an explicitly requested LAN host back to loopback when unauthenticated', () => {
    expect(resolveMcpBindHost('0.0.0.0', undefined)).toEqual({
      host: '127.0.0.1',
      forcedLoopback: true,
      requestedHost: '0.0.0.0',
    });
    expect(resolveMcpBindHost('192.168.1.20', '')).toMatchObject({ host: '127.0.0.1', forcedLoopback: true });
    expect(resolveMcpBindHost('::', '')).toMatchObject({ host: '127.0.0.1', forcedLoopback: true });
  });

  it('keeps an explicitly requested loopback host when unauthenticated', () => {
    expect(resolveMcpBindHost('localhost', undefined)).toEqual({
      host: 'localhost',
      forcedLoopback: false,
      requestedHost: 'localhost',
    });
    expect(resolveMcpBindHost('::1', undefined)).toMatchObject({ host: '::1', forcedLoopback: false });
    expect(resolveMcpBindHost('127.0.0.2', undefined)).toMatchObject({ host: '127.0.0.2', forcedLoopback: false });
  });

  it('honours the requested host (default 0.0.0.0) once an auth token exists', () => {
    expect(resolveMcpBindHost(undefined, 'tok')).toEqual({ host: '0.0.0.0', forcedLoopback: false, requestedHost: undefined });
    expect(resolveMcpBindHost('0.0.0.0', 'tok')).toMatchObject({ host: '0.0.0.0', forcedLoopback: false });
    expect(resolveMcpBindHost('10.0.0.5', 'tok')).toMatchObject({ host: '10.0.0.5', forcedLoopback: false });
  });

  it('only produces a warning when loopback was forced', () => {
    expect(formatForcedLoopbackWarning(resolveMcpBindHost('0.0.0.0', 'tok'))).toBeNull();
    expect(formatForcedLoopbackWarning(resolveMcpBindHost(undefined, undefined))).toBeNull();
    const warning = formatForcedLoopbackWarning(resolveMcpBindHost('0.0.0.0', undefined));
    expect(warning).toContain('AUTH_TOKEN');
    expect(warning).toContain('0.0.0.0');
    expect(warning).toContain('127.0.0.1');
  });
});

describe('isLoopbackHost', () => {
  it('recognises IPv4, IPv6 and hostname loopback forms', () => {
    for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '::1', '[::1]', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1']) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it('rejects wildcard, LAN and empty hosts', () => {
    for (const host of ['0.0.0.0', '::', '192.168.0.1', '10.0.0.1', 'mindos.local', '']) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });
});

describe('parseBearerToken', () => {
  it('extracts the token from a well-formed header (case-insensitive scheme, any whitespace)', () => {
    expect(parseBearerToken('Bearer abc')).toBe('abc');
    expect(parseBearerToken('bearer abc')).toBe('abc');
    expect(parseBearerToken('BEARER\t abc')).toBe('abc');
    expect(parseBearerToken('  Bearer abc  ')).toBe('abc');
  });

  it('returns null for missing scheme, empty token, wrong scheme or non-string input', () => {
    expect(parseBearerToken(undefined)).toBeNull();
    expect(parseBearerToken(['Bearer abc'])).toBeNull();
    expect(parseBearerToken('abc')).toBeNull();
    expect(parseBearerToken('Bearer')).toBeNull();
    expect(parseBearerToken('Bearer ')).toBeNull();
    expect(parseBearerToken('Basic abc')).toBeNull();
    expect(parseBearerToken('Bearerabc')).toBeNull();
  });
});

describe('isAuthorizedBearer', () => {
  it('accepts only the exact configured token', () => {
    expect(isAuthorizedBearer('Bearer secret-token', 'secret-token')).toBe(true);
    expect(isAuthorizedBearer('bearer secret-token', 'secret-token')).toBe(true);
  });

  it('rejects prefix, suffix, case and length mismatches', () => {
    expect(isAuthorizedBearer('Bearer secret-toke', 'secret-token')).toBe(false);
    expect(isAuthorizedBearer('Bearer secret-token1', 'secret-token')).toBe(false);
    expect(isAuthorizedBearer('Bearer SECRET-TOKEN', 'secret-token')).toBe(false);
    expect(isAuthorizedBearer('Bearer x', 'secret-token')).toBe(false);
  });

  it('never authorizes when the header is malformed or the expected token is empty', () => {
    expect(isAuthorizedBearer(undefined, 'secret-token')).toBe(false);
    expect(isAuthorizedBearer('secret-token', 'secret-token')).toBe(false);
    expect(isAuthorizedBearer('Bearer ', 'secret-token')).toBe(false);
    expect(isAuthorizedBearer('Bearer ', '')).toBe(false);
    expect(isAuthorizedBearer('Bearer x', '')).toBe(false);
    expect(isAuthorizedBearer('Bearer x', undefined)).toBe(false);
  });

  it('handles multi-byte tokens by byte length, not code-point length', () => {
    expect(isAuthorizedBearer('Bearer 密钥', '密钥')).toBe(true);
    expect(isAuthorizedBearer('Bearer 密钥x', '密钥')).toBe(false);
    expect(isAuthorizedBearer('Bearer abcdef', '密钥')).toBe(false); // same byte length, different bytes
  });
});
