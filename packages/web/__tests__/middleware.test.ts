import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { proxy as middleware, isPublicApiRoute } from '@/proxy';
import { MINDOS_SERVER_ROUTES } from '@geminilight/mindos/server';
import { NextRequest } from 'next/server';
import { signJwt } from '@/lib/jwt';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resetRuntimeAuthConfigCacheForTests } from '@/lib/runtime-auth-config';

const mockReadSetupPending = vi.hoisted(() => vi.fn(() => false));

vi.mock('@/lib/setup-state', () => ({
  readSetupPending: mockReadSetupPending,
}));

// Next always carries the Host header of the incoming HTTP request and, before
// the proxy runs, fills `x-forwarded-for` from the socket peer address; mirror
// the local-browser shape here so the auth branches see realistic input.
function makeApiRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/files', {
    headers: { host: 'localhost', 'x-forwarded-for': '::ffff:127.0.0.1', ...headers },
  });
}

function makePageRequest(path = '/some-page', headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, { headers });
}

const originalHome = process.env.HOME;
let tempHome = '';

function writeConfig(config: Record<string, unknown>) {
  const dir = path.join(tempHome, '.mindos');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config), 'utf-8');
  resetRuntimeAuthConfigCacheForTests();
}

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-proxy-auth-'));
  process.env.HOME = tempHome;
  resetRuntimeAuthConfigCacheForTests();
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true });
  resetRuntimeAuthConfigCacheForTests();
});

