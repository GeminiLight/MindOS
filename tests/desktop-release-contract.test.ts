import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

function readText(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf-8');
}

describe('Desktop release packaging contract', () => {
  it('keeps Linux deb package metadata free of scoped npm package names', () => {
    const config = readText('packages/desktop/electron-builder.yml');

    expect(config).toMatch(/^deb:\n  packageName: mindos-desktop\n  artifactName: mindos-desktop_\$\{version\}_\$\{arch\}\.\$\{ext\}$/m);
    expect(config).not.toContain('@mindos/desktop_${version}_${arch}.${ext}');
  });

  it('builds Windows ARM64 installers with a distinct updater channel and artifact name', () => {
    const workflow = readText('.github/workflows/build-desktop.yml');
    const updater = readText('packages/desktop/src/updater.ts');
    const runtimePrep = readText('packages/desktop/scripts/prepare-mindos-runtime.mjs');

    expect(workflow).toContain('platform: win\n            arch: arm64');
    expect(workflow).toContain('publish_channel: latest-arm64');
    expect(workflow).toContain('--config.publish.channel="${{ matrix.publish_channel }}"');
    expect(workflow).toContain('MindOS-Setup-${VERSION}-arm64.\\${ext}');
    expect(workflow).toContain('packages/desktop/dist/*.blockmap');
    expect(updater).toContain("autoUpdater.channel = 'latest-arm64'");
    expect(runtimePrep).toContain('targetNodePlatform');
    expect(runtimePrep).toContain('targetNodeArch');
    expect(runtimePrep).toContain('platform: `${targetNodePlatform}-${targetNodeArch}`');
  });

  it('keeps Electron main and preload builds externalized for Node runtime modules', () => {
    const config = readText('packages/desktop/electron.vite.config.ts');

    expect(config).toContain('externalizeDepsPlugin');
    expect(config).toContain('nodeBuiltins');
    expect(config).toContain("include: ['electron']");
    expect(config).toContain('plugins: [externalizeDepsPlugin');
    expect(config).toContain('external: electronMainExternal');
  });

  it('smokes packaged Desktop runtime before release artifacts are uploaded', () => {
    const workflow = readText('.github/workflows/build-desktop.yml');
    const verifier = readText('scripts/verify-desktop-runtime.mjs');
    const smoke = readText('scripts/smoke-desktop-app.mjs');

    expect(workflow).toContain('node scripts/verify-desktop-runtime.mjs');
    expect(workflow).toContain('node scripts/smoke-desktop-app.mjs --skip-if-arch-mismatch --timeout 90000');
    expect(workflow.indexOf('Smoke packaged app')).toBeGreaterThan(workflow.indexOf('Package (${{ matrix.platform }})'));
    expect(workflow.indexOf('Upload artifacts')).toBeGreaterThan(workflow.indexOf('Smoke packaged app'));

    expect(verifier).toContain('packages/web/.next/standalone/node_modules/@sinclair/typebox/package.json');
    expect(verifier).toContain('optional local embedding runtime should not be bundled by default');
    expect(verifier).toContain('@huggingface/transformers/package.json');
    expect(verifier).toContain('dist/protocols/mcp-server/index.cjs');
    expect(verifier).toContain('ERR_MODULE_NOT_FOUND');
    expect(verifier).toContain('Cannot find module');
    expect(verifier).toContain('path.join is not a function');

    expect(smoke).toContain('/api/health');
    expect(smoke).toContain('root/login did not return the MindOS HTML shell');
    expect(smoke).toContain('MCP bundle not found');
    expect(smoke).toContain('Cannot find module');
    expect(smoke).toContain('Internal Error');
  });
});
