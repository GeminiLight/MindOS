import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/setup-state', () => ({
  readSetupPending: vi.fn(() => false),
}));

import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { readSetupPending } from '@/lib/setup-state';
import { defaultEchoPath } from '@/lib/echo-segments';

function makeRequest(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

describe('proxy entry redirects (/ and /echo)', () => {
  const originalPassword = process.env.WEB_PASSWORD;
  const originalToken = process.env.AUTH_TOKEN;

  beforeEach(() => {
    vi.mocked(readSetupPending).mockClear();
    vi.mocked(readSetupPending).mockReturnValue(false);
    delete process.env.WEB_PASSWORD;
    delete process.env.AUTH_TOKEN;
  });

  afterEach(() => {
    if (originalPassword === undefined) delete process.env.WEB_PASSWORD;
    else process.env.WEB_PASSWORD = originalPassword;
    if (originalToken === undefined) delete process.env.AUTH_TOKEN;
    else process.env.AUTH_TOKEN = originalToken;
  });

  it('serves / as the home page (no redirect) when setup is complete', async () => {
    const res = await proxy(makeRequest('/'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects /echo to the default echo segment with a real 307 (no streamed shell)', async () => {
    const res = await proxy(makeRequest('/echo'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location') ?? '', 'http://localhost').pathname).toBe(defaultEchoPath());
  });

  it('redirects / to /setup while setup is pending', async () => {
    vi.mocked(readSetupPending).mockReturnValue(true);
    const res = await proxy(makeRequest('/'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location') ?? '', 'http://localhost').pathname).toBe('/setup');
  });

  it('redirects /echo to /setup while setup is pending', async () => {
    vi.mocked(readSetupPending).mockReturnValue(true);
    const res = await proxy(makeRequest('/echo'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location') ?? '', 'http://localhost').pathname).toBe('/setup');
  });

  it('does not redirect echo segment pages (no loop)', async () => {
    const res = await proxy(makeRequest(defaultEchoPath()));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('does not consult setup state for non-entry paths', async () => {
    await proxy(makeRequest('/settings'));
    expect(readSetupPending).not.toHaveBeenCalled();
  });

  it('still protects the home page behind the login wall', async () => {
    process.env.WEB_PASSWORD = 'pw';
    const res = await proxy(makeRequest('/'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location') ?? '', 'http://localhost').pathname).toBe('/login');
  });
});