describe('middleware — API protection (AUTH_TOKEN)', () => {
  const original = process.env.AUTH_TOKEN;
  const originalWebPassword = process.env.WEB_PASSWORD;
  const originalSessionSecret = process.env.WEB_SESSION_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_TOKEN;
    else process.env.AUTH_TOKEN = original;
    if (originalWebPassword === undefined) delete process.env.WEB_PASSWORD;
    else process.env.WEB_PASSWORD = originalWebPassword;
    if (originalSessionSecret === undefined) delete process.env.WEB_SESSION_SECRET;
    else process.env.WEB_SESSION_SECRET = originalSessionSecret;
  });

  it('allows same-origin API requests when the Web UI is not password-protected', async () => {
    process.env.AUTH_TOKEN = 'secret123';
    delete process.env.WEB_PASSWORD;
    const res = await middleware(makeApiRequest({ 'sec-fetch-site': 'same-origin' }));
    expect(res.status).toBe(200);
  });

  describe('same-origin exemption is limited to a localhost Host', () => {
    beforeEach(() => {
      process.env.AUTH_TOKEN = 'secret123';
      delete process.env.WEB_PASSWORD;
    });

    function sameOriginFrom(host: string, extra: Record<string, string> = {}) {
      return new NextRequest(`http://${host}/api/files`, {
        headers: { 'sec-fetch-site': 'same-origin', host, ...extra },
      });
    }

    it.each(['localhost:3000', 'LOCALHOST', '127.0.0.1:4567', '[::1]:3456'])('accepts Host %s', async (host) => {
      expect((await middleware(sameOriginFrom(host))).status).toBe(200);
    });

    it('rejects a LAN browser that loaded the UI over the LAN address', async () => {
      const res = await middleware(sameOriginFrom('192.168.1.5:3000'));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
      expect((await middleware(sameOriginFrom('localhost.evil.com:3000'))).status).toBe(401);
    });

    it('rejects same-origin requests whose forwarding chain names a remote client', async () => {
      expect((await middleware(sameOriginFrom('localhost:3000', { 'x-forwarded-for': '203.0.113.9' }))).status).toBe(401);
      expect((await middleware(sameOriginFrom('localhost:3000', { 'x-forwarded-for': '127.0.0.1, 203.0.113.9' }))).status).toBe(401);
      expect((await middleware(sameOriginFrom('localhost:3000', { forwarded: 'for=203.0.113.9' }))).status).toBe(401);
    });

    it('keeps a local browser whose x-forwarded-for Next filled from the loopback socket', async () => {
      expect((await middleware(sameOriginFrom('localhost:3000', { 'x-forwarded-for': '::ffff:127.0.0.1' }))).status).toBe(200);
      expect((await middleware(sameOriginFrom('localhost:3000', { 'x-forwarded-for': '::1' }))).status).toBe(200);
      // A loopback forwarded chain never allows on its own; Host still decides.
      expect((await middleware(sameOriginFrom('192.168.1.5:3000', { 'x-forwarded-for': '127.0.0.1' }))).status).toBe(401);
    });

    it('still accepts the bearer from a LAN address', async () => {
      const res = await middleware(new NextRequest('http://192.168.1.5:3000/api/files', {
        headers: { host: '192.168.1.5:3000', authorization: 'Bearer secret123' },
      }));
      expect(res.status).toBe(200);
    });
  });

  it('rejects spoofable same-origin API requests when the Web UI is password-protected', async () => {
    process.env.AUTH_TOKEN = 'secret123';
    process.env.WEB_PASSWORD = 'web-secret';

    const res = await middleware(makeApiRequest({ 'sec-fetch-site': 'same-origin' }));

    expect(res.status).toBe(401);
  });

  it('allows password-protected same-origin API requests with a valid Web session', async () => {
    process.env.AUTH_TOKEN = 'secret123';
    process.env.WEB_PASSWORD = 'web-secret';
    process.env.WEB_SESSION_SECRET = 'stable-session-secret';
    const token = await signJwt({
      sub: 'user',
      exp: Math.floor(Date.now() / 1000) + 60,
    }, 'stable-session-secret');

    const res = await middleware(makeApiRequest({
      'sec-fetch-site': 'same-origin',
      cookie: `mindos-session=${token}`,
    }));

    expect(res.status).toBe(200);
  });

  it('rejects API requests without bearer token', async () => {
    process.env.AUTH_TOKEN = 'secret123';
    const res = await middleware(makeApiRequest());
    expect(res.status).toBe(401);
  });

  it('rejects API requests with wrong bearer token', async () => {
    process.env.AUTH_TOKEN = 'secret123';
    const res = await middleware(makeApiRequest({ authorization: 'Bearer wrong' }));
    expect(res.status).toBe(401);
  });

  it('allows API requests with correct bearer token', async () => {
    process.env.AUTH_TOKEN = 'secret123';
    const res = await middleware(makeApiRequest({ authorization: 'Bearer secret123' }));
    expect(res.status).toBe(200);
  });

  it('uses the persisted auth token when AUTH_TOKEN is not set', async () => {
    delete process.env.AUTH_TOKEN;
    writeConfig({ authToken: 'persisted-token' });

    const missing = await middleware(makeApiRequest());
    const valid = await middleware(makeApiRequest({ authorization: 'Bearer persisted-token' }));

    expect(missing.status).toBe(401);
    expect(valid.status).toBe(200);
  });

  it('allows /api/health without auth (for check-port self-detection)', async () => {
    process.env.AUTH_TOKEN = 'secret123';
    const req = new NextRequest('http://localhost/api/health');
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('allows /api/auth without auth', async () => {
    process.env.AUTH_TOKEN = 'secret123';
    const req = new NextRequest('http://localhost/api/auth');
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('allows /api/connect without auth (mobile discovery)', async () => {
    process.env.AUTH_TOKEN = 'secret123';
    const res = await middleware(new NextRequest('http://localhost/api/connect'));
    expect(res.status).toBe(200);
  });

  it('allows the Feishu OAuth callback redirect without a bearer token', async () => {
    process.env.AUTH_TOKEN = 'secret123';
    delete process.env.WEB_PASSWORD;
    const res = await middleware(new NextRequest('http://localhost/api/im/feishu/oauth/callback?code=abc&state=xyz'));
    expect(res.status).toBe(200);
  });

  it('still requires auth for the OAuth start route and for non-GET hits on public GET routes', async () => {
    process.env.AUTH_TOKEN = 'secret123';
    expect((await middleware(new NextRequest('http://localhost/api/im/feishu/oauth'))).status).toBe(401);
    expect((await middleware(new NextRequest('http://localhost/api/im/feishu/oauth/callback', { method: 'POST' }))).status).toBe(401);
    expect((await middleware(new NextRequest('http://localhost/api/health', { method: 'POST' }))).status).toBe(401);
    expect((await middleware(new NextRequest('http://localhost/api/im/feishu/oauth/callback/extra'))).status).toBe(401);
  });

  it('derives the public allowlist from the core server contract', async () => {
    process.env.AUTH_TOKEN = 'secret123';
    const publicRoutes = MINDOS_SERVER_ROUTES.filter((route) => route.auth === 'public');
    expect(publicRoutes.length).toBeGreaterThanOrEqual(4);
    expect(publicRoutes.map((route) => `${route.method} ${route.path}`)).toContain('GET /api/im/feishu/oauth/callback');

    for (const route of publicRoutes) {
      const pathname = route.path.replace(/\[[^\]]+\]/g, 'x');
      expect(isPublicApiRoute(route.method, pathname), `${route.method} ${route.path}`).toBe(true);
      if (route.method === 'OPTIONS') continue;
      const res = await middleware(new NextRequest(`http://localhost${pathname}`, { method: route.method }));
      expect(res.status, `${route.method} ${route.path}`).toBe(200);
    }

    expect(isPublicApiRoute('GET', '/api/files')).toBe(false);
    expect(isPublicApiRoute('GET', '/api/healthz')).toBe(false);
    expect(isPublicApiRoute('HEAD', '/api/health')).toBe(true);
    expect(isPublicApiRoute('get', '/api/health/')).toBe(true);
    expect(isPublicApiRoute('POST', '/api/auth')).toBe(true);
  });
});

describe('middleware — API protection (WEB_PASSWORD without AUTH_TOKEN)', () => {
  const originalToken = process.env.AUTH_TOKEN;
  const originalWebPassword = process.env.WEB_PASSWORD;
  const originalSessionSecret = process.env.WEB_SESSION_SECRET;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.AUTH_TOKEN;
    else process.env.AUTH_TOKEN = originalToken;
    if (originalWebPassword === undefined) delete process.env.WEB_PASSWORD;
    else process.env.WEB_PASSWORD = originalWebPassword;
    if (originalSessionSecret === undefined) delete process.env.WEB_SESSION_SECRET;
    else process.env.WEB_SESSION_SECRET = originalSessionSecret;
  });

  it('rejects API requests without a session when only a Web password is configured', async () => {
    delete process.env.AUTH_TOKEN;
    process.env.WEB_PASSWORD = 'web-secret';

    expect((await middleware(makeApiRequest())).status).toBe(401);
    expect((await middleware(makeApiRequest({ 'sec-fetch-site': 'same-origin' }))).status).toBe(401);
    expect((await middleware(makeApiRequest({ authorization: 'Bearer anything' }))).status).toBe(401);
  });

  it('allows API requests with a valid Web session when only a Web password is configured', async () => {
    delete process.env.AUTH_TOKEN;
    process.env.WEB_PASSWORD = 'web-secret';
    process.env.WEB_SESSION_SECRET = 'stable-session-secret';
    const token = await signJwt({ sub: 'user', exp: Math.floor(Date.now() / 1000) + 60 }, 'stable-session-secret');

    const res = await middleware(makeApiRequest({ cookie: `mindos-session=${token}` }));
    expect(res.status).toBe(200);
  });

  it('rejects an expired or forged Web session when only a Web password is configured', async () => {
    delete process.env.AUTH_TOKEN;
    process.env.WEB_PASSWORD = 'web-secret';
    process.env.WEB_SESSION_SECRET = 'stable-session-secret';
    const expired = await signJwt({ sub: 'user', exp: Math.floor(Date.now() / 1000) - 60 }, 'stable-session-secret');
    const forged = await signJwt({ sub: 'user', exp: Math.floor(Date.now() / 1000) + 60 }, 'other-secret');

    expect((await middleware(makeApiRequest({ cookie: `mindos-session=${expired}` }))).status).toBe(401);
    expect((await middleware(makeApiRequest({ cookie: `mindos-session=${forged}` }))).status).toBe(401);
  });

  it('honours the persisted Web password from config when env vars are absent', async () => {
    delete process.env.AUTH_TOKEN;
    delete process.env.WEB_PASSWORD;
    writeConfig({ webPassword: 'persisted-web-secret' });

    expect((await middleware(makeApiRequest())).status).toBe(401);
  });

  it('keeps open mode when neither AUTH_TOKEN nor WEB_PASSWORD is configured', async () => {
    delete process.env.AUTH_TOKEN;
    delete process.env.WEB_PASSWORD;

    expect((await middleware(makeApiRequest())).status).toBe(200);
  });

  it('still leaves contract-public routes open when only a Web password is configured', async () => {
    delete process.env.AUTH_TOKEN;
    process.env.WEB_PASSWORD = 'web-secret';

    expect((await middleware(new NextRequest('http://localhost/api/health'))).status).toBe(200);
    expect((await middleware(new NextRequest('http://localhost/api/auth', { method: 'POST' }))).status).toBe(200);
    expect((await middleware(new NextRequest('http://localhost/api/im/feishu/oauth/callback?code=1&state=2'))).status).toBe(200);
  });
});

