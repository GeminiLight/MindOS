import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it, afterEach } from 'vitest';
import {
  BUILTIN_AGENT_EXTENSION_RUNTIME_DEPENDENCY_SEEDS,
  IM_RUNTIME_DEPENDENCY_SEEDS,
  MINDOS_WEB_RUNTIME_EXTENSION_SOURCE_ENTRIES,
  copyAppForBundledRuntime,
  materializeStandaloneAssets,
  pruneClaudeAgentSdkNativePackages,
  RUNTIME_DEPENDENCY_SEEDS,
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
    if (entry.path.startsWith('.next/standalone/lib/')) {
      const sourceRel = entry.path.slice('.next/standalone/'.length);
      const source = path.join(appDir, sourceRel);
      if (entry.type === 'directory') {
        mkdirSync(source, { recursive: true });
      } else {
        mkdirSync(path.dirname(source), { recursive: true });
        writeFileSync(source, `// source ${sourceRel}`);
      }
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

  it('seeds every built-in PI agent extension package into runtime bundles', () => {
    expect(BUILTIN_AGENT_EXTENSION_RUNTIME_DEPENDENCY_SEEDS).toEqual([
      '@juicesharp/rpiv-ask-user-question',
      'pi-mcp-adapter',
      'pi-schedule-prompt',
      'pi-subagents',
      'pi-web-access',
    ]);
    expect(RUNTIME_DEPENDENCY_SEEDS).toEqual(expect.arrayContaining(BUILTIN_AGENT_EXTENSION_RUNTIME_DEPENDENCY_SEEDS));
  });

  it('seeds IM adapter SDK packages loaded dynamically by channel tools', () => {
    expect(IM_RUNTIME_DEPENDENCY_SEEDS).toEqual([
      '@larksuiteoapi/node-sdk',
      '@slack/web-api',
      'discord.js',
      'grammy',
    ]);
    expect(RUNTIME_DEPENDENCY_SEEDS).toEqual(expect.arrayContaining(IM_RUNTIME_DEPENDENCY_SEEDS));
  });

  it('materializes MindOS-owned runtime extension sources into standalone bundles', () => {
    const appDir = makeTemp('mindos-app-runtime-extension-sources-');
    writeStandaloneApp(appDir);

    const sourceFiles = [
      'lib/acp/agent-descriptors.ts',
      'lib/agent/ask-user-question-bridge-extension.ts',
      'lib/agent/builtin-extension-runtime.ts',
      'lib/agent/kb-extension.ts',
      'lib/agent/mindos-mcp-adapter-extension.ts',
      'lib/agent/providers.ts',
      'lib/agent/reconnect.ts',
      'lib/agent/subagent-ledger-extension.ts',
      'lib/custom-endpoints.ts',
      'lib/im/index.ts',
      'lib/im/executor.ts',
      'lib/im/adapters/telegram.ts',
      'lib/im/adapters/feishu.ts',
      'lib/im/adapters/slack.ts',
      'lib/im/adapters/discord.ts',
      'lib/mind-root.ts',
      'lib/pi-integration/mcp-config.ts',
      'lib/schedule-prompt/index.ts',
      'lib/settings.ts',
    ];

    for (const rel of sourceFiles) {
      const file = path.join(appDir, rel);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `// source ${rel}`);
    }

    materializeStandaloneAssets(appDir);

    for (const rel of sourceFiles) {
      expect(readFileSync(path.join(appDir, '.next', 'standalone', rel), 'utf-8')).toBe(`// source ${rel}`);
    }
    expect(MINDOS_WEB_RUNTIME_EXTENSION_SOURCE_ENTRIES).toContain('lib/im');
  });

  it('materializes TS-only built-in extension packages when Next did not trace them', () => {
    const appDir = makeTemp('mindos-app-runtime-extension-seeds-');
    writeStandaloneApp(appDir, [
      '.next/standalone/node_modules/pi-web-access/index.ts',
    ]);

    const tracedExtension = path.join(appDir, '.next', 'standalone', 'node_modules', 'pi-web-access');
    rmSync(tracedExtension, { recursive: true, force: true });

    const sourceExtension = path.join(appDir, 'node_modules', 'pi-web-access');
    mkdirSync(sourceExtension, { recursive: true });
    writeFileSync(path.join(sourceExtension, 'package.json'), JSON.stringify({
      name: 'pi-web-access',
      version: '0.10.7',
    }));
    writeFileSync(path.join(sourceExtension, 'index.ts'), 'export default function webAccess() {}');

    materializeStandaloneAssets(appDir, {
      runtimeDependencySeeds: ['pi-web-access'],
    });

    expect(existsSync(path.join(tracedExtension, 'package.json'))).toBe(true);
    expect(readFileSync(path.join(tracedExtension, 'index.ts'), 'utf-8')).toBe('export default function webAccess() {}');
  });

  it('prunes direct development tooling before dependency closure checks', () => {
    const appDir = makeTemp('mindos-app-dev-tooling-prune-');
    writeStandaloneApp(appDir);

    const standaloneNodeModules = path.join(appDir, '.next', 'standalone', 'node_modules');
    const devPackages = {
      eslint: { '@eslint/js': '^9.39.4' },
      'eslint-plugin-react-hooks': { '@babel/core': '^7.24.4' },
      tsx: { esbuild: '~0.27.0' },
      'typescript-eslint': { '@typescript-eslint/parser': '8.59.0' },
      vitest: { vite: '^5.0.0' },
    };
    for (const [packageName, dependencies] of Object.entries(devPackages)) {
      const packageDir = path.join(standaloneNodeModules, packageName);
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
        name: packageName,
        version: '1.0.0',
        dependencies,
      }));
    }
    const eslintScope = path.join(standaloneNodeModules, '@eslint');
    mkdirSync(path.join(eslintScope, 'config-array'), { recursive: true });
    writeFileSync(path.join(eslintScope, 'config-array', 'package.json'), JSON.stringify({
      name: '@eslint/config-array',
      version: '1.0.0',
    }));
    const nestedVitest = path.join(standaloneNodeModules, 'runtime-package', 'node_modules', 'vitest');
    mkdirSync(nestedVitest, { recursive: true });
    writeFileSync(path.join(nestedVitest, 'package.json'), JSON.stringify({
      name: 'vitest',
      version: '2.1.9',
      dependencies: { vite: '^5.0.0' },
    }));

    materializeStandaloneAssets(appDir);

    for (const packageName of Object.keys(devPackages)) {
      expect(existsSync(path.join(standaloneNodeModules, packageName))).toBe(false);
    }
    expect(existsSync(eslintScope)).toBe(false);
    expect(existsSync(nestedVitest)).toBe(false);
  });

  it('keeps runtime @types packages when production packages declare them as dependencies', () => {
    const appDir = makeTemp('mindos-app-runtime-types-');
    writeStandaloneApp(appDir);

    const standaloneNodeModules = path.join(appDir, '.next', 'standalone', 'node_modules');
    const runtimePackage = path.join(standaloneNodeModules, '@discordjs', 'ws');
    mkdirSync(runtimePackage, { recursive: true });
    writeFileSync(path.join(runtimePackage, 'package.json'), JSON.stringify({
      name: '@discordjs/ws',
      version: '1.2.3',
      dependencies: { '@types/ws': '^8.5.10' },
    }));

    const sourceTypes = path.join(appDir, 'node_modules', '@types', 'ws');
    mkdirSync(sourceTypes, { recursive: true });
    writeFileSync(path.join(sourceTypes, 'package.json'), JSON.stringify({
      name: '@types/ws',
      version: '8.5.10',
    }));

    materializeStandaloneAssets(appDir);

    expect(existsSync(path.join(standaloneNodeModules, '@types', 'ws', 'package.json'))).toBe(true);
  });

  it('does not copy the repo root when resolving package names that also exist as Node builtins', () => {
    const repoRoot = makeTemp('mindos-repo-root-');
    const appDir = path.join(repoRoot, 'packages', 'web');
    mkdirSync(appDir, { recursive: true });
    writeStandaloneApp(appDir);
    writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({
      name: 'mindos-dev',
      version: '1.1.3',
    }));

    const parentPackage = path.join(appDir, '.next', 'standalone', 'node_modules', 'readable-stream');
    mkdirSync(parentPackage, { recursive: true });
    writeFileSync(path.join(parentPackage, 'package.json'), JSON.stringify({
      name: 'readable-stream',
      version: '2.3.8',
      dependencies: { string_decoder: '~1.1.1' },
    }));

    const sourceStringDecoder = path.join(
      repoRoot,
      'node_modules',
      '.pnpm',
      'string_decoder@1.1.1',
      'node_modules',
      'string_decoder',
    );
    mkdirSync(path.join(sourceStringDecoder, 'lib'), { recursive: true });
    writeFileSync(path.join(sourceStringDecoder, 'package.json'), JSON.stringify({
      name: 'string_decoder',
      version: '1.1.1',
      dependencies: { 'safe-buffer': '~5.1.0' },
    }));
    writeFileSync(path.join(sourceStringDecoder, 'lib', 'string_decoder.js'), 'exports.StringDecoder = function() {};');

    const sourceSafeBuffer = path.join(
      repoRoot,
      'node_modules',
      '.pnpm',
      'safe-buffer@5.1.2',
      'node_modules',
      'safe-buffer',
    );
    mkdirSync(sourceSafeBuffer, { recursive: true });
    writeFileSync(path.join(sourceSafeBuffer, 'package.json'), JSON.stringify({
      name: 'safe-buffer',
      version: '5.1.2',
    }));
    writeFileSync(path.join(sourceSafeBuffer, 'index.js'), 'module.exports = Buffer;');

    materializeStandaloneAssets(appDir);

    const bundledStringDecoder = path.join(appDir, '.next', 'standalone', 'node_modules', 'string_decoder');
    expect(JSON.parse(readFileSync(path.join(bundledStringDecoder, 'package.json'), 'utf-8')).name).toBe('string_decoder');
    expect(existsSync(path.join(bundledStringDecoder, 'packages'))).toBe(false);
    expect(existsSync(path.join(bundledStringDecoder, 'lib', 'string_decoder.js'))).toBe(true);
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

  it('does not materialize optional Next peer dependencies into the runtime', () => {
    const appDir = makeTemp('mindos-app-next-optional-peer-deps-');
    writeStandaloneApp(appDir);

    const sourceNext = path.join(appDir, 'node_modules', 'next');
    const standaloneNext = path.join(appDir, '.next', 'standalone', 'node_modules', 'next');
    for (const packageDir of [sourceNext, standaloneNext]) {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
        name: 'next',
        version: '16.1.6',
        peerDependencies: { '@playwright/test': '^1.51.1' },
        peerDependenciesMeta: { '@playwright/test': { optional: true } },
      }));
      writeFileSync(path.join(packageDir, 'index.js'), 'module.exports = {};');
    }

    const sourcePlaywright = path.join(appDir, 'node_modules', '@playwright', 'test');
    mkdirSync(sourcePlaywright, { recursive: true });
    writeFileSync(path.join(sourcePlaywright, 'package.json'), JSON.stringify({
      name: '@playwright/test',
      version: '1.51.1',
    }));

    materializeStandaloneAssets(appDir);

    expect(existsSync(path.join(appDir, '.next', 'standalone', 'node_modules', '@playwright', 'test'))).toBe(false);
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

  it('materializes Turbopack hashed externals as real directories (not symlinks)', () => {
    const src = makeTemp('mindos-src-hashed-');
    const dest = path.join(makeTemp('mindos-dest-hashed-'), 'app');
    const hashed = '@mariozechner/pi-agent-core-805d1afb58d9a138';
    const originalDir = path.join(src, '.next', 'standalone', 'node_modules', '@mariozechner', 'pi-agent-core');
    const chunksDir = path.join(src, '.next', 'standalone', '.next', 'server', 'chunks');

    mkdirSync(path.join(originalDir, 'dist'), { recursive: true });
    writeFileSync(path.join(originalDir, 'package.json'), '{"name":"@mariozechner/pi-agent-core","main":"dist/index.js"}');
    writeFileSync(path.join(originalDir, 'dist', 'index.js'), 'module.exports = 1;');
    mkdirSync(chunksDir, { recursive: true });
    writeFileSync(path.join(chunksDir, 'page.js'), `module.exports = require("${hashed}");`);

    copyAppForBundledRuntime(src, dest);

    const hashedDir = path.join(dest, '.next', 'standalone', 'node_modules', '@mariozechner', 'pi-agent-core-805d1afb58d9a138');
    // Real directory copy: survives the desktop symlink sweep, works on Windows,
    // and keeps subpath requires (pkg-<hash>/dist/x) resolvable
    expect(lstatSync(hashedDir).isDirectory()).toBe(true);
    expect(lstatSync(hashedDir).isSymbolicLink()).toBe(false);
    expect(readFileSync(path.join(hashedDir, 'dist', 'index.js'), 'utf-8')).toBe('module.exports = 1;');
    expect(readFileSync(path.join(hashedDir, 'package.json'), 'utf-8')).toContain('pi-agent-core');
  });
});
