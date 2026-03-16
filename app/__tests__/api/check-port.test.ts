import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';

async function importRoute() {
  return await import('../../app/api/setup/check-port/route');
}

function makeReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/setup/check-port', {
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
