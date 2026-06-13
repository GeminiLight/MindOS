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

  it('extracts the embedded runtime without delegating archive paths to system tar', () => {
    const script = read('scripts/build-bun-binary.mjs');

    expect(script).toContain('extractTarGzSafe(tempArchive, tempRoot)');
    expect(script).toContain('function resolveTarEntryPath(destDir, entryName)');
    expect(script).toContain('function resolveTarSymlinkTarget(destDir, entryPath, linkName)');
    expect(script).toContain('symlinkSync(safeLinkName, entryPath)');
    expect(script).toContain('normalizedEntry.split("/").includes("..")');
    expect(script).toContain('Tar entry outside extraction directory');
    expect(script).not.toContain('spawnSync("tar", ["-xzf", tempArchive');
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

  it('builds platform packages around Bun binaries with explicit fallback exceptions', () => {
    const script = read('scripts/build-platform-packages.mjs');
    expect(script).toContain('buildBunBinary');
    expect(script).toContain('bun-single-binary');
    expect(script).toContain("'bin/cli.js'");
    expect(script).toContain('binary: false');
    expect(script).toContain('fallbackRuntime');
    expect(script).not.toContain('mindos: targetBuildBinary');
  });

  it('routes JS child execution through the binary executor when available', () => {
    const start = read('packages/mindos/bin/commands/start.js');
    const mcpSpawn = read('packages/mindos/bin/lib/mcp-spawn.js');

    expect(start).toContain('MINDOS_BINARY_EXECUTOR');
    expect(start).toContain('runtimeJsExecutor');
    expect(mcpSpawn).toContain('MINDOS_BINARY_EXECUTOR');
    expect(mcpSpawn).toContain('runtimeJsExecutor');
  });

  it('embeds the document extraction runtime instead of excluding _standalone (v1.1.7 regression)', () => {
    // v1.1.7 tar-excluded ./_standalone from the embedded runtime archive, so
    // hasDocumentExtractionRuntime() was false in every fresh install and
    // `mindos start` crashed in the source-build path (gen-renderer-index.js
    // ENOENT). The archive must ship a pruned _standalone instead.
    const bunScript = read('scripts/build-bun-binary.mjs');
    expect(bunScript).not.toContain('excludeStandalone');
    expect(bunScript).not.toContain("'--exclude', './_standalone'");

    const platformScript = read('scripts/build-platform-packages.mjs');
    expect(platformScript).toContain('pruneStandaloneToExtractionRuntime');
    expect(platformScript).toContain('assertExtractionRuntime');
    // Bun compiled binaries cannot resolve package.json-main requires from
    // external node_modules — the docx extractor must ship self-contained.
    expect(platformScript).toContain('bundleDocxExtractor');
  });

  it('never routes a packaged runtime into the source-build path', () => {
    // Packaged runtimes ship no packages/web sources, so the source-build
    // branch can only crash there. If the extraction runtime is missing, start
    // must degrade (product server without PDF/DOCX import), not build.
    const start = read('packages/mindos/bin/commands/start.js');
    expect(start).toContain('hasWebSources');
    expect(start).toContain('degraded');
  });
});
