import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(root, relativePath), 'utf-8')) as T;
}

function readText(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf-8');
}

describe('OpenCode-style platform runtime packages', () => {
  it('publishes the main package as a CLI shim with exact-version platform optional dependencies', () => {
    const pkg = readJson<{
      version: string;
      bin?: Record<string, string>;
      files?: string[];
      optionalDependencies?: Record<string, string>;
    }>('packages/mindos/package.json');

    expect(pkg.bin?.mindos).toBe('bin/mindos-shim.cjs');
    expect(pkg.files).not.toContain('_standalone/');
    expect(pkg.files).toContain('bin/mindos-shim.cjs');

    const expected = [
      '@geminilight/mindos-darwin-arm64',
      '@geminilight/mindos-darwin-x64',
      '@geminilight/mindos-linux-arm64',
      '@geminilight/mindos-linux-arm64-musl',
      '@geminilight/mindos-linux-x64',
      '@geminilight/mindos-linux-x64-musl',
      '@geminilight/mindos-windows-arm64',
      '@geminilight/mindos-windows-x64',
    ];

    expect(Object.keys(pkg.optionalDependencies ?? {}).sort()).toEqual(expected);
    for (const name of expected) {
      expect(pkg.optionalDependencies?.[name]).toBe(pkg.version);
    }
  });

  it('keeps lightweight workspace manifests for platform packages', () => {
    const version = readJson<{ version: string }>('packages/mindos/package.json').version;
    const packageDirs = [
      'darwin-arm64',
      'darwin-x64',
      'linux-arm64',
      'linux-arm64-musl',
      'linux-x64',
      'linux-x64-musl',
      'windows-arm64',
      'windows-x64',
    ] as const;

    for (const key of packageDirs) {
      const pkg = readJson<{
        name: string;
        version: string;
        os?: string[];
        cpu?: string[];
      }>(`packages/mindos-platforms/${key}/package.json`);
      expect(pkg.name).toBe(`@geminilight/mindos-${key}`);
      expect(pkg.version).toBe(version);
      expect(pkg.os).toBeUndefined();
      expect(pkg.cpu).toBeUndefined();
    }
  });

  it('has a shim that resolves platform packages and supports override env vars', () => {
    const shim = readText('packages/mindos/bin/mindos-shim.cjs');

    expect(shim).toContain('MINDOS_BIN_PATH');
    expect(shim).toContain('MINDOS_RUNTIME_PACKAGE_PATH');
    expect(shim).toContain('DEFAULT_RUNTIME_MANIFEST_URL');
    expect(shim).toContain('MINDOS_RUNTIME_CACHE_DIR');
    expect(shim).toContain('extractRuntimeArchive');
    expect(shim).toContain('@geminilight/mindos-');
    expect(shim).toContain('linux-x64-musl');
    expect(shim).toContain('childProcess.spawnSync');
    expect(shim).toContain('runtimeEntrypoint');
    expect(shim).toContain('mindos.exe');
    expect(shim).toContain('cli.js');
  });

  it('has a platform package builder with native dependency pruning', () => {
    const script = readText('scripts/build-platform-packages.mjs');

    expect(script).toContain('mindos-platforms');
    expect(script).toContain('@geminilight/mindos-');
    expect(script).toContain('pruneKoffi');
    expect(script).toContain('pruneMarioClipboardPackages');
    expect(script).toContain('_standalone');
    expect(script).toContain('src/cli-runtime.js');
    expect(script).toContain('writeSharedRuntimeManifest');
    expect(script).toContain('runtime-manifest.json');
    expect(readText('scripts/runtime-manifest.mjs')).toContain("route: '/api/health'");
    expect(script).toContain('dist/protocols/mcp-server/index.cjs');
    expect(script).toContain('skills/mindos/SKILL.md');
    expect(script).toContain('skills/mindos-zh/SKILL.md');
    expect(script).toContain("'skills'");
    expect(script).toContain("'skills/'");
    expect(script).toContain('os: [target.os]');
    expect(script).toContain('cpu: [target.cpu]');
    expect(script).toContain("key: 'windows-arm64'");
    expect(script).toContain('binary: false');
    expect(script).toContain("'bin/cli.js'");
    expect(script).not.toContain('bin: {');
    expect(script).not.toContain('mindos: targetBuildBinary');
  });

  it('verifies npm release tarballs include runtime-critical assets', () => {
    const workflow = readText('.github/workflows/publish-npm.yml');
    const release = readText('scripts/release.sh');

    expect(workflow).toContain('"dist/protocols/mcp-server/index.cjs"');
    expect(workflow).toContain('Publish main package to npm');
    expect(workflow).toContain('Publish platform packages to npm');
    expect(workflow).toContain('continue-on-error: true');
    expect(workflow).toContain('platform packages are optional accelerators');
    expect(workflow).toContain('Published CLI shim is missing runtime archive fallback');
    expect(workflow).toContain('Published package missing $f');
    expect(release).toContain('dist/index.js dist/protocols/acp/index.js dist/protocols/mcp-server/index.cjs');
    expect(release).not.toContain('dist/foundation.js dist/protocols/acp/index.js');
    expect(release).toContain('--omit=optional');
    expect(release).toContain('npm rebuild --bin-links');
    expect(release).toContain('mcp install codex -g -y');
    expect(release).toContain('doctor agents codex --json');
    expect(release).toContain('.agents/skills/mindos/SKILL.md');
  });

  it('documents the migration plan and acceptance criteria', () => {
    const specPath = 'wiki/specs/spec-opencode-style-platform-runtime.md';
    expect(existsSync(resolve(root, specPath))).toBe(true);
    const spec = readText(specPath);

    expect(spec).toContain('OpenCode');
    expect(spec).toContain('@geminilight/mindos-darwin-arm64');
    expect(spec).toContain('optionalDependencies');
    expect(spec).toContain('平台裁剪');
  });
});
