import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultMindosHttpServices, createMindosHttpServer } from './http.js';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mindos-http-tree-cache-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

async function startServer(root: string) {
  const app = createMindosHttpServer({
    hostname: '127.0.0.1',
    port: 0,
    runtime: {
      homeDir: root,
      readSettings: () => ({ mindRoot: root }),
    },
  });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => app.close());
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP server address');
  return { app, base: `http://127.0.0.1:${address.port}` };
}

describe('standalone server tree cache wiring', () => {
  it('caches tree version between requests instead of rescanning', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    const services = createDefaultMindosHttpServices({
      homeDir: root,
      readSettings: () => ({ mindRoot: root }),
    });
    cleanups.push(() => services.dispose?.());

    const first = services.getTreeVersion();
    expect(first).toBeGreaterThan(0);
    expect(services.getTreeVersion()).toBe(first);
    expect(services.collectAllFiles()).toEqual(['a.md']);
    expect(typeof services.invalidateTreeCache).toBe('function');
  });

  it('reflects internal writes immediately because mutating requests invalidate the cache', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    const { base } = await startServer(root);

    const versionBefore = (await (await fetch(`${base}/api/tree-version`)).json()) as { v: number };
    expect((await (await fetch(`${base}/api/files?limit=10`)).json())).toMatchObject({ files: ['a.md'] });

    const write = await fetch(`${base}/api/file`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'create_file', path: 'b.md', content: 'b' }),
    });
    expect(write.status).toBe(200);

    const versionAfter = (await (await fetch(`${base}/api/tree-version`)).json()) as { v: number };
    expect(versionAfter.v).not.toBe(versionBefore.v);
    expect((await (await fetch(`${base}/api/files?limit=10`)).json())).toMatchObject({ files: ['a.md', 'b.md'] });
  });

  it('serves fresh backlinks after a write bumps the tree version', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'target.md'), '# Target');
    writeFileSync(join(root, 'source.md'), 'no links yet');
    const { base } = await startServer(root);

    expect(await (await fetch(`${base}/api/backlinks?path=target.md`)).json()).toEqual([]);

    const write = await fetch(`${base}/api/file`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'save_file', path: 'source.md', content: 'See [[target]].' }),
    });
    expect(write.status).toBe(200);

    expect(await (await fetch(`${base}/api/backlinks?path=target.md`)).json()).toEqual([
      expect.objectContaining({ filePath: 'source.md' }),
    ]);
  });

  it('disposes the internally created tree cache when the server closes', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.md'), 'a');
    const app = createMindosHttpServer({
      hostname: '127.0.0.1',
      port: 0,
      runtime: {
        homeDir: root,
        readSettings: () => ({ mindRoot: root }),
      },
    });
    await app.listen();
    await expect(app.close()).resolves.toBeUndefined();
  });
});
