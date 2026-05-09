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
});
