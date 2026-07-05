import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRuntimeManifest, writeRuntimeManifest } from '../scripts/runtime-manifest.mjs';

const root = resolve(__dirname, '..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf-8');
}

describe('runtime artifact manifest contract', () => {
  it('creates a shared manifest schema for platform packages, archives, and desktop bundles', () => {
    const productPkg = { name: '@geminilight/mindos', version: '1.2.3' };

    expect(createRuntimeManifest({
      productPkg,
      packageName: '@geminilight/mindos-darwin-arm64',
      platform: 'darwin-arm64',
      os: 'darwin',
      cpu: 'arm64',
      layout: 'platform',
    })).toMatchObject({
      schemaVersion: 1,
      product: productPkg,
      package: {
        name: '@geminilight/mindos-darwin-arm64',
        platform: 'darwin-arm64',
        os: 'darwin',
        cpu: 'arm64',
        layout: 'platform',
      },
      entrypoints: {
        cli: 'bin/cli.js',
        web: 'static-web/index.html',
        mcp: 'dist/protocols/mcp-server/index.cjs',
      },
      health: { route: '/api/health' },
    });

    expect(createRuntimeManifest({
      productPkg,
      packageName: '@geminilight/mindos-runtime',
      platform: 'runtime-archive',
      layout: 'runtime-archive',
    }).entrypoints.web).toBe('packages/web/.next/standalone/server.js');

    expect(createRuntimeManifest({
      productPkg,
      packageName: '@geminilight/mindos-desktop-runtime',
      platform: 'darwin-arm64',
      layout: 'desktop-bundled',
    }).artifacts).toContain('node/');
  });

  it('writes runtime-manifest.json at the runtime root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mindos-runtime-manifest-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@geminilight/mindos', version: '1.2.3' }));

    writeRuntimeManifest(dir, {
      productPkg: { name: '@geminilight/mindos', version: '1.2.3' },
      platform: 'test-platform',
      layout: 'runtime-archive',
    });

    const manifest = JSON.parse(readFileSync(join(dir, 'runtime-manifest.json'), 'utf-8'));
    expect(manifest.product.version).toBe('1.2.3');
    expect(manifest.package.layout).toBe('runtime-archive');
  });

  it('keeps every runtime packaging path on the shared manifest writer', () => {
    expect(read('scripts/build-platform-packages.mjs')).toContain("from './runtime-manifest.mjs'");
    expect(read('scripts/build-runtime-archive.sh')).toContain('node scripts/runtime-manifest.mjs');
    expect(read('scripts/build-runtime-archive.sh')).toContain('RUNTIME_DEPENDENCY_SEEDS');
    expect(read('scripts/build-runtime-archive.sh')).toContain('Keep runtime .ts sources');
    expect(read('scripts/build-runtime-archive.sh')).toContain('skills/mindos/SKILL.md');
    expect(read('scripts/build-runtime-archive.sh')).toContain('skills/mindos-zh/SKILL.md');
    expect(read('scripts/build-runtime-archive.sh')).toContain('packages/web/data/skills/mindos/SKILL.md');
    expect(read('scripts/build-runtime-archive.sh')).toContain('packages/web/data/skills/mindos-zh/SKILL.md');
    expect(read('scripts/build-runtime-archive.sh')).not.toContain("! -name '*.d.ts' -path '*/src/*' -delete");
    expect(read('packages/desktop/scripts/prepare-mindos-runtime.mjs')).toContain("../../../scripts/runtime-manifest.mjs");
  });
});
