import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it, afterEach } from 'vitest';
import {
  copyAppForBundledRuntime,
  materializeStandaloneAssets,
  pruneClaudeAgentSdkNativePackages,
} from '../scripts/prepare-mindos-bundle.mjs';
import { getStandaloneAppRequiredEntries } from '../scripts/runtime-health-contract.mjs';

function writeStandaloneApp(appDir: string, omit: string[] = []) {
  for (const entry of getStandaloneAppRequiredEntries()) {
    if (omit.includes(entry.path)) continue;
    const target = path.join(appDir, entry.path);
    if (entry.type === 'directory') {
      mkdirSync(target, { recursive: true });
    } else {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, `// ${entry.path}`);
    }
  }
}

const created: string[] = [];

function makeTemp(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterEach(() => {
  while (created.length) {
    const d = created.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

describe('materializeStandaloneAssets', () => {
  it('throws when standalone server.js is missing', () => {
    const appDir = makeTemp('mindos-app-');
    mkdirSync(path.join(appDir, '.next', 'standalone'), { recursive: true });
    expect(() => materializeStandaloneAssets(appDir)).toThrow(/Missing .*server\.js/);
  });

  it('copies .next/static and public into standalone without build caches', () => {
    const appDir = makeTemp('mindos-app-');
    const standalone = path.join(appDir, '.next', 'standalone');
    writeStandaloneApp(appDir);

    mkdirSync(path.join(standalone, '.next', 'cache', 'webpack'), { recursive: true });
    writeFileSync(path.join(standalone, '.next', 'cache', 'webpack', '0.pack'), 'cache');
    mkdirSync(path.join(standalone, '.next', 'dev'), { recursive: true });
    writeFileSync(path.join(standalone, '.next', 'dev', 'hot-reloader.json'), 'dev');

    mkdirSync(path.join(appDir, '.next', 'static', 'chunks'), { recursive: true });
    writeFileSync(path.join(appDir, '.next', 'static', 'chunks', 'a.js'), 'a');

    mkdirSync(path.join(appDir, 'public'), { recursive: true });
    writeFileSync(path.join(appDir, 'public', 'favicon.ico'), 'ico');

    materializeStandaloneAssets(appDir);

    const staticFile = path.join(standalone, '.next', 'static', 'chunks', 'a.js');
    expect(existsSync(staticFile)).toBe(true);
    expect(readFileSync(staticFile, 'utf-8')).toBe('a');

    const pub = path.join(standalone, 'public', 'favicon.ico');
    expect(existsSync(pub)).toBe(true);
    expect(readFileSync(pub, 'utf-8')).toBe('ico');

    expect(existsSync(path.join(standalone, '.next', 'cache'))).toBe(false);
    expect(existsSync(path.join(standalone, '.next', 'dev'))).toBe(false);
  });

  it('throws when required pdf runtime files are missing', () => {
    const appDir = makeTemp('mindos-app-missing-pdf-');
    writeStandaloneApp(appDir, [
      '.next/standalone/node_modules/pdfjs-dist/legacy/build/pdf.mjs',
      '.next/standalone/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    ]);
    expect(() => materializeStandaloneAssets(appDir)).toThrow(/Incomplete standalone runtime/);
  });

  it('replaces broken standalone package symlinks from app node_modules fallback', () => {
    const appDir = makeTemp('mindos-app-broken-symlink-');
    writeStandaloneApp(appDir);

    const fallbackPackage = path.join(appDir, 'node_modules', '@mariozechner', 'pi-ai');
    mkdirSync(path.join(fallbackPackage, 'dist'), { recursive: true });
    writeFileSync(path.join(fallbackPackage, 'dist', 'index.js'), 'ok');

    const standalonePackage = path.join(appDir, '.next', 'standalone', 'node_modules', '@mariozechner', 'pi-ai');
    rmSync(standalonePackage, { recursive: true, force: true });
    mkdirSync(path.dirname(standalonePackage), { recursive: true });
    symlinkSync('../../../../node_modules/.pnpm/missing/node_modules/@mariozechner/pi-ai', standalonePackage);

    materializeStandaloneAssets(appDir);

    expect(lstatSync(standalonePackage).isSymbolicLink()).toBe(false);
    expect(readFileSync(path.join(standalonePackage, 'dist', 'index.js'), 'utf-8')).toBe('ok');
  });

  it('does not dereference pnpm virtual-store self links into nested standalone builds', () => {
    const appDir = makeTemp('mindos-app-pnpm-self-link-');
    writeStandaloneApp(appDir);

    const packageStore = path.join(makeTemp('mindos-pnpm-store-'), 'runtime-package');
    mkdirSync(path.join(packageStore, 'node_modules', '.pnpm', 'node_modules', '@mindos'), { recursive: true });
    writeFileSync(path.join(packageStore, 'package.json'), JSON.stringify({
      name: 'runtime-package',
      version: '1.0.0',
    }));
    writeFileSync(path.join(packageStore, 'index.js'), 'module.exports = {};');
    symlinkSync(appDir, path.join(packageStore, 'node_modules', '.pnpm', 'node_modules', '@mindos', 'web'));

    const standaloneNodeModules = path.join(appDir, '.next', 'standalone', 'node_modules');
    const standalonePackage = path.join(standaloneNodeModules, 'runtime-package');
    mkdirSync(path.dirname(standalonePackage), { recursive: true });
    symlinkSync(packageStore, standalonePackage);

    const rootVirtualStoreSelfLink = path.join(standaloneNodeModules, '.pnpm', 'node_modules', '@mindos', 'web');
    mkdirSync(path.dirname(rootVirtualStoreSelfLink), { recursive: true });
    symlinkSync(appDir, rootVirtualStoreSelfLink);

    materializeStandaloneAssets(appDir);

    expect(lstatSync(standalonePackage).isSymbolicLink()).toBe(false);
    expect(readFileSync(path.join(standalonePackage, 'index.js'), 'utf-8')).toBe('module.exports = {};');
    expect(existsSync(path.join(standalonePackage, 'node_modules', '.pnpm'))).toBe(false);
    expect(existsSync(path.join(standaloneNodeModules, '.pnpm'))).toBe(false);
    expect(existsSync(path.join(standalonePackage, '.next', 'standalone', 'server.js'))).toBe(false);
  });

  it('materializes dependencies of external standalone packages', () => {
    const appDir = makeTemp('mindos-app-standalone-deps-');
    writeStandaloneApp(appDir);

    const externalPackage = path.join(appDir, '.next', 'standalone', 'node_modules', '@mariozechner', 'pi-ai');
    mkdirSync(externalPackage, { recursive: true });
    writeFileSync(path.join(externalPackage, 'package.json'), JSON.stringify({
      name: '@mariozechner/pi-ai',
      dependencies: { '@sinclair/typebox': '^0.34.41' },
    }));

    const fallbackDependency = path.join(appDir, 'node_modules', '@sinclair', 'typebox');
    mkdirSync(path.join(fallbackDependency, 'build'), { recursive: true });
    writeFileSync(path.join(fallbackDependency, 'package.json'), JSON.stringify({
      name: '@sinclair/typebox',
      version: '0.34.41',
    }));
    writeFileSync(path.join(fallbackDependency, 'build', 'index.mjs'), 'export const Type = {};');

    materializeStandaloneAssets(appDir);

    const materializedDependency = path.join(appDir, '.next', 'standalone', 'node_modules', '@sinclair', 'typebox');
    expect(existsSync(materializedDependency)).toBe(true);
    expect(readFileSync(path.join(materializedDependency, 'build', 'index.mjs'), 'utf-8')).toBe('export const Type = {};');
  });

  it('materializes explicit runtime dependency seeds even when Next did not trace them', () => {
    const appDir = makeTemp('mindos-app-runtime-seeds-');
    writeStandaloneApp(appDir);

    const tracedDependency = path.join(appDir, '.next', 'standalone', 'node_modules', '@sinclair', 'typebox');
    rmSync(tracedDependency, { recursive: true, force: true });

    const fallbackDependency = path.join(appDir, 'node_modules', '@sinclair', 'typebox');
    mkdirSync(path.join(fallbackDependency, 'build'), { recursive: true });
    writeFileSync(path.join(fallbackDependency, 'package.json'), JSON.stringify({
      name: '@sinclair/typebox',
      version: '0.34.41',
    }));
    writeFileSync(path.join(fallbackDependency, 'build', 'index.mjs'), 'export const Type = {};');

    materializeStandaloneAssets(appDir, {
      runtimeDependencySeeds: ['@sinclair/typebox'],
    });

    expect(existsSync(path.join(tracedDependency, 'package.json'))).toBe(true);
    expect(readFileSync(path.join(tracedDependency, 'build', 'index.mjs'), 'utf-8')).toBe('export const Type = {};');
  });

  it('materializes transitive dependencies introduced by Next runtime packages', () => {
    const appDir = makeTemp('mindos-app-next-runtime-transitive-deps-');
    writeStandaloneApp(appDir);

    const sourceNext = path.join(appDir, 'node_modules', 'next');
    const standaloneNext = path.join(appDir, '.next', 'standalone', 'node_modules', 'next');
    for (const packageDir of [sourceNext, standaloneNext]) {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
        name: 'next',
        dependencies: { postcss: '^8.4.31' },
      }));
      writeFileSync(path.join(packageDir, 'index.js'), 'module.exports = {};');
    }

    const sourcePostcss = path.join(appDir, 'node_modules', 'postcss');
    mkdirSync(sourcePostcss, { recursive: true });
    writeFileSync(path.join(sourcePostcss, 'package.json'), JSON.stringify({
      name: 'postcss',
      version: '8.4.31',
      dependencies: { nanoid: '^3.3.6' },
    }));

    const sourceNanoid = path.join(appDir, 'node_modules', 'postcss', 'node_modules', 'nanoid');
    mkdirSync(sourceNanoid, { recursive: true });
    writeFileSync(path.join(sourceNanoid, 'package.json'), JSON.stringify({
      name: 'nanoid',
      version: '3.3.8',
    }));
    writeFileSync(path.join(sourceNanoid, 'index.js'), 'module.exports = {};');

    materializeStandaloneAssets(appDir);

    const postcssPackage = path.join(appDir, '.next', 'standalone', 'node_modules', 'postcss', 'package.json');
    const nanoidPackage = path.join(appDir, '.next', 'standalone', 'node_modules', 'nanoid', 'package.json');
    expect(JSON.parse(readFileSync(postcssPackage, 'utf-8')).version).toBe('8.4.31');
    expect(JSON.parse(readFileSync(nanoidPackage, 'utf-8')).version).toBe('3.3.8');
  });

  it('fails when an external standalone package dependency cannot be materialized', () => {
    const appDir = makeTemp('mindos-app-missing-standalone-dep-');
    writeStandaloneApp(appDir);

    const externalPackage = path.join(appDir, '.next', 'standalone', 'node_modules', '@mariozechner', 'pi-ai');
    mkdirSync(externalPackage, { recursive: true });
    writeFileSync(path.join(externalPackage, 'package.json'), JSON.stringify({
      name: '@mariozechner/pi-ai',
      dependencies: { '@sinclair/typebox': '^0.34.41' },
    }));

    expect(() => materializeStandaloneAssets(appDir)).toThrow(/Incomplete standalone dependency closure/);
  });

  it('preserves nested dependency versions when a top-level package name already exists', () => {
    const appDir = makeTemp('mindos-app-nested-deps-');
    writeStandaloneApp(appDir);

    const externalPackage = path.join(appDir, '.next', 'standalone', 'node_modules', 'minimatch');
    mkdirSync(externalPackage, { recursive: true });
    writeFileSync(path.join(externalPackage, 'package.json'), JSON.stringify({
      name: 'minimatch',
      dependencies: { 'brace-expansion': '^5.0.0' },
    }));

    const staleTopLevel = path.join(appDir, '.next', 'standalone', 'node_modules', 'brace-expansion');
    mkdirSync(staleTopLevel, { recursive: true });
    writeFileSync(path.join(staleTopLevel, 'package.json'), JSON.stringify({
      name: 'brace-expansion',
      version: '1.1.14',
    }));

    const sourcePackage = path.join(appDir, 'node_modules', 'minimatch');
    mkdirSync(sourcePackage, { recursive: true });
    writeFileSync(path.join(sourcePackage, 'package.json'), JSON.stringify({
      name: 'minimatch',
      version: '10.0.3',
      dependencies: { 'brace-expansion': '^5.0.0' },
    }));

    const sourceDependency = path.join(appDir, 'node_modules', 'minimatch', 'node_modules', 'brace-expansion');
    mkdirSync(sourceDependency, { recursive: true });
    writeFileSync(path.join(sourceDependency, 'package.json'), JSON.stringify({
      name: 'brace-expansion',
      version: '5.0.5',
      main: 'index.js',
    }));
    writeFileSync(path.join(sourceDependency, 'index.js'), 'export const expand = () => [];');

    materializeStandaloneAssets(appDir);

    const nestedDependency = path.join(externalPackage, 'node_modules', 'brace-expansion', 'package.json');
    expect(JSON.parse(readFileSync(nestedDependency, 'utf-8')).version).toBe('5.0.5');
    expect(JSON.parse(readFileSync(path.join(staleTopLevel, 'package.json'), 'utf-8')).version).toBe('1.1.14');
  });

  it('materializes dependencies declared by nested package versions', () => {
    const appDir = makeTemp('mindos-app-nested-transitive-deps-');
    writeStandaloneApp(appDir);

    const parentPackage = path.join(appDir, '.next', 'standalone', 'node_modules', 'cli-highlight');
    const nestedChalk = path.join(parentPackage, 'node_modules', 'chalk');
    mkdirSync(nestedChalk, { recursive: true });
    writeFileSync(path.join(parentPackage, 'package.json'), JSON.stringify({
      name: 'cli-highlight',
      dependencies: { chalk: '^4.0.0' },
    }));
    writeFileSync(path.join(nestedChalk, 'package.json'), JSON.stringify({
      name: 'chalk',
      version: '4.1.2',
      dependencies: { 'supports-color': '^7.1.0' },
    }));

    const topLevelChalk = path.join(appDir, '.next', 'standalone', 'node_modules', 'chalk');
    mkdirSync(topLevelChalk, { recursive: true });
    writeFileSync(path.join(topLevelChalk, 'package.json'), JSON.stringify({
      name: 'chalk',
      version: '5.6.2',
    }));

    const sourceSupportsColor = path.join(appDir, 'node_modules', 'supports-color');
    mkdirSync(sourceSupportsColor, { recursive: true });
    writeFileSync(path.join(sourceSupportsColor, 'package.json'), JSON.stringify({
      name: 'supports-color',
      version: '7.2.0',
    }));
    writeFileSync(path.join(sourceSupportsColor, 'index.js'), 'module.exports = {};');

    materializeStandaloneAssets(appDir);

    expect(existsSync(path.join(appDir, '.next', 'standalone', 'node_modules', 'supports-color', 'index.js'))).toBe(true);
  });

  it('deduplicates nested packages when the top-level package has the same version', () => {
    const appDir = makeTemp('mindos-app-dedupe-deps-');
    writeStandaloneApp(appDir);

    const parentPackage = path.join(appDir, '.next', 'standalone', 'node_modules', 'parent-package');
    const nestedPackage = path.join(parentPackage, 'node_modules', 'shared-runtime-dep');
    const topLevelPackage = path.join(appDir, '.next', 'standalone', 'node_modules', 'shared-runtime-dep');
    for (const packageDir of [parentPackage, nestedPackage, topLevelPackage]) {
      mkdirSync(packageDir, { recursive: true });
    }
    writeFileSync(path.join(parentPackage, 'package.json'), JSON.stringify({
      name: 'parent-package',
      dependencies: { 'shared-runtime-dep': '^1.24.0' },
    }));
    writeFileSync(path.join(nestedPackage, 'package.json'), JSON.stringify({
      name: 'shared-runtime-dep',
      version: '1.24.3',
    }));
    writeFileSync(path.join(topLevelPackage, 'package.json'), JSON.stringify({
      name: 'shared-runtime-dep',
      version: '1.24.3',
    }));

    materializeStandaloneAssets(appDir);

    expect(existsSync(nestedPackage)).toBe(false);
    expect(existsSync(topLevelPackage)).toBe(true);
  });

  it('prunes onnxruntime-node native binaries to the target platform and arch', () => {
    const appDir = makeTemp('mindos-app-native-prune-');
    writeStandaloneApp(appDir);

    const onnxPackage = path.join(appDir, '.next', 'standalone', 'node_modules', 'onnxruntime-node');
    const napiDir = path.join(onnxPackage, 'bin', 'napi-v6');
    for (const rel of [
      'darwin/arm64/libonnxruntime.dylib',
      'darwin/x64/libonnxruntime.dylib',
      'linux/x64/libonnxruntime.so',
      'win32/arm64/onnxruntime.dll',
    ]) {
      const file = path.join(napiDir, rel);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, rel);
    }
    writeFileSync(path.join(onnxPackage, 'package.json'), JSON.stringify({
      name: 'onnxruntime-node',
      version: '1.24.3',
    }));

    materializeStandaloneAssets(appDir, {
      targetPlatform: 'darwin',
      targetArch: 'arm64',
      bundleLocalEmbeddingRuntime: true,
    });

    expect(existsSync(path.join(napiDir, 'darwin', 'arm64', 'libonnxruntime.dylib'))).toBe(true);
    expect(existsSync(path.join(napiDir, 'darwin', 'x64'))).toBe(false);
    expect(existsSync(path.join(napiDir, 'linux'))).toBe(false);
    expect(existsSync(path.join(napiDir, 'win32'))).toBe(false);
  });

  it('prunes Next development payload and package type artifacts from standalone runtime', () => {
    const appDir = makeTemp('mindos-app-dev-payload-prune-');
    writeStandaloneApp(appDir);

    const nextDist = path.join(appDir, '.next', 'standalone', 'node_modules', 'next', 'dist');
    mkdirSync(path.join(nextDist, 'server'), { recursive: true });
    mkdirSync(path.join(nextDist, 'esm'), { recursive: true });
    mkdirSync(path.join(nextDist, 'build'), { recursive: true });
    mkdirSync(path.join(nextDist, 'cli'), { recursive: true });
    writeFileSync(path.join(nextDist, 'server', 'next.js'), 'server');
    writeFileSync(path.join(nextDist, 'esm', 'next.js'), 'esm');
    writeFileSync(path.join(nextDist, 'build', 'webpack.js'), 'build');
    writeFileSync(path.join(nextDist, 'cli', 'next-test.js'), 'cli');

    const packageDir = path.join(appDir, '.next', 'standalone', 'node_modules', 'runtime-package');
    mkdirSync(path.join(packageDir, 'docs'), { recursive: true });
    writeFileSync(path.join(packageDir, 'docs', 'guide.md'), 'docs');
    writeFileSync(path.join(packageDir, 'index.d.ts'), 'export {};');
    writeFileSync(path.join(packageDir, 'index.js.map'), '{}');
    writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'runtime-package' }));

    materializeStandaloneAssets(appDir);

    expect(existsSync(path.join(nextDist, 'server', 'next.js'))).toBe(true);
    expect(existsSync(path.join(nextDist, 'build', 'webpack.js'))).toBe(true);
    expect(existsSync(path.join(nextDist, 'cli', 'next-test.js'))).toBe(true);
    expect(existsSync(path.join(nextDist, 'esm'))).toBe(false);
    expect(existsSync(path.join(packageDir, 'docs'))).toBe(false);
    expect(existsSync(path.join(packageDir, 'index.d.ts'))).toBe(false);
    expect(existsSync(path.join(packageDir, 'index.js.map'))).toBe(false);
    expect(existsSync(path.join(packageDir, 'package.json'))).toBe(true);
  });

  it('keeps runtime doc directories required by packages such as yaml', () => {
    const appDir = makeTemp('mindos-app-runtime-doc-dir-');
    writeStandaloneApp(appDir);

    const packageDir = path.join(appDir, '.next', 'standalone', 'node_modules', 'yaml');
    mkdirSync(path.join(packageDir, 'dist', 'doc'), { recursive: true });
    mkdirSync(path.join(packageDir, 'docs'), { recursive: true });
    writeFileSync(path.join(packageDir, 'dist', 'doc', 'directives.js'), 'export {};');
    writeFileSync(path.join(packageDir, 'docs', 'guide.md'), 'docs');
    writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'yaml' }));

    materializeStandaloneAssets(appDir);

    expect(existsSync(path.join(packageDir, 'dist', 'doc', 'directives.js'))).toBe(true);
    expect(existsSync(path.join(packageDir, 'docs'))).toBe(false);
  });

  it('does not bundle optional local embedding runtime packages by default', () => {
    const appDir = makeTemp('mindos-app-optional-embedding-prune-');
    writeStandaloneApp(appDir);

    for (const packageName of ['@huggingface/transformers', 'onnxruntime-web', 'onnxruntime-node']) {
      const packageDir = path.join(appDir, '.next', 'standalone', 'node_modules', packageName);
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: packageName, version: '1.0.0' }));
    }

    materializeStandaloneAssets(appDir);

    for (const packageName of ['@huggingface/transformers', 'onnxruntime-web', 'onnxruntime-node']) {
      expect(existsSync(path.join(appDir, '.next', 'standalone', 'node_modules', packageName))).toBe(false);
    }
  });

  it('does not bundle Claude Agent SDK native platform packages', () => {
    const appDir = makeTemp('mindos-app-claude-sdk-native-prune-');
    writeStandaloneApp(appDir);

    const nativePackage = path.join(
      appDir,
      '.next',
      'standalone',
      'node_modules',
      '@anthropic-ai',
      'claude-agent-sdk-darwin-arm64',
    );
    mkdirSync(nativePackage, { recursive: true });
    writeFileSync(path.join(nativePackage, 'package.json'), JSON.stringify({
      name: '@anthropic-ai/claude-agent-sdk-darwin-arm64',
      version: '0.3.170',
    }));
    writeFileSync(path.join(nativePackage, 'claude'), 'native-binary-placeholder');

    materializeStandaloneAssets(appDir);

    expect(existsSync(nativePackage)).toBe(false);
  });

  it('prunes pnpm-layout Claude Agent SDK native package directories', () => {
    const root = makeTemp('mindos-claude-sdk-native-pnpm-prune-');
    const nativePackage = path.join(root, 'node_modules', '.pnpm', '@anthropic-ai+claude-agent-sdk-darwin-arm64@0.3.170');
    mkdirSync(nativePackage, { recursive: true });
    writeFileSync(path.join(nativePackage, 'package.json'), '{}');

    expect(pruneClaudeAgentSdkNativePackages(root)).toBe(1);
    expect(existsSync(nativePackage)).toBe(false);
  });

  it('keeps optional local embedding runtime packages when explicitly requested', () => {
    const appDir = makeTemp('mindos-app-optional-embedding-keep-');
    writeStandaloneApp(appDir);

    for (const packageName of ['@huggingface/transformers', 'onnxruntime-web', 'onnxruntime-node']) {
      const packageDir = path.join(appDir, '.next', 'standalone', 'node_modules', packageName);
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: packageName, version: '1.0.0' }));
    }

    materializeStandaloneAssets(appDir, { bundleLocalEmbeddingRuntime: true });

    for (const packageName of ['@huggingface/transformers', 'onnxruntime-web', 'onnxruntime-node']) {
      expect(existsSync(path.join(appDir, '.next', 'standalone', 'node_modules', packageName))).toBe(true);
    }
  });
});

