import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

function readText(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf-8');
}

function workflow(name: string): string {
  return readText(`.github/workflows/${name}`);
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readText(relativePath)) as T;
}

describe('GitHub workflow migration contract', () => {
  it('uses scoped internal package names for private project packages', () => {
    const expectedAppNames: Record<string, string> = {
      'packages/web/package.json': '@mindos/web',
      'packages/desktop/package.json': '@mindos/desktop',
      'packages/mobile/package.json': '@mindos/mobile',
      'packages/browser-extension/package.json': '@mindos/browser-extension',
      'packages/desktop-tauri/package.json': '@mindos/desktop-tauri',
      'examples/package.json': '@mindos/examples',
      'tests/integration/package.json': '@mindos/integration-tests',
      'demo/package.json': '@mindos/demo',
    };

    for (const [packagePath, expectedName] of Object.entries(expectedAppNames)) {
      const pkg = readJson<{ name: string; private?: boolean }>(packagePath);
      expect(pkg.name).toBe(expectedName);
      expect(pkg.private).toBe(true);
    }
  });

  it('keeps the real CLI inside the product package instead of a separate CLI workspace', () => {
    expect(existsSync(resolve(root, 'packages/cli/package.json'))).toBe(false);
    expect(existsSync(resolve(root, 'packages/mindos/bin/cli.js'))).toBe(true);

    const productPkg = readJson<{ bin?: Record<string, string> }>('packages/mindos/package.json');
    expect(productPkg.bin).toEqual({ mindos: 'bin/cli.js' });
  });

  it('does not use legacy unscoped pnpm filters', () => {
    const checkedFiles = [
      'package.json',
      '.github/workflows/build-desktop.yml',
      '.github/workflows/build-mobile.yml',
      '.github/workflows/publish-clipper.yml',
      '.github/workflows/publish-npm.yml',
      '.github/workflows/publish-runtime.yml',
      '.github/workflows/test-channel-cross-platform.yml',
      'scripts/hooks/pre-push',
      'scripts/prepare-standalone.mjs',
      'scripts/release.sh',
      'scripts/verify-standalone.mjs',
      'packages/desktop/scripts/build-linux.sh',
      'packages/desktop/scripts/build-mac.sh',
      'packages/desktop/scripts/prepare-mindos-runtime.mjs',
      'packages/desktop/README.md',
      'packages/desktop/resources/mindos-runtime/README.md',
      'AGENTS.md',
    ];

    const legacyFilterPattern =
      /pnpm --filter (wiki-app|mindos-cli|mindos-desktop|mindos-mobile|mindos-web-clipper|mindos-desktop-tauri)\b/;

    for (const checkedFile of checkedFiles) {
      expect(readText(checkedFile), checkedFile).not.toMatch(legacyFilterPattern);
    }
  });

  it('does not use npx for local workspace build tools', () => {
    const checkedFiles = [
      'packages/desktop/scripts/build-linux.sh',
      'packages/desktop/scripts/build-mac.sh',
      'packages/mobile/package.json',
      '.github/workflows/build-mobile.yml',
    ];

    for (const checkedFile of checkedFiles) {
      expect(readText(checkedFile), checkedFile).not.toMatch(/\bnpx\s+(electron-builder|eas-cli|tsx)\b/);
    }
  });

  it('publishes npm from the pnpm workspace and current source paths', () => {
    const yml = workflow('publish-npm.yml');

    expect(yml).toContain('pnpm/action-setup');
    expect(yml).toContain('cache: pnpm');
    expect(yml).toContain('pnpm install --frozen-lockfile');
    expect(yml).toContain('pnpm --filter @mindos/acp build');
    expect(yml).toContain('pnpm --filter @geminilight/mindos build');
    expect(yml).toContain('pnpm --filter @mindos/mcp-server build');
    expect(yml).toContain('pnpm --filter @mindos/web run build');
    expect(yml).toContain('packages/web/.next/cache');
    expect(yml).toContain('_standalone/__next/server/app-paths-manifest.json');
    expect(yml).not.toMatch(/\bcd app\b|\bcd mcp\b|app\/package-lock\.json|mcp\/node_modules/);
  });

  it('builds runtime archives from the pnpm workspace and current source paths', () => {
    const yml = workflow('publish-runtime.yml');

    expect(yml).toContain('pnpm/action-setup');
    expect(yml).toContain('cache: pnpm');
    expect(yml).toContain('pnpm install --frozen-lockfile');
    expect(yml).toContain('pnpm --filter @geminilight/mindos build');
    expect(yml).toContain('pnpm --filter @mindos/mcp-server build');
    expect(yml).toContain('pnpm --filter @mindos/web run build');
    expect(yml).toContain('packages/web/.next/cache');
    expect(yml).not.toMatch(/\bcd app\b|\bcd \.\.\/mcp\b|app\/package-lock\.json/);
  });

  it('builds desktop from packages/desktop and dispatches tagged releases with inputs', () => {
    const desktop = workflow('build-desktop.yml');
    const sync = workflow('sync-to-mindos.yml');

    expect(desktop).toContain('cd packages/desktop');
    expect(desktop).toContain('pnpm install --frozen-lockfile');
    expect(desktop).toContain('pnpm --filter @geminilight/mindos build');
    expect(desktop).toContain('pnpm --filter @mindos/web run build');
    expect(desktop).toContain('pnpm --filter @mindos/desktop run build');
    expect(desktop).toContain('packages/desktop/dist/*.dmg');
    expect(desktop).not.toMatch(/\bcd desktop\b|\bcd app\b|\bcd mcp\b|(^|\s)desktop\/dist\//m);

    expect(sync).toContain('\\"tag\\":\\"${TAG}\\"');
    expect(sync).toContain('\\"publish\\":\\"true\\"');
  });

  it('keeps release workflow triggers single-sourced by tag family', () => {
    const sync = workflow('sync-to-mindos.yml');
    const publishNpm = workflow('publish-npm.yml');
    const publishRuntime = workflow('publish-runtime.yml');
    const publishClipper = workflow('publish-clipper.yml');

    expect(publishNpm).toContain("tags:\n      - 'v[0-9]+.[0-9]+.[0-9]+'");
    expect(publishNpm).toContain('workflow_dispatch:');
    expect(publishRuntime).toContain("tags:\n      - 'v[0-9]+.[0-9]+.[0-9]+'");
    expect(publishClipper).toContain("tags:\n      - 'clipper-v[0-9]+.[0-9]+.[0-9]+'");

    expect(sync).toContain('build-desktop.yml/dispatches');
    expect(sync).not.toContain('publish-npm.yml/dispatches');
    expect(sync).toContain('public repo tag push will trigger publish-npm.yml and publish-runtime.yml');
  });

  it('builds mobile from packages/mobile', () => {
    const yml = workflow('build-mobile.yml');
    const mobilePkg = readJson<{
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>('packages/mobile/package.json');

    expect(yml).toContain('cache: pnpm');
    expect(yml).not.toContain('package-lock.json');
    expect(yml).toContain('pnpm install --frozen-lockfile');
    expect(yml).toContain('packages/mobile/app.json');
    expect(yml).toContain('pnpm --filter @mindos/mobile exec eas build');
    expect(yml).not.toContain('npx eas-cli');
    expect(mobilePkg.devDependencies).toHaveProperty('eas-cli');
    for (const [scriptName, script] of Object.entries(mobilePkg.scripts ?? {})) {
      expect(script, scriptName).not.toContain('npx eas-cli');
    }
    expect(yml).not.toMatch(/\bcd mobile\b|(^|\s)mobile\/app\.json|(^|\s)mobile\/package-lock\.json/m);
  });

  it('builds the browser extension from packages/browser-extension', () => {
    const yml = workflow('publish-clipper.yml');
    const npmignore = readText('.npmignore');
    const clipperPkg = readText('packages/browser-extension/package.json');
    const clipperReadme = readText('packages/browser-extension/README.md');

    expect(existsSync(resolve(root, 'packages/browser-extension/package.json'))).toBe(true);
    expect(existsSync(resolve(root, 'browser-extension'))).toBe(false);
    expect(existsSync(resolve(root, 'packages/browser-extension/package-lock.json'))).toBe(false);
    expect(yml).toContain('pnpm/action-setup');
    expect(yml).toContain('cache: pnpm');
    expect(yml).toContain('pnpm install --frozen-lockfile');
    expect(yml).toContain('pnpm --filter @mindos/browser-extension run build');
    expect(yml).toContain('packages/browser-extension/extension/manifest.json');
    expect(yml).toContain('packages/browser-extension/mindos-web-clipper-${{ steps.version.outputs.version }}.zip');
    expect(yml).not.toMatch(/\bcd browser-extension\b|(^|[\s'"])browser-extension\/extension|(^|[\s'"])browser-extension\/src/);
    expect(npmignore).toMatch(/^packages\/browser-extension\/$/m);
    expect(npmignore).not.toMatch(/^browser-extension\/$/m);
    expect(clipperPkg).toContain('"package": "pnpm run build');
    expect(clipperReadme).toContain('pnpm install');
    expect(clipperReadme).toContain('pnpm run build');
    expect(clipperReadme).not.toMatch(/\bnpm install\b|\bnpm run build\b|\bnpm run watch\b|\bnpm run package\b/);
  });

  it('keeps the Tauri desktop spike under packages/desktop-tauri', () => {
    const npmignore = readText('.npmignore');

    expect(existsSync(resolve(root, 'packages/desktop-tauri/package.json'))).toBe(true);
    expect(existsSync(resolve(root, 'desktop-tauri'))).toBe(false);
    expect(existsSync(resolve(root, 'packages/desktop-tauri/package-lock.json'))).toBe(false);
    const tauriPkg = readText('packages/desktop-tauri/package.json');
    const tauriConfig = readText('packages/desktop-tauri/src-tauri/tauri.conf.json');

    expect(tauriPkg).toContain('"name": "@mindos/desktop-tauri"');
    expect(tauriPkg).toContain('"dev:web": "vite');
    expect(tauriPkg).toContain('"build": "vite build"');
    expect(tauriPkg).toContain('"build:web": "vite build"');
    expect(tauriPkg).toContain('"build:tauri": "tauri build"');
    expect(tauriConfig).toContain('"beforeDevCommand": "pnpm run dev:web"');
    expect(tauriConfig).toContain('"beforeBuildCommand": "pnpm run build:web"');
    expect(npmignore).toMatch(/^packages\/desktop-tauri\/$/m);
  });

  it('keeps the public sync whitelist aligned with the monorepo layout', () => {
    const syncinclude = readText('.syncinclude');

    expect(syncinclude).not.toMatch(/^\s+- apps$/m);
    expect(syncinclude).toMatch(/^\s+- packages$/m);
    expect(syncinclude).not.toMatch(/^\s+- bin$/m);
    expect(syncinclude).not.toMatch(/^\s+- browser-extension$/m);
    expect(syncinclude).toMatch(/^\s+- pnpm-lock\.yaml$/m);
    expect(syncinclude).toMatch(/^\s+- pnpm-workspace\.yaml$/m);
    expect(syncinclude).toMatch(/^\s+- turbo\.json$/m);
    expect(syncinclude).not.toMatch(/^\s+- app$/m);
    expect(syncinclude).not.toMatch(/^\s+- mcp$/m);
    expect(syncinclude).not.toMatch(/^\s+- desktop$/m);
    expect(syncinclude).not.toMatch(/^\s+- mobile$/m);
    expect(syncinclude).not.toMatch(/^\s+- desktop-tauri$/m);
    expect(syncinclude).not.toMatch(/^\s+- package-lock\.json$/m);
  });

  it('keeps the channel regression workflow on active paths', () => {
    const yml = workflow('test-channel-cross-platform.yml');

    expect(yml).toContain('packages/web/app/api/channels/verify/route.ts');
    expect(yml).toContain('packages/web/lib/im/config.ts');
    expect(yml).toContain('pnpm --filter @mindos/web run typecheck');
    expect(yml).toContain('pnpm --filter @mindos/web exec vitest run');
    expect(yml).not.toMatch(/app\/app\/api|app\/lib|app\/__tests__|\bcd app\b|app\/package-lock\.json/);
  });
});
