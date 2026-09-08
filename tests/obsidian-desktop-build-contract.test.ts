import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Script } from 'node:vm';
import { describe, it, expect } from 'vitest';

describe('isolated Obsidian desktop runtime artifacts', () => {
  it('bundles browser dependencies without Node require and keeps Electron only in the trusted preload', async () => {
    const { buildObsidianDesktopRuntime } = await import('../scripts/build-obsidian-desktop-runtime.mjs');
    const directory = await mkdtemp(join(tmpdir(), 'obsidian-build-test-'));
    try {
      await buildObsidianDesktopRuntime(directory);
      const cm5License = await readFile(resolve('packages/web/node_modules/codemirror5/LICENSE'), 'utf8');
      const runtime = await readFile(join(directory, 'runtime.js'), 'utf8');
      for (const line of cm5License.split('\n').map(line => line.trim()).filter(Boolean)) {
        expect(runtime.includes(line), `Missing bundled CM5 notice: ${line}`).toBe(true);
      }
      // remark-wiki-link ships a prebundle, so esbuild cannot recover its stripped notices.
      const wikiLicense = await readFile(resolve('packages/web/node_modules/remark-wiki-link/LICENSE'), 'utf8');
      for (const line of wikiLicense.split('\n').map(line => line.trim()).filter(Boolean)) {
        expect(runtime.includes(line), `Missing bundled Wiki link notice: ${line}`).toBe(true);
      }
      expect(runtime).toContain('Copyright (c) 2020 Titus Wormer <tituswormer@gmail.com>');
      const preload = await readFile(join(directory, 'preload.js'), 'utf8');
      expect(() => new Script(runtime)).not.toThrow();
      expect(() => new Script(preload)).not.toThrow();
      expect(runtime).not.toMatch(/require\(["'](?:electron|node:)/);
      expect(preload).toMatch(/require\(["']electron["']\)/);
      const manifest = JSON.parse(await readFile(resolve('packages/desktop/package.json'), 'utf8'));
      expect(manifest.scripts.build).toContain('build-obsidian-desktop-runtime.mjs');
      expect(manifest.scripts.dev).toContain('build-obsidian-desktop-runtime.mjs');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('rejects empty or relative destinations without writing artifacts', async () => {
    const { buildObsidianDesktopRuntime } = await import('../scripts/build-obsidian-desktop-runtime.mjs');
    await expect(buildObsidianDesktopRuntime('')).rejects.toThrow('absolute');
    await expect(buildObsidianDesktopRuntime('relative')).rejects.toThrow('absolute');
  });
  it('tracks the cross-app browser source and restores Electron artifacts on cache hits', async () => {
    const turbo = JSON.parse(await readFile(resolve('turbo.json'), 'utf8'));
    const task = turbo.tasks['@mindos/desktop#build'];
    expect(task?.outputs).toContain('dist-electron/**');
    expect(task?.inputs).toContain('$TURBO_DEFAULT$');
    expect(task?.inputs).toContain('$TURBO_ROOT$/scripts/build-obsidian-desktop-runtime.mjs');
    expect(task?.inputs).toContain('$TURBO_ROOT$/packages/web/lib/obsidian-compat/**');
    expect(task?.inputs).toContain('$TURBO_ROOT$/packages/web/package.json');
    expect(task?.inputs).toContain('$TURBO_ROOT$/pnpm-lock.yaml');
  });
});