describe('middleware — CORS headers on /api/* routes', () => {
  const originalToken = process.env.AUTH_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.AUTH_TOKEN;
    else process.env.AUTH_TOKEN = originalToken;
  });

  it('returns 204 and echoes an allowlisted Origin for OPTIONS preflight', async () => {
    const req = new NextRequest('http://localhost/api/files', { method: 'OPTIONS', headers: { origin: 'http://localhost:3000' } });
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(res.headers.get('vary')).toContain('Origin');
  });

  it('echoes allowlisted local-network and shell origins on normal API responses', async () => {
    delete process.env.AUTH_TOKEN;
    for (const origin of ['http://127.0.0.1:4567', 'http://192.168.1.20:3456', 'http://[::1]:3456', 'capacitor://localhost', 'file://']) {
      const res = await middleware(new NextRequest('http://localhost/api/files', { headers: { origin } }));
      expect(res.headers.get('access-control-allow-origin'), origin).toBe(origin);
    }
  });

  it('never answers with a wildcard and omits CORS headers for arbitrary origins', async () => {
    delete process.env.AUTH_TOKEN;
    for (const origin of ['https://evil.example', 'http://localhost.evil.example', 'http://8.8.8.8:3456', 'null']) {
      const res = await middleware(new NextRequest('http://localhost/api/files', { headers: { origin } }));
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin'), origin).toBeNull();
      expect(res.headers.get('access-control-allow-credentials'), origin).toBeNull();
    }
    const preflight = await middleware(new NextRequest('http://localhost/api/files', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('omits CORS headers when the request has no Origin (curl, native mobile, MCP server)', async () => {
    delete process.env.AUTH_TOKEN;
    const res = await middleware(new NextRequest('http://localhost/api/files'));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('attaches CORS headers to 401 responses for allowlisted origins', async () => {
    process.env.AUTH_TOKEN = 'secret123';
    const req = new NextRequest('http://localhost/api/files', { headers: { origin: 'http://localhost:3000' } });
    const res = await middleware(req);
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });
});

describe('middleware — Web UI protection (WEB_PASSWORD)', () => {
  const original = process.env.WEB_PASSWORD;
  const originalSessionSecret = process.env.WEB_SESSION_SECRET;

  beforeEach(() => {
    mockReadSetupPending.mockReset();
    mockReadSetupPending.mockReturnValue(false);
  });

  afterEach(() => {
    if (original === undefined) delete process.env.WEB_PASSWORD;
    else process.env.WEB_PASSWORD = original;
    if (originalSessionSecret === undefined) delete process.env.WEB_SESSION_SECRET;
    else process.env.WEB_SESSION_SECRET = originalSessionSecret;
  });

  it('allows all requests when WEB_PASSWORD is not set', async () => {
    delete process.env.WEB_PASSWORD;
    const res = await middleware(makePageRequest());
    expect(res.status).toBe(200);
  });

  it('lets the root page render Home when setup is complete', async () => {
    delete process.env.WEB_PASSWORD;
    const res = await middleware(makePageRequest('/'));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects the Echo index to the default Echo segment when setup is complete', async () => {
    delete process.env.WEB_PASSWORD;
    const res = await middleware(makePageRequest('/echo'));
    const location = new URL(res.headers.get('location') ?? '');

    expect(res.status).toBe(307);
    expect(location.pathname).toBe('/echo/overview');
  });

  it('redirects the root page to setup during first-run setup', async () => {
    delete process.env.WEB_PASSWORD;
    mockReadSetupPending.mockReturnValue(true);

    const res = await middleware(makePageRequest('/'));
    const location = new URL(res.headers.get('location') ?? '');

    expect(res.status).toBe(307);
    expect(location.pathname).toBe('/setup');
  });

  it('redirects unauthenticated page requests to /login', async () => {
    process.env.WEB_PASSWORD = 'secret123';
    const res = await middleware(makePageRequest('/some-page'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('redirects unauthenticated page requests when only the persisted Web password exists', async () => {
    delete process.env.WEB_PASSWORD;
    writeConfig({ webPassword: 'persisted-secret', webSessionSecret: 'persisted-session-secret' });

    const res = await middleware(makePageRequest('/some-page'));
    const location = new URL(res.headers.get('location') ?? '');

    expect(res.status).toBe(307);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('redirect')).toBe('/some-page');
  });

  it('preserves the query string in login redirects', async () => {
    process.env.WEB_PASSWORD = 'secret123';
    const res = await middleware(makePageRequest('/agents?tab=mcp'));
    const location = new URL(res.headers.get('location') ?? '');

    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('redirect')).toBe('/agents?tab=mcp');
    expect(location.searchParams.get('reason')).toBeNull();
  });

  it('marks invalid existing session cookies as expired re-auth redirects', async () => {
    process.env.WEB_PASSWORD = 'secret123';
    const res = await middleware(makePageRequest('/view/Notes/a.md?mode=edit', {
      cookie: 'mindos-session=bad.token.value',
    }));
    const location = new URL(res.headers.get('location') ?? '');

    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('reason')).toBe('expired');
    expect(location.searchParams.get('redirect')).toBe('/view/Notes/a.md?mode=edit');
  });

  it('marks expired existing session cookies as expired re-auth redirects', async () => {
    process.env.WEB_PASSWORD = 'secret123';
    const expiredToken = await signJwt({
      sub: 'user',
      exp: Math.floor(Date.now() / 1000) - 60,
    }, 'secret123');
    const res = await middleware(makePageRequest('/wiki', {
      cookie: `mindos-session=${expiredToken}`,
    }));
    const location = new URL(res.headers.get('location') ?? '');

    expect(location.searchParams.get('reason')).toBe('expired');
    expect(location.searchParams.get('redirect')).toBe('/wiki');
  });

  it('keeps existing sessions valid when the Web UI password changes', async () => {
    process.env.WEB_PASSWORD = 'new-password';
    process.env.WEB_SESSION_SECRET = 'stable-session-secret';
    const token = await signJwt({
      sub: 'user',
      exp: Math.floor(Date.now() / 1000) + 60,
    }, 'stable-session-secret');

    const res = await middleware(makePageRequest('/wiki', {
      cookie: `mindos-session=${token}`,
    }));

    expect(res.status).toBe(200);
  });

  it('accepts sessions signed with the persisted Web session secret', async () => {
    delete process.env.WEB_PASSWORD;
    delete process.env.WEB_SESSION_SECRET;
    writeConfig({ webPassword: 'persisted-secret', webSessionSecret: 'persisted-session-secret' });
    const token = await signJwt({
      sub: 'user',
      exp: Math.floor(Date.now() / 1000) + 60,
    }, 'persisted-session-secret');

    const res = await middleware(makePageRequest('/wiki', {
      cookie: `mindos-session=${token}`,
    }));

    expect(res.status).toBe(200);
  });

  it('allows /login page without cookie', async () => {
    process.env.WEB_PASSWORD = 'secret123';
    const res = await middleware(makePageRequest('/login'));
    expect(res.status).toBe(200);
  });

  it('keeps login protection ahead of root Echo redirects', async () => {
    process.env.WEB_PASSWORD = 'secret123';
    const res = await middleware(makePageRequest('/'));
    const location = new URL(res.headers.get('location') ?? '');

    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('redirect')).toBeNull();
  });

  it('lets authenticated root page requests render Home', async () => {
    process.env.WEB_PASSWORD = 'secret123';
    const token = await signJwt({
      sub: 'user',
      exp: Math.floor(Date.now() / 1000) + 60,
    }, 'secret123');

    const res = await middleware(makePageRequest('/', {
      cookie: `mindos-session=${token}`,
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});
