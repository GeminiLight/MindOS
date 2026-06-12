import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    // Mirror Next's real behavior: redirect() throws and never returns.
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('@/lib/setup-state', () => ({
  readSetupPending: vi.fn(() => false),
}));

import { redirect } from 'next/navigation';
import { readSetupPending } from '@/lib/setup-state';
import HomePage, { dynamic as homeDynamic } from '@/app/page';
import EchoIndexPage from '@/app/echo/page';
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

  it('/ issues a server redirect to the default echo page when setup is complete', () => {
    expect(() => HomePage()).toThrowError(`NEXT_REDIRECT:${defaultEchoPath()}`);
    expect(redirect).toHaveBeenCalledWith(defaultEchoPath());
  });

  it('/ issues a server redirect to /setup when setup is pending', () => {
    vi.mocked(readSetupPending).mockReturnValue(true);
    expect(() => HomePage()).toThrowError('NEXT_REDIRECT:/setup');
    expect(redirect).toHaveBeenCalledWith('/setup');
    expect(redirect).not.toHaveBeenCalledWith(defaultEchoPath());
  });

  it('/echo issues a server redirect to the default echo segment page', () => {
    expect(() => EchoIndexPage()).toThrowError(`NEXT_REDIRECT:${defaultEchoPath()}`);
    expect(redirect).toHaveBeenCalledWith(defaultEchoPath());
  });

  it('keeps / dynamic so the setup gate is evaluated per request', () => {
    expect(homeDynamic).toBe('force-dynamic');
  });
});
