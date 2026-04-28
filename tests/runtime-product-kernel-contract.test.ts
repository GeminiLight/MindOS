import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const mindosDir = resolve(root, 'packages/mindos');
const ignoredDirs = new Set([
  'node_modules',
  'dist',
  '.turbo',
  'coverage',
  '_standalone',
  'apps',
  'packages',
  'scripts',
  'assets',
  'skills',
  'templates',
]);

function listFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(abs));
      continue;
    }
    if (entry.isFile()) out.push(abs);
  }

  return out.sort();
}

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('MindOS runtime product kernel contract', () => {
  it('provides the product main package as a nested workspace package', () => {
    const manifestPath = resolve(mindosDir, 'package.json');
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: string;
      dependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
      scripts?: Record<string, string>;
    };

    expect(manifest.name).toBe('@geminilight/mindos');
    expect(manifest.scripts?.build).toBe('tsc');
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(['chokidar', 'pino', 'pino-pretty', 'zod']);
    expect(Object.keys(manifest.exports ?? {}).sort()).toEqual([
      '.',
      './capabilities',
      './cli',
      './foundation',
      './knowledge',
      './protocols',
      './retrieval',
    ]);
  });

  it('does not let the product main package depend on Web, React, Next, or protocol hosts', () => {
    const forbidden = [
      /from ['"](?:@\/|apps\/web|next(?:\/|['"])|react(?:\/|['"]))/,
      /require\(['"](?:@\/|apps\/web|next(?:\/|['"])|react(?:\/|['"]))/,
      /@mindos\/(?:acp|mcp-server)/,
    ];

    for (const file of listFiles(mindosDir).filter((entry) => /\.[cm]?[jt]sx?$/.test(entry))) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        expect(source, file).not.toMatch(pattern);
      }
    }
  });

  it('makes Web use the product main facade instead of low-level operation packages', () => {
    const operationKernel = read('packages/web/app/api/file/operation-kernel.ts');
    const webSecurity = read('packages/web/lib/core/security.ts');

    expect(operationKernel).toContain("from '@geminilight/mindos'");
    expect(operationKernel).not.toContain("from '@mindos/knowledge-ops'");
    expect(operationKernel).not.toContain("from '@mindos/permissions'");

    expect(webSecurity).toContain("from '@geminilight/mindos'");
    expect(webSecurity).not.toContain("from '@mindos/security'");
  });

  it('makes the CLI consume product command grouping from the main package', () => {
    const cli = read('packages/mindos/bin/cli.js');
    const productCli = read('packages/mindos/src/cli.js');

    expect(cli).toContain("from '../src/cli.js'");
    expect(cli).toContain('MINDOS_CORE_COMMANDS');
    expect(cli).toContain('MINDOS_ADDITIONAL_COMMANDS');
    expect(cli).toContain('createCommandRegistry');

    expect(productCli).toContain('MINDOS_CORE_COMMANDS');
    expect(productCli).toContain('MINDOS_ADDITIONAL_COMMANDS');
    expect(productCli).not.toMatch(/from ['"](?:@\/|apps\/web|next(?:\/|['"])|react(?:\/|['"]))/);
  });

  it('does not keep a separate CLI workspace competing with the product CLI', () => {
    const productPkg = JSON.parse(read('packages/mindos/package.json')) as {
      bin?: Record<string, string>;
      files?: string[];
    };
    const rootPkg = JSON.parse(read('package.json')) as {
      scripts?: Record<string, string>;
    };

    expect(existsSync(resolve(root, 'packages/cli'))).toBe(false);
    expect(productPkg.bin).toEqual({ mindos: 'bin/cli.js' });
    expect(productPkg.files).toContain('bin/');
    expect(rootPkg.scripts?.dev).toContain('packages/mindos/bin/cli.js dev');
    expect(rootPkg.scripts?.build).toContain('packages/mindos/bin/cli.js build');
  });

  it('owns foundation and knowledge capabilities behind product subpath exports', () => {
    const foundation = read('packages/mindos/src/foundation.ts');
    const knowledge = read('packages/mindos/src/knowledge.ts');
    const capabilities = read('packages/mindos/src/capabilities.ts');

    expect(foundation).toContain("from './foundation/shared/index.js'");
    expect(foundation).toContain("from './foundation/errors/index.js'");
    expect(foundation).toContain("from './foundation/core/index.js'");
    expect(foundation).toContain("from './foundation/config/index.js'");
    expect(foundation).toContain("from './foundation/logger/index.js'");
    expect(foundation).toContain("from './foundation/permissions/index.js'");
    expect(foundation).toContain("from './foundation/security/index.js'");

    expect(knowledge).toContain("from './knowledge/storage/index.js'");
    expect(knowledge).toContain("from './knowledge/spaces/index.js'");
    expect(knowledge).toContain("from './knowledge/graph/index.js'");
    expect(knowledge).toContain("from './knowledge/audit/index.js'");
    expect(knowledge).toContain("from './knowledge/git/index.js'");
    expect(knowledge).toContain("from './knowledge/knowledge-ops/index.js'");

    expect(capabilities).toContain("domain: 'foundation'");
    expect(capabilities).toContain("domain: 'knowledge'");
    expect(capabilities).toContain("domain: 'retrieval'");
    expect(capabilities).toContain("domain: 'protocols'");
    expect(capabilities).toContain("owner: '@geminilight/mindos'");
  });

  it('does not depend on internalized foundation or knowledge workspace packages', () => {
    const manifest = JSON.parse(read('packages/mindos/package.json')) as {
      dependencies?: Record<string, string>;
    };
    const source = listFiles(resolve(root, 'packages/mindos/src'))
      .filter((entry) => /\.[cm]?[jt]sx?$/.test(entry))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    expect(Object.keys(manifest.dependencies ?? {}).filter((dep) => dep.startsWith('@mindos/'))).toEqual([]);
    expect(source).not.toMatch(/from ['"]@mindos\/(?:shared|errors|core|config|logger|permissions|security|storage|spaces|graph|audit|git|knowledge-ops)['"]/);
    expect(existsSync(resolve(root, 'packages/foundation'))).toBe(false);
    expect(existsSync(resolve(root, 'packages/knowledge'))).toBe(false);
  });

  it('keeps retrieval optional and protocols as thin hosts owned by the product package', () => {
    const retrieval = read('packages/mindos/src/retrieval.ts');
    const protocols = read('packages/mindos/src/protocols.ts');

    expect(retrieval).toContain("loadMode: 'optional'");
    expect(retrieval).toContain('defaultRuntime: false');
    expect(retrieval).toContain("'keyword-search'");
    expect(retrieval).toContain("'vector-search'");
    expect(retrieval).not.toMatch(/from ['"]@mindos\/(?:api|indexer|search|vector)['"]/);

    expect(protocols).toContain("productLogicOwner: '@geminilight/mindos'");
    expect(protocols).toContain("transportRole: 'host'");
    expect(protocols).not.toMatch(/from ['"]@mindos\/(?:acp|mcp-server)['"]/);
  });
});