describe('copyAppForBundledRuntime', () => {
  it('throws when source app directory is missing', () => {
    const dest = makeTemp('mindos-dest-');
    expect(() => copyAppForBundledRuntime(path.join(dest, 'nope'), path.join(dest, 'out'))).toThrow(
      /Missing app directory/
    );
  });

  it('omits node_modules and nested .next/cache directories', () => {
    const src = makeTemp('mindos-src-');
    const dest = path.join(makeTemp('mindos-dest-'), 'app');

    writeFileSync(path.join(src, 'package.json'), '{}');
    mkdirSync(path.join(src, 'node_modules', 'x'), { recursive: true });
    writeFileSync(path.join(src, 'node_modules', 'x', 'bad.js'), 'bad');

    mkdirSync(path.join(src, '.next', 'cache', 'foo'), { recursive: true });
    writeFileSync(path.join(src, '.next', 'cache', 'foo', 'c.bin'), 'cache');

    mkdirSync(path.join(src, '.next', 'dev', 'junk'), { recursive: true });
    writeFileSync(path.join(src, '.next', 'dev', 'junk', 'big.bin'), 'devcache');

    mkdirSync(path.join(src, '.next', 'standalone'), { recursive: true });
    writeFileSync(path.join(src, '.next', 'standalone', 'server.js'), 'ok');
    mkdirSync(path.join(src, '.next', 'standalone', '.next', 'cache', 'webpack'), { recursive: true });
    writeFileSync(path.join(src, '.next', 'standalone', '.next', 'cache', 'webpack', '0.pack'), 'nested-cache');

    copyAppForBundledRuntime(src, dest);

    expect(existsSync(path.join(dest, 'package.json'))).toBe(true);
    expect(existsSync(path.join(dest, 'node_modules'))).toBe(false);
    expect(existsSync(path.join(dest, '.next', 'cache'))).toBe(false);
    expect(existsSync(path.join(dest, '.next', 'dev'))).toBe(false);
    expect(existsSync(path.join(dest, '.next', 'standalone', '.next', 'cache'))).toBe(false);
    expect(existsSync(path.join(dest, '.next', 'standalone', 'server.js'))).toBe(true);
  });

  it('replaces destination on each run', () => {
    const src = makeTemp('mindos-src2-');
    const destRoot = makeTemp('mindos-dest2-');
    const dest = path.join(destRoot, 'app');
    writeFileSync(path.join(src, 'a.txt'), 'v1');

    copyAppForBundledRuntime(src, dest);
    expect(readFileSync(path.join(dest, 'a.txt'), 'utf-8')).toBe('v1');

    writeFileSync(path.join(src, 'a.txt'), 'v2');
    copyAppForBundledRuntime(src, dest);
    expect(readFileSync(path.join(dest, 'a.txt'), 'utf-8')).toBe('v2');
  });

  it('materializes scoped package symlinks inside standalone node_modules', () => {
    const src = makeTemp('mindos-src-symlink-');
    const dest = path.join(makeTemp('mindos-dest-symlink-'), 'app');
    const packageStore = path.join(src, '..', 'store', '@huggingface', 'transformers');
    const standaloneNodeModules = path.join(src, '.next', 'standalone', 'node_modules');
    const packageLink = path.join(standaloneNodeModules, '@huggingface', 'transformers');

    mkdirSync(path.join(packageStore, 'dist'), { recursive: true });
    writeFileSync(path.join(packageStore, 'package.json'), '{"name":"@huggingface/transformers"}');
    writeFileSync(path.join(packageStore, 'dist', 'index.js'), 'module.exports = {};');
    mkdirSync(path.dirname(packageLink), { recursive: true });
    symlinkSync(packageStore, packageLink);

    copyAppForBundledRuntime(src, dest);

    const copiedPackage = path.join(dest, '.next', 'standalone', 'node_modules', '@huggingface', 'transformers');
    expect(lstatSync(copiedPackage).isSymbolicLink()).toBe(false);
    expect(readFileSync(path.join(copiedPackage, 'dist', 'index.js'), 'utf-8')).toBe('module.exports = {};');
  });
});
