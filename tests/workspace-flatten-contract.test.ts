import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf-8');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

describe('OpenCode-style packages-only workspace layout', () => {
  it('keeps application workspaces under packages instead of apps', () => {
    const packageRoots = {
      'packages/web/package.json': '@mindos/web',
      'packages/desktop/package.json': '@mindos/desktop',
      'packages/mobile/package.json': '@mindos/mobile',
      'packages/browser-extension/package.json': '@mindos/browser-extension',
      'packages/desktop-tauri/package.json': '@mindos/desktop-tauri',
    };

    for (const [manifest, packageName] of Object.entries(packageRoots)) {
      expect(existsSync(resolve(root, manifest)), manifest).toBe(true);
      expect(readJson<{ name?: string }>(manifest).name).toBe(packageName);
    }

    for (const oldRoot of [
      'apps/web',
      'apps/desktop',
      'apps/mobile',
      'apps/browser-extension',
      'apps/cli',
      'apps/desktop-tauri',
      'packages/cli',
    ]) {
      expect(existsSync(resolve(root, oldRoot)), `${oldRoot} should not remain as a source root`).toBe(false);
    }
  });

  it('discovers workspaces from packages only', () => {
    const workspace = read('pnpm-workspace.yaml');

    expect(workspace).toContain("'packages/*'");
    expect(workspace).toContain("'packages/*/*'");
    expect(workspace).not.toContain("'apps/*'");
  });

  it('uses packages paths in runtime packaging scripts', () => {
    for (const file of [
      'scripts/prepare-standalone.mjs',
      'scripts/verify-standalone.mjs',
      'scripts/gen-renderer-index.js',
      'scripts/build-runtime-archive.sh',
      'packages/mindos/bin/lib/constants.js',
    ]) {
      const source = read(file);
      expect(source, file).toContain('packages');
      expect(source, file).not.toContain('apps/web');
      expect(source, file).not.toContain('apps/desktop');
    }
  });
});
