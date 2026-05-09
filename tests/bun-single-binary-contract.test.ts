import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRuntimeManifest } from '../scripts/runtime-manifest.mjs';

const root = resolve(__dirname, '..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf-8');
}

describe('Bun single-binary runtime contract', () => {
  it('documents the Bun single-binary target and extraction model', () => {
    const specPath = 'wiki/specs/spec-bun-single-binary-runtime.md';
    expect(existsSync(resolve(root, specPath))).toBe(true);

    const spec = read(specPath);
    expect(spec).toContain('Bun compile');
    expect(spec).toContain('single binary');
    expect(spec).toContain('runtime.tar.gz');
    expect(spec).toContain('Next standalone');
    expect(spec).toContain('OpenCode');
  });

  it('has a Bun binary builder that embeds the runtime archive', () => {
    const scriptPath = 'scripts/build-bun-binary.mjs';
    expect(existsSync(resolve(root, scriptPath))).toBe(true);

    const script = read(scriptPath);
    expect(script).toContain('bun build');
    expect(script).toContain('--compile');
    expect(script).toContain('runtime.tar.gz');
    expect(script).toContain('with { type: "file" }');
    expect(script).toContain('MINDOS_BINARY_RUNTIME_ROOT');
    expect(script).toContain('acquireExtractLock');
    expect(script).toContain('.cjs');
  });

  it('lets the shared manifest describe Bun single-binary artifacts', () => {
    const manifest = createRuntimeManifest({
      productPkg: { name: '@geminilight/mindos', version: '1.2.3' },
      packageName: '@geminilight/mindos-darwin-arm64',
      platform: 'darwin-arm64',
      os: 'darwin',
      cpu: 'arm64',
      layout: 'bun-single-binary',
    });

    expect(manifest.package.layout).toBe('bun-single-binary');
    expect(manifest.entrypoints).toMatchObject({
      cli: 'bin/mindos',
      web: 'bin/mindos',
      mcp: 'bin/mindos',
    });
    expect(manifest.artifacts).toContain('bin/mindos');
    expect(manifest.artifacts).not.toContain('_standalone/');
  });

  it('builds platform packages around the Bun binary rather than bin/cli.js', () => {
    const script = read('scripts/build-platform-packages.mjs');
    expect(script).toContain('buildBunBinary');
    expect(script).toContain('bun-single-binary');
    expect(script).toContain('mindos: `bin/${binaryName(target)}`');
    expect(script).toContain('bin/cli.js');
    expect(script).toContain('fallbackRuntime');
  });

  it('routes JS child execution through the binary executor when available', () => {
    const start = read('packages/mindos/bin/commands/start.js');
    const mcpSpawn = read('packages/mindos/bin/lib/mcp-spawn.js');

    expect(start).toContain('MINDOS_BINARY_EXECUTOR');
    expect(start).toContain('runtimeJsExecutor');
    expect(mcpSpawn).toContain('MINDOS_BINARY_EXECUTOR');
    expect(mcpSpawn).toContain('runtimeJsExecutor');
  });
});
