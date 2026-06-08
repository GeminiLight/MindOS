import { describe, expect, it } from 'vitest';
import {
  buildLoginRedirectTarget,
  resolveLoginMode,
  sanitizeLoginRedirect,
  WEB_SESSION_COOKIE_NAME,
  WEB_SESSION_MAX_AGE_SECONDS,
} from '@/lib/auth-session';

describe('auth-session helpers', () => {
  it('keeps the Web session cookie contract stable', () => {
    expect(WEB_SESSION_COOKIE_NAME).toBe('mindos-session');
    expect(WEB_SESSION_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 7);
  });

  it('sanitizes login redirects to same-origin relative paths', () => {
    expect(sanitizeLoginRedirect('/agents?tab=mcp')).toBe('/agents?tab=mcp');
    expect(sanitizeLoginRedirect('/view/Notes/hello.md')).toBe('/view/Notes/hello.md');
    expect(sanitizeLoginRedirect('//evil.example/path')).toBe('/');
    expect(sanitizeLoginRedirect('https://evil.example/path')).toBe('/');
    expect(sanitizeLoginRedirect(null)).toBe('/');
  });

  it('builds redirect targets without dropping the query string', () => {
    expect(buildLoginRedirectTarget('/agents', '?tab=mcp')).toBe('/agents?tab=mcp');
    expect(buildLoginRedirectTarget('/agents', 'tab=mcp')).toBe('/agents?tab=mcp');
    expect(buildLoginRedirectTarget('/')).toBeNull();
    expect(buildLoginRedirectTarget('/', '?welcome=1')).toBe('/?welcome=1');
  });

  it('uses re-auth mode for expired or previously authenticated browsers', () => {
    expect(resolveLoginMode('expired', false)).toBe('reauth');
    expect(resolveLoginMode(null, true)).toBe('reauth');
    expect(resolveLoginMode(null, false)).toBe('login');
  });
});
