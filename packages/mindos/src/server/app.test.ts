import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultMindosHttpServices, createMindosHttpServer } from './http.js';
import { createMindosApp, handleMindosRequest } from './app.js';
import type { MindosHttpServices } from './services.js';
import type { MindosRuntimeSettings } from './runtime.js';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

function makeRoot(prefix = 'mindos-app-'): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function makeServices(
  root: string,
  settings: Partial<MindosRuntimeSettings> = {},
  extra: Partial<MindosHttpServices> & { staticRoot?: string } = {},
): MindosHttpServices {
  const services = createDefaultMindosHttpServices({
    homeDir: root,
    staticRoot: extra.staticRoot,
    readSettings: () => ({ mindRoot: root, ...settings }),
  });
  cleanups.push(() => services.dispose?.());
  return { ...services, ...extra };
}

async function startServer(services: MindosHttpServices) {
  const app = createMindosHttpServer({ hostname: '127.0.0.1', port: 0, services });
  await app.listen();
  cleanups.push(() => app.close());
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP server address');
  return { app, base: `http://127.0.0.1:${address.port}` };
}

describe('Hono Product Server app: auth matrix', () => {
  it('serves public routes and rejects protected routes without a bearer when a token is set', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'note.md'), 'hello');
    const { base } = await startServer(makeServices(root, { authToken: 'secret-token' }));

    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    expect((await fetch(`${base}/api/connect`)).status).toBe(200);
    expect((await fetch(`${base}/api/files`)).status).toBe(401);
    expect(await (await fetch(`${base}/api/files`)).json()).toEqual({ error: 'Unauthorized' });
    expect((await fetch(`${base}/api/files`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await fetch(`${base}/api/files`, { headers: { authorization: 'Bearer secret-token' } })).status).toBe(200);
    expect((await fetch(`${base}/api/files`, { headers: { authorization: 'bearer secret-token' } })).status).toBe(200);
  });

  it('lets same-origin browser requests through only while no Web password exists', async () => {
    const root = makeRoot();
    const open = await startServer(makeServices(root, { authToken: 'secret-token' }));
    expect((await fetch(`${open.base}/api/files`, { headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(200);
    expect((await fetch(`${open.base}/api/files`, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(401);

    const locked = await startServer(makeServices(root, { authToken: 'secret-token', webPassword: 'web-secret' }));
    expect((await fetch(`${locked.base}/api/files`, { headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(401);
    expect((await fetch(`${locked.base}/api/files`, { headers: { authorization: 'Bearer secret-token' } })).status).toBe(200);
  });

  it('fails closed when a Web password exists without any auth token', async () => {
    const root = makeRoot();
    const { base } = await startServer(makeServices(root, { webPassword: 'web-secret' }));

    expect((await fetch(`${base}/api/files`)).status).toBe(401);
    expect((await fetch(`${base}/api/files`, { headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(401);
    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, authRequired: true });
  });

  it('serves everything without a token or password (local single-user mode)', async () => {
    const root = makeRoot();
    const { base } = await startServer(makeServices(root));
    expect((await fetch(`${base}/api/files`)).status).toBe(200);
    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ ok: true, authRequired: false });
  });

  it('keeps unmatched codex thread sub-paths behind auth', async () => {
    const root = makeRoot();
    const { base } = await startServer(makeServices(root, { authToken: 'secret-token' }));
    const url = `${base}/api/agent-runtimes/codex/threads/thr-1/delete`;
    expect((await fetch(url, { method: 'POST' })).status).toBe(401);
    expect((await fetch(url, { method: 'POST', headers: { authorization: 'Bearer secret-token' } })).status).toBe(404);
  });

  describe('same-origin exemption is scoped to the local machine', () => {
    // The Node listener hands Hono `{ incoming, outgoing }` as the env; this
    // mirrors that shape with a controllable socket address.
    const envFrom = (remoteAddress: string | undefined) => ({ incoming: { socket: { remoteAddress } } });
    const sameOrigin = (host: string, extra: Record<string, string> = {}) => new Request(`http://${host}/api/files`, {
      headers: { 'sec-fetch-site': 'same-origin', host, ...extra },
    });

    it('rejects a LAN browser that loaded the UI through the LAN address', async () => {
      const root = makeRoot();
      writeFileSync(join(root, 'note.md'), 'hello');
      const app = createMindosApp({ services: makeServices(root, { authToken: 'secret-token' }) });

      const lan = await app.fetch(sameOrigin('192.168.1.5:3456'), envFrom('192.168.1.20'));
      expect(lan.status).toBe(401);
      expect(await lan.json()).toEqual({ error: 'Unauthorized' });

      const loopback = await app.fetch(sameOrigin('192.168.1.5:3456'), envFrom('127.0.0.1'));
      expect(loopback.status).toBe(200);
      const mapped = await app.fetch(sameOrigin('127.0.0.1:3456'), envFrom('::ffff:127.0.0.1'));
      expect(mapped.status).toBe(200);
    });

    it('falls back to the Host header when the socket address is bridged or unknown', async () => {
      const root = makeRoot();
      const app = createMindosApp({ services: makeServices(root, { authToken: 'secret-token' }) });
      expect((await app.fetch(sameOrigin('localhost:3456'), envFrom('172.17.0.1'))).status).toBe(200);
      expect((await app.fetch(sameOrigin('[::1]:3456'))).status).toBe(200);
      expect((await app.fetch(sameOrigin('192.168.1.5:3456'))).status).toBe(401);
      expect((await app.fetch(sameOrigin('localhost.evil.com:3456'), envFrom('192.168.1.20'))).status).toBe(401);
    });

    it('rejects a remote client reported by a reverse proxy but keeps a loopback-reported one', async () => {
      const root = makeRoot();
      const app = createMindosApp({ services: makeServices(root, { authToken: 'secret-token' }) });
      const proxied = await app.fetch(sameOrigin('localhost:3456', { 'x-forwarded-for': '203.0.113.9' }), envFrom('127.0.0.1'));
      expect(proxied.status).toBe(401);
      const localThroughProxy = await app.fetch(sameOrigin('localhost:3456', { 'x-forwarded-for': '::ffff:127.0.0.1' }), envFrom('127.0.0.1'));
      expect(localThroughProxy.status).toBe(200);
      const bearer = await app.fetch(new Request('http://localhost:3456/api/files', {
        headers: { authorization: 'Bearer secret-token', 'x-forwarded-for': '203.0.113.9' },
      }), envFrom('127.0.0.1'));
      expect(bearer.status).toBe(200);
    });

    it('applies the same rule to guarded unmatched paths', async () => {
      const root = makeRoot();
      const app = createMindosApp({ services: makeServices(root, { authToken: 'secret-token' }) });
      const url = 'http://192.168.1.5:3456/api/agent-runtimes/codex/threads/thr-1/delete';
      const lan = await app.fetch(new Request(url, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin', host: '192.168.1.5:3456' } }), envFrom('192.168.1.20'));
      expect(lan.status).toBe(401);
      const local = await app.fetch(new Request(url, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin', host: '192.168.1.5:3456' } }), envFrom('127.0.0.1'));
      expect(local.status).toBe(404);
    });
  });
});

describe('Hono Product Server app: response conversion', () => {
  it('answers 304 to a matching If-None-Match and strips the content type', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), '# a');
    const { base } = await startServer(makeServices(root));

    const first = await fetch(`${base}/api/files`);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toContain('application/json');
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^"[a-f0-9]{40}"$/);

    const second = await fetch(`${base}/api/files`, { headers: { 'If-None-Match': etag! } });
    expect(second.status).toBe(304);
    expect(second.headers.get('content-type')).toBeNull();
    expect(second.headers.get('etag')).toBe(etag);
    expect(await second.text()).toBe('');

    const weak = await fetch(`${base}/api/files`, { headers: { 'If-None-Match': `W/${etag}, "other"` } });
    expect(weak.status).toBe(304);
    const star = await fetch(`${base}/api/files`, { headers: { 'If-None-Match': '*' } });
    expect(star.status).toBe(304);
    const stale = await fetch(`${base}/api/files`, { headers: { 'If-None-Match': '"deadbeef"' } });
    expect(stale.status).toBe(200);
  });

  it('answers OPTIONS with 204 and CORS headers before any auth check', async () => {
    const root = makeRoot();
    const { base } = await startServer(makeServices(root, { authToken: 'secret-token' }));
    const res = await fetch(`${base}/api/files`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('DELETE');
    expect(await res.text()).toBe('');
  });

  it('returns JSON 404 for unknown API routes and unsupported methods', async () => {
    const root = makeRoot();
    const { base } = await startServer(makeServices(root));
    const unknown = await fetch(`${base}/api/does-not-exist`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'Not found' });
    expect((await fetch(`${base}/api/files`, { method: 'DELETE' })).status).toBe(404);
    expect((await fetch(`${base}/api/files/`)).status).toBe(404);
  });

  it('rejects oversized and malformed JSON bodies with 413 / 400', async () => {
    const root = makeRoot();
    const { base } = await startServer(makeServices(root));
    const invalid = await fetch(`${base}/api/setup/generate-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad json',
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'Invalid JSON body' });

    const oversized = await fetch(`${base}/api/setup/generate-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 'x'.repeat(1_000_001) }),
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: 'Request body too large' });

    // The a2a JSON-RPC route has a tighter 100 KB budget.
    const a2a = await fetch(`${base}/api/a2a`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'x', params: { blob: 'y'.repeat(120_000) } }),
    });
    expect(a2a.status).toBe(413);

    // Empty bodies still reach the handler as {}.
    const empty = await fetch(`${base}/api/setup/generate-token`, { method: 'POST' });
    expect(empty.status).toBe(200);
  });

  it('serves the static Web artifact for non-API GETs and refuses it behind a Web password', async () => {
    const root = makeRoot();
    const staticRoot = join(root, 'static-web');
    mkdirSync(staticRoot, { recursive: true });
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>MindOS</title>');
    writeFileSync(join(staticRoot, 'app.js'), 'console.log(1)');

    const open = await startServer(makeServices(root, {}, { staticRoot }));
    const index = await fetch(`${open.base}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');
    expect(await index.text()).toContain('MindOS');
    const asset = await fetch(`${open.base}/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    // SPA fallback: unknown page paths get index.html, unknown API paths stay JSON 404.
    expect((await fetch(`${open.base}/notes/anything`)).status).toBe(200);
    expect((await fetch(`${open.base}/api/nope`)).status).toBe(404);

    const locked = await startServer(makeServices(root, { webPassword: 'web-secret' }, { staticRoot }));
    const refused = await fetch(`${locked.base}/`);
    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({ error: expect.stringContaining('Next.js host auth adapter') });
  });

  it('returns 404 for non-API GETs when no static root is configured', async () => {
    const root = makeRoot();
    const { base } = await startServer(makeServices(root));
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('marks the tree cache dirty after mutating requests only', async () => {
    const root = makeRoot();
    const invalidateTreeCache = vi.fn();
    const { base } = await startServer(makeServices(root, {}, { invalidateTreeCache }));

    await fetch(`${base}/api/files`);
    await fetch(`${base}/api/files`, { method: 'OPTIONS' });
    expect(invalidateTreeCache).not.toHaveBeenCalled();

    await fetch(`${base}/api/setup/generate-token`, { method: 'POST', body: '{}' });
    expect(invalidateTreeCache).toHaveBeenCalledTimes(1);
  });
});

describe('Hono Product Server app: SSE', () => {
  it('keeps serving after an agent turn stream throws mid-flight', async () => {
    const root = makeRoot();
    const { base } = await startServer(makeServices(root, {}, {
      agentTurnStream: async function* () {
        yield { type: 'status', message: 'starting' };
        throw new Error('provider exploded mid-stream');
      },
    }));

    const res = await fetch(`${base}/api/agent/sessions/sse-throw/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const text = await res.text();
    expect(text).toContain('data:{"type":"status","message":"starting"}');
    expect(text).toContain('"type":"error"');
    expect(text).toContain('provider exploded mid-stream');

    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ ok: true });
  });

  it('stops pulling the generator when the client disconnects', async () => {
    const root = makeRoot();
    let finalized = false;
    let produced = 0;
    const { base } = await startServer(makeServices(root, {}, {
      agentTurnStream: async function* () {
        try {
          while (true) {
            produced += 1;
            yield { type: 'status', message: `tick ${produced}` };
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
        } finally {
          finalized = true;
        }
      },
    }));

    const controller = new AbortController();
    const res = await fetch(`${base}/api/agent/sessions/sse-abort/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read();
    controller.abort();

    await vi.waitFor(() => expect(finalized).toBe(true), { timeout: 2_000 });
    const countAtStop = produced;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(produced).toBe(countAtStop);
    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ ok: true });
  });

  it('returns a JSON error instead of a stream for an invalid turn body', async () => {
    const root = makeRoot();
    const { base } = await startServer(makeServices(root));
    const res = await fetch(`${base}/api/agent/sessions/x/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(['not', 'an', 'object']),
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Invalid agent session turn request body' });
  });
});

describe('handleMindosRequest (host-embedded mode)', () => {
  it('serves the shared table for a Web-standard Request without the bearer gate', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), '# a');
    const services = makeServices(root, { authToken: 'secret-token' });

    const files = await handleMindosRequest(new Request('http://localhost/api/files'), services, { auth: 'host' });
    expect(files.status).toBe(200);
    expect(await files.json()).toEqual(['a.md']);

    const gated = await handleMindosRequest(new Request('http://localhost/api/files'), services);
    expect(gated.status).toBe(401);

    const missing = await handleMindosRequest(new Request('http://localhost/api/nope'), services, { auth: 'host' });
    expect(missing.status).toBe(404);
    // Host mode never serves the static artifact; the host owns pages.
    const page = await handleMindosRequest(new Request('http://localhost/'), services, { auth: 'host' });
    expect(page.status).toBe(404);
  });

  it('reuses one app per services object', async () => {
    const root = makeRoot();
    const services = makeServices(root);
    const first = await handleMindosRequest(new Request('http://localhost/api/health'), services, { auth: 'host' });
    const second = await handleMindosRequest(new Request('http://localhost/api/health'), services, { auth: 'host' });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });
});
