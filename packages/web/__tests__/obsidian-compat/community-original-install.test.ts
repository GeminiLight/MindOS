import { afterEach, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installObsidianCommunityPlugin } from '@/lib/obsidian-compat/community-install';
import { PluginManager } from '@/lib/obsidian-compat/plugin-manager';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

for (const [name, source] of [
  ['Advanced Tables', process.env.MINDOS_OBSIDIAN_ADVANCED_TABLES_DIR],
  ['Dataview', process.env.MINDOS_OBSIDIAN_DATAVIEW_DIR],
] as const) {
  it.runIf(source)(`installs unmodified ${name} bytes for Desktop review without enabling the server runtime`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-original-install-')); roots.push(root);
    const manifest = JSON.parse(readFileSync(join(source!, 'manifest.json'), 'utf8'));
    const result = await installObsidianCommunityPlugin({
      repo: 'fixture/original-assets', pluginId: manifest.id, targetMindRoot: root, confirm: true,
      // Replay verified release bytes through the real installer, without live network access.
      fetchImpl: async input => {
        const file = new URL(String(input)).pathname.split('/').pop()!;
        if (!['manifest.json', 'main.js', 'styles.css'].includes(file) || !existsSync(join(source!, file))) return new Response('missing', { status: 404 });
        return new Response(readFileSync(join(source!, file), 'utf8'));
      },
    });
    expect(result).toMatchObject({ ok: true, installed: { enabled: false, loaded: false } });
    expect(readFileSync(join(root, '.mindos/plugins', manifest.id, 'main.js'))).toEqual(readFileSync(join(source!, 'main.js')));
    const manager = new PluginManager(root);
    expect(await manager.discover()).toEqual(expect.arrayContaining([expect.objectContaining({ id: manifest.id, enabled: false, loaded: false })]));
    await expect(manager.load(manifest.id)).rejects.toThrow(/unsupported runtime module/);
  });
}
