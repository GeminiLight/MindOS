import { beforeEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    // Mirror Next's real behavior: redirect() throws and never returns.
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('@/lib/setup-state', () => ({
  readSetupPending: vi.fn(() => false),
}));

// Home page data deps — stubbed so HomePage() can run outside a server context.
vi.mock('@/lib/fs', () => ({
  getRecentlyModified: vi.fn(() => []),
  getMindRoot: vi.fn(() => '/tmp/mind-root'),
}));
vi.mock('@/lib/core/security', () => ({
  resolveExistingSafe: vi.fn((root: string, p: string) => `${root}/${p}`),
}));
vi.mock('@/lib/renderers/registry', () => ({
  getAllRenderers: vi.fn(() => []),
}));
vi.mock('@/lib/space-records', () => ({
  listWorkspaceSpaces: vi.fn(() => []),
}));
vi.mock('@/components/HomeContent', () => ({
  default: function HomeContentStub() { return null; },
}));
vi.mock('@/components/ClientRedirect', () => ({
  default: function ClientRedirectStub() { return null; },
}));

import { redirect } from 'next/navigation';
import { readSetupPending } from '@/lib/setup-state';
import HomePage, { dynamic as homeDynamic } from '@/app/page';
import EchoIndexPage from '@/app/echo/page';
import HomeContent from '@/components/HomeContent';
import ClientRedirect from '@/components/ClientRedirect';
import { defaultEchoPath, defaultEchoSegment } from '@/lib/echo-segments';

describe('startup redirects', () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
    vi.mocked(readSetupPending).mockReturnValue(false);
  });

  it('defaultEchoPath points at the default echo segment route', () => {
    expect(defaultEchoPath()).toBe(`/echo/${defaultEchoSegment()}`);
    expect(defaultEchoPath()).toBe('/echo/imprint');
  });

  it('/ renders the home page (no redirect to echo) when setup is complete', () => {
    const result = HomePage() as React.ReactElement;
    expect(redirect).not.toHaveBeenCalled();
    expect(result?.type).toBe(HomeContent);
  });

  it('/ falls back to a client redirect to /setup when setup is pending (proxy owns the fast path)', () => {
    vi.mocked(readSetupPending).mockReturnValue(true);
    const result = HomePage() as React.ReactElement;
    // server redirect() + rendered JSX in one page regresses App Router hook
    // order (see tests/web-page-runtime-boundary-contract.test.ts)
    expect(redirect).not.toHaveBeenCalled();
    expect(result?.type).toBe(ClientRedirect);
    expect((result?.props as { href?: string })?.href).toBe('/setup');
  });

  it('/echo issues a server redirect to the default echo segment page', () => {
    expect(() => EchoIndexPage()).toThrowError(`NEXT_REDIRECT:${defaultEchoPath()}`);
    expect(redirect).toHaveBeenCalledWith(defaultEchoPath());
  });

  it('keeps / dynamic so the setup gate is evaluated per request', () => {
    expect(homeDynamic).toBe('force-dynamic');
  });
});
