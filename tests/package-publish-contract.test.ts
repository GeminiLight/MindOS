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
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>('packages/mindos/package.json');

    expect(pkg.name).toBe('@geminilight/mindos');
    expect(pkg.private).not.toBe(true);
    expect(pkg.bin).toEqual({ mindos: 'bin/mindos-shim.cjs' });
    expect(pkg.files).toEqual(
      expect.arrayContaining([
        'bin/mindos-shim.cjs',
        'dist/',
        'src/cli.js',
        'src/cli.d.ts',
        'README.md',
        'README_zh.md',
        'LICENSE',
      ])
    );
    expect(pkg.files).not.toContain('_standalone/');
    expect(pkg.files).not.toContain('scripts/');
    expect(pkg.files).not.toContain('assets/');
    expect(pkg.files).not.toContain('skills/');
    expect(pkg.files).not.toContain('templates/');
    expect(pkg.files).not.toContain('packages/web/');
    expect(pkg.files?.some((entry) => entry.startsWith('packages/protocols/'))).toBe(false);
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
    expect(pkg.scripts?.prepack).toEqual(expect.stringContaining('@geminilight/mindos'));
    expect(pkg.scripts?.prepack).not.toEqual(expect.stringContaining('@mindos/web'));
    expect(pkg.scripts?.prepack).not.toEqual(expect.stringContaining('prepare-standalone'));
    expect(pkg.scripts?.prepack).not.toEqual(expect.stringContaining('packages/web'));
    expect(pkg.scripts?.prepack).not.toEqual(expect.stringContaining('@mindos/mcp-server'));
    expect(pkg.scripts?.prepack).not.toEqual(expect.stringContaining('@mindos/acp'));
    expect(pkg.scripts?.prepack).toEqual(expect.stringContaining('node scripts/clean-product-stage.mjs --include-package-docs --keep-standalone'));
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
    expect(pkg.scripts?.build).toBe('tsc && pnpm run build:protocols');
    expect(pkg.scripts?.['build:protocols']).toBe('node ../../scripts/build-product-protocols.mjs');
    expect(pkg.scripts?.['type-check']).toBe('tsc --noEmit');
    expect(pkg.dependencies).not.toHaveProperty('@anthropic-ai/claude-agent-sdk');
    expect(pkg.devDependencies).toHaveProperty('@anthropic-ai/claude-agent-sdk');
  });

  it('ships the sunk agent core modules inside the publish closure', () => {
    const pkg = readJson<{
      files?: string[];
      dependencies?: Record<string, string>;
      exports?: Record<string, { types?: string; import?: string }>;
    }>('packages/mindos/package.json');

    // dist/ is whitelisted wholesale, so the compiled agent modules ship as
    // long as the exports map routes the subpaths into dist.
    expect(pkg.files).toContain('dist/');
    expect(pkg.exports?.['./agent']).toEqual({
      types: './dist/agent.d.ts',
      import: './dist/agent.js',
    });
    expect(pkg.exports?.['./agent/*']).toEqual({
      types: './dist/agent/*.d.ts',
      import: './dist/agent/*.js',
    });

    // Modules sunk from packages/web/lib/agent (spec-agent-core-consolidation).
    // A missing source file here means the web shim re-exports a dangling
    // subpath and npx runs die with MODULE_NOT_FOUND.
    for (const module of [
      'run-ledger-types',
      'agent-run-context',
      'file-write-lock',
      'result-reducer',
      'permission-policy',
      'global-state',
      'redaction',
      'run-ledger',
      'run-cancellation',
      'runtime-permission-bridge',
      'user-question-bridge',
      'line-diff',
      'paragraph-extract',
      'kb-tools',
      'kb-extension',
      'capability-registry',
      'subagent-orchestrator',
      'subagent-ledger-extension',
      'stream-consumer',
      'stream-message-types',
    ]) {
      expect(existsSync(resolve(root, `packages/mindos/src/agent/${module}.ts`))).toBe(true);
    }

    // kb-tools value-imports TypeBox schemas at runtime — it must be a real
    // dependency, not a devDependency, or npx installs crash on import.
    expect(pkg.dependencies).toHaveProperty('@sinclair/typebox');
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
    expect(stageScript).not.toContain("copyBuiltPackage('packages/protocols/acp')");
    expect(stageScript).not.toContain("copyBuiltPackage('packages/protocols/mcp-server')");
    expect(stageScript).not.toContain("copyTree('packages/protocols/acp', 'packages/protocols/acp')");
    expect(stageScript).not.toContain("copyTree('packages/protocols/mcp-server', 'packages/protocols/mcp-server')");
    expect(stageScript).not.toContain('rewriteStagedWebWorkspaceDependencies');
  });

  it('copies standalone builds with dereferenced dependencies for npm packing', () => {
    const prepareStandalone = readText('scripts/prepare-standalone.mjs');
    const buildLib = readText('packages/mindos/bin/lib/build.js');
    const startCommand = readText('packages/mindos/bin/commands/start.js');
    const nextConfig = readText('packages/web/next.config.ts');
    const runtimeHealthContract = readText('packages/desktop/runtime-health-contract.json');

    expect(prepareStandalone).toContain('dereference: true');
    expect(prepareStandalone).toContain('__node_modules');
    expect(prepareStandalone).toContain('__next');
    expect(prepareStandalone).toContain('packages/mindos/_standalone');
    expect(prepareStandalone).toContain('prunePackageLocks');
    expect(prepareStandalone).toContain('pruneStandalonePayload');
    expect(prepareStandalone).toContain('pruneRuntimeNodeModules');
    expect(prepareStandalone).toContain('pruneClaudeAgentSdkNativePackages');
    expect(prepareStandalone).toContain('copyRuntimeDependencyClosure');
    expect(prepareStandalone).toContain('extract-pdf.cjs');
    expect(prepareStandalone).toContain('extract-docx.cjs');
    expect(prepareStandalone).toContain("'pdfjs-dist'");
    expect(prepareStandalone).toContain("'mammoth'");
    expect(prepareStandalone).toContain("'word-extractor'");
    expect(prepareStandalone).toContain("'@earendil-works/pi-coding-agent'");
    expect(prepareStandalone).toContain("'@earendil-works/pi-ai'");
    expect(prepareStandalone).toContain("'@sinclair/typebox'");
    expect(prepareStandalone).toContain("'partial-json'");
    expect(prepareStandalone).toContain("'openai'");
    expect(prepareStandalone).toContain('package-lock.json');
    expect(prepareStandalone).toContain('tsconfig.tsbuildinfo');
    expect(prepareStandalone).toContain("'.map'");
    expect(prepareStandalone).toContain("'@types'");
    expect(prepareStandalone).not.toContain("    'scripts',\n    'styles',");
    expect(buildLib).toContain('__next');
    expect(buildLib).toContain('pdfjs-dist');
    expect(buildLib).toContain('word-extractor');
    expect(nextConfig).toContain('./node_modules/mammoth/**');
    expect(nextConfig).toContain('./node_modules/word-extractor/**');
    expect(runtimeHealthContract).toContain('"docx-runtime"');
    expect(startCommand).toContain('__next');
    expect(prepareStandalone).not.toContain('rm -rf _standalone/node_modules');
    expect(existsSync(resolve(root, 'packages/web/.npmignore'))).toBe(true);
  });

  it('standalone verification exercises server-rendered Web pages, not only health', () => {
    const verifyStandalone = readText('scripts/verify-standalone.mjs');

    expect(verifyStandalone).toContain('createTcpServer');
    expect(verifyStandalone).toContain("server.listen(0, '127.0.0.1'");
    expect(verifyStandalone).not.toContain('31000 + Math.floor(Math.random() * 5000)');
    expect(verifyStandalone).toMatch(/waitHttpOk\(\s*'\/',\s*30_000/);
    expect(verifyStandalone).toContain('options.maxRedirects ?? 0');
    expect(verifyStandalone).toContain('redirectStatusCodes');
    expect(verifyStandalone).toContain('resolveLocalRedirect');
    expect(verifyStandalone).toContain('redirectUrl.origin !== localOrigin');
    expect(verifyStandalone).toContain('AUTH_TOKEN:');
    expect(verifyStandalone).toContain('WEB_PASSWORD:');
    expect(verifyStandalone).toContain('{ maxRedirects: 5 }');
    expect(verifyStandalone).toContain('/api/health');
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
