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

describe('product npm publish contract', () => {
  it('keeps the repository root as a private monorepo package', () => {
    const rootPkg = readJson<{
      private?: boolean;
      bin?: Record<string, string>;
      files?: string[];
      scripts?: Record<string, string>;
    }>('package.json');

    expect(rootPkg.private).toBe(true);
    expect(rootPkg.bin).toBeUndefined();
    expect(rootPkg.files).toBeUndefined();
    expect(rootPkg.scripts?.prepack).toBeUndefined();
    expect(rootPkg.scripts?.dev).toContain('packages/mindos/bin/cli.js dev');
  });

  it('exposes the mindos CLI from packages/mindos as the product package', () => {
    const pkg = readJson<{
      name?: string;
      private?: boolean;
      bin?: Record<string, string>;
      files?: string[];
      scripts?: Record<string, string>;
    }>('packages/mindos/package.json');

    expect(pkg.name).toBe('@geminilight/mindos');
    expect(pkg.private).not.toBe(true);
    expect(pkg.bin).toEqual({ mindos: 'bin/cli.js' });
    expect(pkg.files).toEqual(
      expect.arrayContaining([
        'bin/',
        'packages/protocols/acp/dist/',
        'dist/',
        'src/cli.js',
        'src/cli.d.ts',
        'packages/protocols/mcp-server/dist/',
        'scripts/',
        'assets/',
        'skills/',
        'templates/',
        '_standalone/',
        'README.md',
        'README_zh.md',
        'LICENSE',
      ])
    );
    expect(pkg.files).not.toContain('packages/web/');
    expect(pkg.files).not.toContain('packages/protocols/acp/src/');
    expect(pkg.files).not.toContain('packages/protocols/acp/tsconfig.json');
    expect(pkg.files).not.toContain('packages/protocols/mcp-server/src/');
    expect(pkg.files).not.toContain('packages/protocols/mcp-server/tsconfig.json');
    expect(pkg.files).not.toContain('tsconfig.json');
    expect(pkg.files?.some((entry) => entry.startsWith('../'))).toBe(false);
    expect(pkg.files?.some((entry) => entry.startsWith('src/foundation/'))).toBe(false);
    expect(pkg.files?.some((entry) => entry.startsWith('src/knowledge/'))).toBe(false);
    expect(pkg.files?.some((entry) => entry.startsWith('packages/foundation/'))).toBe(false);
    expect(pkg.files?.some((entry) => entry.startsWith('packages/knowledge/'))).toBe(false);
    expect(pkg.scripts?.prepack).toEqual(expect.stringContaining('packages/web'));
    expect(pkg.scripts?.prepack).toEqual(expect.stringContaining('@mindos/mcp-server'));
    expect(pkg.scripts?.prepack).toEqual(expect.stringContaining('@mindos/acp'));
    expect(pkg.scripts?.prepack).toEqual(expect.stringContaining('@geminilight/mindos'));
    expect(pkg.scripts?.prepack).toEqual(expect.stringContaining('node scripts/clean-product-stage.mjs --include-package-docs'));
    expect(pkg.scripts?.postpack).toBe('cd ../.. && node scripts/clean-product-stage.mjs --include-package-docs');
    expect(pkg.scripts?.prepack).not.toContain('rm -rf packages/mindos/_standalone');
    expect(pkg.scripts?.prepack).not.toEqual(expect.stringContaining('@mindos/shared'));
    expect(pkg.scripts?.prepack).not.toEqual(expect.stringContaining('@mindos/errors'));
    expect(pkg.scripts?.prepack).not.toEqual(expect.stringContaining('@mindos/core'));
    expect(pkg.scripts?.prepack).not.toEqual(expect.stringContaining('@mindos/security'));
    expect(pkg.scripts?.prepack).not.toEqual(expect.stringContaining('@mindos/permissions'));
    expect(pkg.scripts?.prepack).not.toEqual(expect.stringContaining('@mindos/audit'));
    expect(pkg.scripts?.prepack).not.toEqual(expect.stringContaining('@mindos/git'));
    expect(pkg.scripts?.prepack).not.toEqual(expect.stringContaining('@mindos/knowledge-ops'));
    expect(pkg.scripts?.prepack).not.toContain('packages/protocols/acp/node_modules');
    expect(pkg.scripts?.prepack).not.toContain('packages/foundation/shared/node_modules');
    expect(pkg.scripts?.prepack).not.toContain('packages/foundation/errors/node_modules');
    expect(pkg.scripts?.prepack).not.toContain('packages/foundation/security/node_modules');
    expect(pkg.scripts?.prepack).not.toContain('packages/foundation/permissions/node_modules');
    expect(pkg.scripts?.prepack).not.toContain('packages/knowledge/knowledge-ops/node_modules');
    expect(pkg.scripts?.prepack).not.toContain('packages/mindos/node_modules');
    expect(pkg.scripts?.prepack).not.toContain('packages/protocols/mcp-server/node_modules');
    expect(pkg.scripts?.prepack).not.toContain('packages/web/node_modules');
    expect(pkg.scripts?.build).toBe('tsc');
    expect(pkg.scripts?.['type-check']).toBe('tsc --noEmit');
  });

  it('keeps product staging cleanup explicit and source-safe', () => {
    const rootPkg = readJson<{ scripts?: Record<string, string> }>('package.json');
    const cleanup = readText('scripts/clean-product-stage.mjs');

    expect(rootPkg.scripts?.['clean:product-stage']).toBe('node scripts/clean-product-stage.mjs --include-package-docs');
    expect(cleanup).toContain('STAGED_PRODUCT_PATHS');
    expect(cleanup).toContain("'packages/mindos/apps'");
    expect(cleanup).toContain("'packages/mindos/packages'");
    expect(cleanup).toContain("'packages/mindos/_standalone'");
    expect(cleanup).toContain('PACKAGE_DOC_PATHS');
    expect(cleanup).toContain("'packages/mindos/README.md'");
    expect(cleanup).toContain('assertInsideProductRoot');
    expect(cleanup).not.toContain("'packages/mindos/src'");
    expect(cleanup).not.toContain("'packages/mindos/bin'");
    expect(cleanup).not.toContain("'packages/mindos/dist'");
    expect(cleanup).not.toContain("'packages/mindos/package.json'");
    expect(cleanup).not.toContain("'packages/mindos/node_modules'");
  });

  it('does not exclude v1 runtime artifacts from the npm tarball', () => {
    const npmignore = readText('.npmignore');

    expect(npmignore).not.toMatch(/^apps\/$/m);
    expect(npmignore).not.toMatch(/^packages\/$/m);
    expect(npmignore).not.toMatch(/^packages\/protocols\/mcp-server\/dist\//m);
  });

  it('keeps generated dependency directories out of source package entries', () => {
    const appNpmignore = readText('packages/web/.npmignore');
    const stageScript = readText('scripts/stage-product-package.mjs');

    expect(appNpmignore).toMatch(/^node_modules\/$/m);
    expect(appNpmignore).toMatch(/^\.next\/$/m);
    expect(appNpmignore).toMatch(/^__tests__\/$/m);
    expect(appNpmignore).toMatch(/^vitest\.config\.ts$/m);
    expect(appNpmignore).toMatch(/^eslint\.config\.mjs$/m);
    expect(appNpmignore).toMatch(/^tsconfig\.tsbuildinfo$/m);
    expect(stageScript).not.toContain("copyTree('packages/web', 'packages/web')");
    expect(stageScript).toContain("copyBuiltPackage('packages/protocols/acp')");
    expect(stageScript).toContain("copyBuiltPackage('packages/protocols/mcp-server')");
    expect(stageScript).not.toContain("copyTree('packages/protocols/acp', 'packages/protocols/acp')");
    expect(stageScript).not.toContain("copyTree('packages/protocols/mcp-server', 'packages/protocols/mcp-server')");
    expect(stageScript).not.toContain('rewriteStagedWebWorkspaceDependencies');
  });

  it('copies standalone builds with dereferenced dependencies for npm packing', () => {
    const prepareStandalone = readText('scripts/prepare-standalone.mjs');
    const buildLib = readText('packages/mindos/bin/lib/build.js');
    const startCommand = readText('packages/mindos/bin/commands/start.js');

    expect(prepareStandalone).toContain('dereference: true');
    expect(prepareStandalone).toContain('__node_modules');
    expect(prepareStandalone).toContain('__next');
    expect(prepareStandalone).toContain('packages/mindos/_standalone');
    expect(prepareStandalone).toContain('prunePackageLocks');
    expect(prepareStandalone).toContain('package-lock.json');
    expect(buildLib).toContain('__next');
    expect(startCommand).toContain('__next');
    expect(prepareStandalone).not.toContain('rm -rf _standalone/node_modules');
    expect(existsSync(resolve(root, 'packages/web/.npmignore'))).toBe(true);
  });

  it('documents the OpenCode-style artifact-only Web runtime direction', () => {
    const spec = readText('wiki/specs/spec-opencode-style-web-runtime.md');

    expect(spec).toContain('packages/web');
    expect(spec).toContain('唯一 Web 源码');
    expect(spec).toContain('_standalone');
    expect(spec).toContain('artifact-only');
    expect(spec).toContain('第二阶段');
    expect(spec).toContain('Next API routes');
  });

  it('keeps Web production builds independent from external font networks', () => {
    const layout = readText('packages/web/app/layout.tsx');
    const globals = readText('packages/web/app/globals.css');

    expect(layout).not.toContain('next/font/google');
    expect(globals).toContain('--font-inter:');
    expect(globals).toContain('--font-ibm-plex-sans:');
    expect(globals).toContain('--font-ibm-plex-mono:');
    expect(globals).toContain('--font-lora:');
  });
});
