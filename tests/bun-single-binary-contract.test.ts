import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
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

  it('keeps the CLI source free of static bare npm imports (the compiled binary cannot resolve them)', async () => {
    // A Bun standalone executable extracts bin/, dist/ and node_modules/ to
    // ~/.mindos/runtime-cache but cannot resolve bare specifiers from those
    // files: `import x from 'pkg'`, `require('pkg')` and createRequire all fail
    // with "Cannot find package". Only exact file paths load. CLI modules must
    // therefore import node builtins and relative files statically, and load
    // any npm dependency through an explicit file-path fallback (see
    // packages/mindos/bin/lib/jsonc.js). The generated agent-config bundle is
    // scanned too: esbuild must have inlined jsonc-parser, leaving only node:*.
    const { ensureAgentConfigBundle } = await import('../packages/mindos/bin/lib/agent-config.js');
    ensureAgentConfigBundle();
    const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
    const offenders: string[] = [];
    const files = ['packages/mindos/bin', 'packages/mindos/bin/lib', 'packages/mindos/bin/lib/generated'].flatMap((dir) => {
      const abs = resolve(root, dir);
      if (!existsSync(abs)) return [];
      return readdirSync(abs)
        .filter((name) => /\.(c?js|mjs)$/.test(name))
        .map((name) => `${dir}/${name}`);
    });
    expect(files).toContain('packages/mindos/bin/lib/generated/agent-config.mjs');
    for (const file of files) {
      const source = read(file);
      const isMinifiedBundle = file.includes('bin/lib/generated/');
      const specifiers = [
        ...source.matchAll(/^\s*import\s[^;]*?\sfrom\s+['"]([^'"]+)['"]/gm),
        ...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
        // Minified esbuild output drops the whitespace: `}from"node:fs"`.
        ...(isMinifiedBundle ? source.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g) : []),
        ...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
      ].map((match) => match[1]);
      for (const specifier of specifiers) {
        if (!specifier) continue;
        if (specifier.startsWith('.') || specifier.startsWith('/') || builtins.has(specifier)) continue;
        offenders.push(`${file}: ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
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
    expect(script).toContain('runtimeBootstrap: true');
    expect(script).toContain("'runtime-bootstrap'");
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

  it('drives the shared SQLite store through bun:sqlite under Bun and smokes it from the binary', () => {
    // Decision 3 of spec-web-api-layer-direction: the Bun route only continues
    // with a bun:sqlite driver behind foundation/storage/sqlite.ts, verified by
    // the same tests under both runtimes and touched by the release smoke.
    const driver = read('packages/mindos/src/foundation/storage/sqlite-driver.ts');
    const store = read('packages/mindos/src/foundation/storage/sqlite.ts');
    for (const source of [driver, store]) {
      // Runtime specifiers must never be static: vite strips `node:` and
      // resolves `sqlite` as an npm package, and webpack would need externals
      // for both. Only runtime strings (getBuiltinModule / createRequire) load them.
      expect(source).not.toMatch(/from\s+['"](?:bun|node):sqlite['"]/);
      expect(source).not.toMatch(/import\(\s*['"](?:bun|node):sqlite['"]\s*\)/);
      expect(source).not.toMatch(/require\(\s*['"](?:bun|node):sqlite['"]\s*\)/);
    }
    expect(store).not.toContain('assertNodeRuntime');
    expect(driver).toContain('getBuiltinModule');
    // Bun binds bare named parameters to NULL silently outside strict mode.
    expect(driver).toContain('strict: true');

    const doctor = read('packages/mindos/bin/commands/doctor.js');
    expect(doctor).toContain("'storage'");
    expect(doctor).toContain('dist/foundation/storage/sqlite.js');

    const release = read('scripts/release.sh');
    expect(release).toContain('doctor storage --json');
    expect(release).toContain('"driver"[[:space:]]*:[[:space:]]*"bun:sqlite"');

    expect(existsSync(resolve(root, 'wiki/specs/spec-sqlite-bun-driver.md'))).toBe(true);
    const spec = read('wiki/specs/spec-bun-single-binary-runtime.md');
    expect(spec).toContain('bun:sqlite');
    expect(spec).toContain('三个前提');
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
