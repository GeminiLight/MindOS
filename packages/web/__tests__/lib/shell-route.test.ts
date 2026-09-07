import { describe, expect, it } from 'vitest';
import { normalizeShellPathname, shouldLoadShellData, shouldRenderShell } from '@/lib/shell-route';

describe('shell route data boundaries', () => {
  it('normalizes pathnames from proxy headers', () => {
    expect(normalizeShellPathname(null)).toBe('/');
    expect(normalizeShellPathname('settings?tab=ai')).toBe('/settings');
    expect(normalizeShellPathname('/setup#ai')).toBe('/setup');
  });

  it('keeps auth and setup routes free of vault shell data', () => {
    expect(shouldLoadShellData('/login')).toBe(false);
    expect(shouldLoadShellData('/login?redirect=%2F')).toBe(false);
    expect(shouldLoadShellData('/setup')).toBe(false);
    expect(shouldLoadShellData('/setup/ai')).toBe(false);
    expect(shouldRenderShell('/setup')).toBe(false);
  });

  it('continues loading shell data for normal app routes', () => {
    expect(shouldLoadShellData('/')).toBe(true);
    expect(shouldLoadShellData('/settings')).toBe(true);
    expect(shouldLoadShellData('/agents')).toBe(true);
    expect(shouldLoadShellData('/view/Notes/A.md')).toBe(true);
  });
});

it('never loads vault shell data for participant routes, including unavailable invitations', () => {
  expect(shouldLoadShellData('/study/participate/study-' + 'a'.repeat(24))).toBe(false);
  expect(shouldRenderShell('/study/participate/not-found')).toBe(false);
  expect(shouldRenderShell('/study/participate-other')).toBe(true);
});
it('keeps reviewer work packets outside the owner shell', () => {
  expect(shouldRenderShell('/study/review/study-' + 'a'.repeat(24))).toBe(false);
  expect(shouldLoadShellData('/study/review/invalid')).toBe(false);
  expect(shouldLoadShellData('/study/reviewer-other')).toBe(true);
});
