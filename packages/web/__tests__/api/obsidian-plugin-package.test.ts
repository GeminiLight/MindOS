import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { seedFile, testMindRoot } from '../setup';
import { GET } from '@/app/api/obsidian-plugins/package/route';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/settings', () => ({ readSettings: () => ({ mindRoot: testMindRoot }) }));

const meta = { id: 'example', name: 'Example', version: '1.0.0' };
function install(prefix = '.mindos/plugins/example') {
  seedFile(`${prefix}/manifest.json`, JSON.stringify(meta));
  seedFile(`${prefix}/main.js`, 'throw new Error("inspection must not execute me")');
  seedFile(`${prefix}/data.json`, '{"secret":"owner-settings"}');
}
function get(fingerprint?: string, pluginId = 'example', vaultId?: string) {
  const query = new URLSearchParams({ pluginId });
  if (fingerprint !== undefined) query.set('fingerprint', fingerprint);
  if (vaultId !== undefined) query.set('vaultId', vaultId);
  return GET(new NextRequest(`http://localhost/api/obsidian-plugins/package?${query}`));
}

describe('plugin package approval subject', () => {
  it('previews the manifest and resource digests without executing or returning code/settings', async () => {
    install();
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const body = await response.json();
    expect(body.manifest).toEqual(meta);
    expect(body.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(body.assets.map((asset: { path: string }) => asset.path)).toEqual(['main.js', 'manifest.json']);
    expect(JSON.stringify(body)).not.toContain('base64');
    expect(JSON.stringify(body)).not.toContain('owner-settings');
  });

  it('returns exact captured package bytes only when the caller pins the current fingerprint', async () => {
    install();
    const { fingerprint, vaultId } = await (await get()).json();
    const response = await get(fingerprint, 'example', vaultId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Buffer.from(body.files.find((file: { path: string }) => file.path === 'main.js').base64, 'base64').toString()).toContain('inspection must not execute me');
  });

  it('refuses stale approval after a resource changes without a version bump', async () => {
    install();
    const { fingerprint, vaultId } = await (await get()).json();
    seedFile('.mindos/plugins/example/styles.css', 'body { color: red }');
    const response = await get(fingerprint, 'example', vaultId);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('package_changed');
  });

  it('supports the existing legacy install location', async () => {
    install('.plugins/example');
    expect((await get()).status).toBe(200);
  });

  it('does not fall back to a legacy package through an unsafe canonical parent', async () => {
    install('.plugins/example');
    mkdirSync(join(testMindRoot, '.mindos'), { recursive: true });
    mkdirSync(join(testMindRoot, 'unrelated'), { recursive: true });
    symlinkSync(join(testMindRoot, 'unrelated'), join(testMindRoot, '.mindos/plugins'));
    expect((await get()).status).toBe(400);
  });

  it('rejects a manifest with a different plugin identity', async () => {
    install();
    seedFile('.mindos/plugins/example/manifest.json', JSON.stringify({ ...meta, id: 'someone-else' }));
    expect((await get()).status).toBe(400);
  });

  it.each(['../example', '', 'C:/outside'])('rejects invalid plugin identifiers: %s', async id => {
    expect((await get(undefined, id)).status).toBe(400);
  });

  it('does not accept malformed fingerprints or missing packages', async () => {
    install();
    expect((await get('bad')).status).toBe(400);
    expect((await get(undefined, 'missing')).status).toBe(404);
  });

  it('requires the reviewed knowledge root when retrieving approved bytes', async () => {
    install();
    const { fingerprint } = await (await get()).json();
    expect((await get(fingerprint)).status).toBe(400);
    const wrongRoot = await get(fingerprint, 'example', '0'.repeat(64));
    expect(wrongRoot.status).toBe(409);
    expect((await wrongRoot.json()).error).toBe('vault_changed');
  });
});
