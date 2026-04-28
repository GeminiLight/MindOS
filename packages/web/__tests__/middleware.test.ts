import { describe, it, expect, afterEach } from 'vitest';
import { proxy as middleware } from '@/proxy';
import { NextRequest } from 'next/server';

function makeApiRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/files', { headers });
}

function makePageRequest(path = '/some-page') {
  return new NextRequest(`http://localhost${path}`);
}

describe('middleware — API protection (AUTH_TOKEN)', () => {
  const original = process.env.AUTH_TOKEN;

  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_TOKEN;
    else process.env.AUTH_TOKEN = original;
  });

  it('allows same-origin requests', async () => {
    process.env.AUTH_TOKEN = 'secret123';
    const res = await middleware(makeApiRequest({ 'sec-fetch-site': 'same-origin' }));
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
});

describe('middleware — CORS headers on /api/* routes', () => {
  it('returns 204 with CORS headers for OPTIONS preflight', async () => {
    const req = new NextRequest('http://localhost/api/files', { method: 'OPTIONS' });
    const res = await middleware(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
  });

  it('attaches CORS headers to normal API responses', async () => {
    delete process.env.AUTH_TOKEN;
    const req = new NextRequest('http://localhost/api/files');
    const res = await middleware(req);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('attaches CORS headers to 401 responses', async () => {
    process.env.AUTH_TOKEN = 'secret123';
    const req = new NextRequest('http://localhost/api/files');
    const res = await middleware(req);
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('middleware — Web UI protection (WEB_PASSWORD)', () => {
  const original = process.env.WEB_PASSWORD;

  afterEach(() => {
    if (original === undefined) delete process.env.WEB_PASSWORD;
    else process.env.WEB_PASSWORD = original;
  });

  it('allows all requests when WEB_PASSWORD is not set', async () => {
    delete process.env.WEB_PASSWORD;
    const res = await middleware(makePageRequest());
    expect(res.status).toBe(200);
  });

  it('redirects unauthenticated page requests to /login', async () => {
    process.env.WEB_PASSWORD = 'secret123';
    const res = await middleware(makePageRequest('/some-page'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('allows /login page without cookie', async () => {
    process.env.WEB_PASSWORD = 'secret123';
    const res = await middleware(makePageRequest('/login'));
    expect(res.status).toBe(200);
  });
});
