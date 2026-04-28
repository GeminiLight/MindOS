import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';

async function importRoute() {
  return await import('../../app/api/setup/check-port/route');
}

function makeReq(body: Record<string, unknown>, port?: number) {
  const url = port
    ? `http://localhost:${port}/api/setup/check-port`
    : 'http://localhost/api/setup/check-port';
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/setup/check-port — validation', () => {
  it('rejects missing port', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it('rejects port below 1024', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq({ port: 80 }));
    expect(res.status).toBe(400);
  });

  it('rejects port above 65535', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq({ port: 70000 }));
    expect(res.status).toBe(400);
  });

  it('rejects port 0', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq({ port: 0 }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/setup/check-port — availability', () => {
  it('reports available for unused high port', async () => {
    const { POST } = await importRoute();
    // Use a random high port unlikely to be in use
    const port = 49152 + Math.floor(Math.random() * 10000);
    const res = await POST(makeReq({ port }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(true);
  });
});

describe('POST /api/setup/check-port — self-detection', () => {
  it('recognizes port from request URL as self (skips network check)', async () => {
    const { POST } = await importRoute();
    // Simulate checking port 3013 while the request itself arrives on port 3013
    const res = await POST(makeReq({ port: 3013 }, 3013));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.isSelf).toBe(true);
  });

  it('does NOT mark a different port as self', async () => {
    const { POST } = await importRoute();
    // Request arrives on 3013, but checking a random unused port
    const unusedPort = 49152 + Math.floor(Math.random() * 10000);
    const res = await POST(makeReq({ port: unusedPort }, 3013));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Should be available (unused) but NOT isSelf
    expect(body.available).toBe(true);
    expect(body.isSelf).toBe(false);
  });

  it('works for any arbitrary self port (e.g. 5555)', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeReq({ port: 5555 }, 5555));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.isSelf).toBe(true);
  });

  it('falls back to network check when no port in request URL', async () => {
    const { POST } = await importRoute();
    // No port in URL → getListeningPort returns 0 → no fast path
    // Use a random unused port, so TCP check should report available
    const unusedPort = 49152 + Math.floor(Math.random() * 10000);
    const res = await POST(makeReq({ port: unusedPort }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.isSelf).toBe(false);
  });
});
