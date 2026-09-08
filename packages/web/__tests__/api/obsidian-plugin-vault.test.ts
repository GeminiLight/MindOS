import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { seedFile, testMindRoot } from '../setup';
import { readPluginPackageSnapshot } from '@geminilight/mindos/server';
import { GET } from '@/app/api/obsidian-plugins/vault/route';
vi.mock('@/lib/settings', () => ({ readSettings: () => ({ mindRoot: testMindRoot }) }));
function subject() {
  seedFile('.mindos/plugins/example/manifest.json', JSON.stringify({ id: 'example' }));
  seedFile('.mindos/plugins/example/main.js', 'original');
  const { fingerprint, vaultId } = readPluginPackageSnapshot(testMindRoot, '.mindos/plugins/example');
  return { pluginId: 'example', fingerprint, vaultId };
}
const get = (query: Record<string, string>) => GET(new NextRequest(`http://localhost/api/obsidian-plugins/vault?${new URLSearchParams(query)}`));
describe('approved plugin Vault reader route', () => {
  it('returns a no-store snapshot without private files or machine paths', async () => {
    const binding = subject(); seedFile('Notes/中文.md', 'hello'); seedFile('.env', 'private-token');
    const response = await get(binding); const data = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
    expect(data.files.map((file: { path: string }) => file.path)).toContain('Notes/中文.md');
    expect(JSON.stringify(data)).not.toContain(testMindRoot); expect(JSON.stringify(data)).not.toContain('private-token');
  });
  it('requires both immutable approval identifiers', async () => {
    expect((await get({ pluginId: 'example' })).status).toBe(400);
    expect((await get({ ...subject(), pluginId: '../example' })).status).toBe(400);
  });
  it('refuses a changed plugin or knowledge root with a safe conflict response', async () => {
    const binding = subject(); seedFile('.mindos/plugins/example/main.js', 'changed');
    const response = await get(binding); expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'approval_subject_changed' });
  });
  it('does not disclose filesystem details for a missing package', async () => {
    const response = await get({ ...subject(), pluginId: 'missing' }); expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain(testMindRoot);
  });
});
