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
    expect(existsSync(resolve(root, 'packages/mindos/bin/mindos-shim.cjs'))).toBe(true);

    const productPkg = readJson<{ bin?: Record<string, string> }>('packages/mindos/package.json');
    expect(productPkg.bin).toEqual({ mindos: 'bin/mindos-shim.cjs' });
  });

  it('does not use legacy unscoped pnpm filters', () => {
    const checkedFiles = [
      'package.json',
      '.github/workflows/build-desktop.yml',
      '.github/workflows/build-mobile.yml',
      '.github/workflows/build-tauri-desktop.yml',
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

  it('keeps the root clean script cross-platform', () => {
    const rootPkg = readJson<{ scripts?: Record<string, string> }>('package.json');
    const cleaner = readText('scripts/remove-node-modules.mjs');

    expect(rootPkg.scripts?.clean).toBe('turbo run clean && node scripts/remove-node-modules.mjs');
    expect(rootPkg.scripts?.clean).not.toContain('rm -rf');
    expect(cleaner).toContain('rmSync');
    expect(cleaner).not.toContain('rm -rf');
  });

  it('publishes npm from the pnpm workspace and current source paths', () => {
    const yml = workflow('publish-npm.yml');

    expect(yml).toContain('pnpm/action-setup');
    expect(yml).toContain('oven-sh/setup-bun');
    expect(yml).toContain('cache: pnpm');
    expect(yml).toContain('pnpm install --frozen-lockfile');
    expect(yml).toContain('pnpm --filter @geminilight/mindos build');
    expect(yml).not.toContain('pnpm --filter @mindos/acp build');
    expect(yml).not.toContain('pnpm --filter @mindos/mcp-server build');
    expect(yml).toContain('pnpm --filter @mindos/web run build');
    expect(yml).toContain('node scripts/build-platform-packages.mjs');
    expect(yml).toContain('Publish platform packages to npm');
    expect(yml).toContain('packages/mindos-platforms/*');
    expect(yml).toContain('packages/web/.next/cache');
    expect(yml).toContain('packages/mindos-platforms/linux-x64/bin/mindos');
    expect(yml).not.toMatch(/\bcd app\b|\bcd mcp\b|app\/package-lock\.json|mcp\/node_modules/);
  });

  it('builds runtime archives from the pnpm workspace and current source paths', () => {
    const yml = workflow('publish-runtime.yml');

    expect(yml).toContain('pnpm/action-setup');
    expect(yml).toContain('cache: pnpm');
    expect(yml).toContain('pnpm install --frozen-lockfile');
    expect(yml).toContain('pnpm --filter @geminilight/mindos build');
    expect(yml).not.toContain('pnpm --filter @mindos/mcp-server build');
    expect(yml).toContain('pnpm --filter @mindos/web run build');
    expect(yml).toContain('packages/web/.next/cache');
    expect(yml).toContain('https://releases.mindos.com/runtime/mindos-runtime-${version}.tar.gz');
    expect(yml).toContain('https://github.com/GeminiLight/MindOS/releases/download/runtime-latest/mindos-runtime-${version}.tar.gz');
    expect(yml).toContain('RUNTIME_OSS_BASE_URL');
    expect(yml.indexOf('gh release upload "$TAG" "$ARCHIVE" --clobber')).toBeLessThan(
      yml.indexOf('gh release upload "$TAG" /tmp/latest.json --clobber'),
    );
    expect(yml.indexOf('gh release upload "$TAG" /tmp/latest.json --clobber')).toBeLessThan(
      yml.indexOf('Delete old tarball assets after the new archive + manifest are live'),
    );
    expect(yml).toContain('grep -Fx "mindos-runtime-${VERSION}.tar.gz" /tmp/runtime-assets.txt');
    expect(yml).toContain('grep -Fx "latest.json" /tmp/runtime-assets.txt');
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
    expect(desktop).toContain('ref: ${{ inputs.tag != \'\' && inputs.tag || github.ref }}');
    expect(desktop).toContain('fetch-depth: 0');
    expect(desktop).toContain('Validate requested tag');
    expect(desktop).toContain('TAG_SHA="$(git rev-list -n 1 "refs/tags/${TAG}")"');
    expect(desktop).toContain('HEAD_SHA="$(git rev-parse HEAD)"');
    expect(desktop).toContain('platform: win\n            arch: arm64');
    expect(desktop).toContain('MINDOS_BUNDLE_NODE_PLATFORM: ${{ matrix.node_platform }}');
    expect(desktop).toContain('MINDOS_BUNDLE_NODE_ARCH: ${{ matrix.arch }}');
    expect(desktop).toContain('publish_channel: latest-arm64');
    expect(desktop).toContain('MindOS-Setup-${VERSION}-arm64.\\${ext}');
    expect(desktop).toContain('packages/desktop/dist/*.dmg');
    expect(desktop).toContain('packages/desktop/dist/*.blockmap');
    expect(desktop).not.toMatch(/\bcd desktop\b|\bcd app\b|\bcd mcp\b|(^|\s)desktop\/dist\//m);

    expect(sync).toContain('\\"tag\\":\\"${TAG}\\"');
    expect(sync).toContain('\\"publish\\":\\"true\\"');
    expect(sync).toContain('\\"ref\\":\\"${TAG}\\"');
    expect(sync).toContain('Failed to dispatch desktop build');
    expect(sync).toContain('exit 1');
    expect(sync).not.toContain('\\"ref\\":\\"main\\"');
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

  it('preserves co-author trailers when syncing commits to the public repo', () => {
    const sync = workflow('sync-to-mindos.yml');

    expect(sync).toContain("DEV_SUBJECT=$(git -C \"$GITHUB_WORKSPACE\" log -1 --format='%s')");
    expect(sync).toContain("DEV_MSG=$(git -C \"$GITHUB_WORKSPACE\" log -1 --format='%B')");
    expect(sync).toContain('COAUTHOR_TRAILERS=$(');
    expect(sync).toContain("grep -E '^Co-authored-by:'");
    expect(sync).toContain('git -C "$GITHUB_WORKSPACE" log --format=\'%B\' "${FIRST_PARENT}..${HEAD_SHA}"');
    expect(sync).toContain('git commit -F "$COMMIT_MSG_FILE"');
    expect(sync).toContain('git commit -m "deploy: ${DEV_SUBJECT}"');
    expect(sync).not.toContain('git commit -m "${DEV_MSG}"');
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
    const clipperPkg = readJson<{
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>('packages/browser-extension/package.json');
    const clipperReadme = readText('packages/browser-extension/README.md');
    const packageScript = readText('packages/browser-extension/scripts/package-extension.mjs');

    expect(existsSync(resolve(root, 'packages/browser-extension/package.json'))).toBe(true);
    expect(existsSync(resolve(root, 'browser-extension'))).toBe(false);
    expect(existsSync(resolve(root, 'packages/browser-extension/package-lock.json'))).toBe(false);
    expect(yml).toContain('pnpm/action-setup');
    expect(yml).toContain('cache: pnpm');
    expect(yml).toContain('pnpm install --frozen-lockfile');
    expect(yml).toContain('pnpm --filter @mindos/browser-extension run build');
    expect(yml).toContain('packages/browser-extension/extension/manifest.json');
    expect(yml).toContain('node packages/browser-extension/scripts/package-extension.mjs mindos-web-clipper-${{ steps.version.outputs.version }}.zip');
    expect(yml).toContain('packages/browser-extension/mindos-web-clipper-${{ steps.version.outputs.version }}.zip');
    expect(yml).not.toContain('zip -r');
    expect(yml).not.toMatch(/\bcd browser-extension\b|(^|[\s'"])browser-extension\/extension|(^|[\s'"])browser-extension\/src/);
    expect(npmignore).toMatch(/^packages\/browser-extension\/$/m);
    expect(npmignore).not.toMatch(/^browser-extension\/$/m);
    expect(clipperPkg.scripts?.package).toBe('pnpm run build && node scripts/package-extension.mjs');
    expect(clipperPkg.scripts?.clean).toBe('node scripts/clean-extension.mjs');
    expect(clipperPkg.scripts?.package).not.toMatch(/\bzip\b|rm -rf/);
    expect(clipperPkg.scripts?.clean).not.toMatch(/\brm -rf\b/);
    expect(clipperPkg.devDependencies).toHaveProperty('archiver');
    expect(readText('packages/browser-extension/build.mjs')).toContain('rmSync(resolve(ROOT, OUT), { recursive: true, force: true })');
    expect(packageScript).toContain('archiver');
    expect(packageScript).not.toContain('zip -r');
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
    const tauriCargo = readText('packages/desktop-tauri/src-tauri/Cargo.toml');
    const tauriMain = readText('packages/desktop-tauri/src-tauri/src/main.rs');
    const tauriRuntime = readText('packages/desktop-tauri/src-tauri/src/runtime.rs');
    const tauriShortcuts = readText('packages/desktop-tauri/src-tauri/src/shortcuts.rs');
    const tauriUpdater = readText('packages/desktop-tauri/src-tauri/src/updater.rs');

    expect(tauriPkg).toContain('"name": "@mindos/desktop-tauri"');
    expect(tauriPkg).toContain('"dev:web": "vite');
    expect(tauriPkg).toContain('"build": "vite build"');
    expect(tauriPkg).toContain('"build:web": "vite build"');
    expect(tauriPkg).toContain('"build:tauri": "tauri build"');
    expect(tauriConfig).toContain('"beforeDevCommand": "pnpm run dev:web"');
    expect(tauriConfig).toContain('"beforeBuildCommand": "pnpm run build:web"');
    expect(npmignore).toMatch(/^packages\/desktop-tauri\/$/m);
    expect(readText('.gitignore')).toMatch(/^!packages\/desktop-tauri\/src-tauri\/icons\/\*\.png$/m);
    expect(tauriCargo).toContain('alloc-no-stdlib = "=2.0.4"');
    expect(tauriCargo).toContain('alloc-stdlib = "=0.2.2"');
    expect(tauriCargo).toContain('brotli-decompressor = "=5.0.1"');
    expect(tauriMain).toContain('use tauri_plugin_deep_link::DeepLinkExt;');
    expect(tauriMain).toContain('app.deep_link().on_open_url');
    expect(tauriMain).toContain('shortcuts::register_shortcuts(app.handle())');
    expect(tauriMain).not.toContain('tauri_plugin_deep_link::register');
    expect(tauriMain).not.toContain('event.window()');
    expect(tauriRuntime).toContain('use tauri_plugin_shell::ShellExt;');
    expect(tauriShortcuts).toContain(
      'use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};',
    );
    expect(tauriUpdater).toContain('use tauri::{AppHandle, Emitter};');
    expect(tauriUpdater).not.toContain('Manager, Emitter');
  });

  it('builds the Tauri desktop spike through an isolated manual workflow', () => {
    const yml = workflow('build-tauri-desktop.yml');
    const requiredIcons = [
      '32x32.png',
      '128x128.png',
      '128x128@2x.png',
      'icon.ico',
      'icon.png',
    ];

    expect(yml).toContain('name: Build Tauri Desktop');
    expect(yml).toContain('workflow_dispatch:');
    expect(yml).toContain("'packages/desktop-tauri/**'");
    expect(yml).toContain('pnpm --filter @mindos/desktop-tauri run build:web');
    expect(yml).toContain('pnpm --filter @mindos/desktop-tauri run build:tauri');
    expect(yml).toContain('libwebkit2gtk-4.1-dev');
    expect(yml).toContain('libayatana-appindicator3-dev');
    expect(yml).toContain('packages/desktop-tauri/src-tauri/target/release/bundle/**/*');
    expect(yml).not.toContain('gh release create');
    expect(yml).not.toContain('electron-builder');

    for (const icon of requiredIcons) {
      expect(existsSync(resolve(root, `packages/desktop-tauri/src-tauri/icons/${icon}`)), icon).toBe(true);
    }
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
    expect(yml.indexOf('pnpm --filter @geminilight/mindos run build')).toBeLessThan(
      yml.indexOf('pnpm --filter @mindos/web run typecheck'),
    );
    expect(yml).toContain('pnpm --filter @mindos/web run typecheck');
    expect(yml).toContain('pnpm --filter @mindos/web exec vitest run');
    expect(yml).not.toMatch(/app\/app\/api|app\/lib|app\/__tests__|\bcd app\b|app\/package-lock\.json/);
  });
});
