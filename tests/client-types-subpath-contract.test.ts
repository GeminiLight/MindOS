import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * `@geminilight/mindos/client-types` is the one types-only surface the client
 * shells consume. This contract keeps it types-only (so Metro / webpack never
 * bundle server code through it), keeps the Web / Mobile `types.ts` files
 * from growing hand copies again, and keeps the compile-time assertion files
 * inside each package's `tsc` program (spec-client-types-and-sse-parsers).
 */

const root = resolve(__dirname, '..');

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf-8');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

function listSourceFiles(relativeDir: string): string[] {
  const start = resolve(root, relativeDir);
  if (!existsSync(start)) return [];
  const ignored = new Set(['node_modules', '.expo', 'dist', '.next', '.turbo']);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) out.push(abs);
    }
  };
  walk(start);
  return out.sort();
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const CLIENT_TYPES_SOURCE = 'packages/mindos/src/client-types.ts';

describe('client-types subpath contract', () => {
  it('exports ./client-types from dist with matching types and import conditions', () => {
    const pkg = readJson<{ exports?: Record<string, { types?: string; import?: string }>; files?: string[] }>(
      'packages/mindos/package.json',
    );
    expect(pkg.exports?.['./client-types']).toEqual({
      types: './dist/client-types.d.ts',
      import: './dist/client-types.js',
    });
    expect(pkg.files).toContain('dist/');
  });

  it('keeps the barrel to type-only re-exports of core modules', () => {
    const source = stripComments(read(CLIENT_TYPES_SOURCE));
    const statements = source
      .split(/;\s*/)
      .map((statement) => statement.trim())
      .filter(Boolean);

    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement, statement.slice(0, 80)).toMatch(/^export type \{[\s\S]*\} from '\.\/[^']+\.js'$/);
    }
    expect(source).not.toMatch(/^\s*import\s/m);
  });

  it('transpiles to an empty module so bundlers never pull server code through it', () => {
    const { outputText } = ts.transpileModule(read(CLIENT_TYPES_SOURCE), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        isolatedModules: true,
      },
      fileName: 'client-types.ts',
    });
    const emitted = stripComments(outputText).trim();
    expect(emitted).toBe('export {};');

    const dist = resolve(root, 'packages/mindos/dist/client-types.js');
    if (existsSync(dist)) {
      const built = stripComments(readFileSync(dist, 'utf-8')).trim();
      expect(built).toBe('export {};');
    }
  });

  it('keeps Web and Mobile from redeclaring the client-types payload shapes', () => {
    const localDeclaration = /^export (?:interface|type) ((?:AgentRuntime|RuntimeSession|RuntimeControlPlane|Acp|AgentRun)[A-Za-z]*)\b/gm;
    const allowed = {
      'packages/web/lib/types.ts': new Set([
        // Web-only compositions that are not wire payloads of the product server.
        'AgentRuntimeIdentity',
        'AgentRuntimeAdapterProjectionFacetBase',
        'AcpRuntimeOptions',
        'RuntimeSessionKind',
        'RuntimeSessionBinding',
      ]),
      'packages/mobile/lib/types.ts': new Set([
        // Mobile renders a trimmed view of the descriptor; assignability is asserted in types.test-d.ts.
        'AgentRuntimeIdentity',
        'AgentRuntimeDescriptor',
        'AgentRuntimesResponse',
        'AgentRunsResponse',
        'AgentRunCapsuleRecoveryAction',
        'AgentRunCapsuleRecoveryCapability',
        'AgentRunCapsuleProjection',
      ]),
    };

    for (const [file, whitelist] of Object.entries(allowed)) {
      const source = read(file);
      const offenders = [...source.matchAll(localDeclaration)]
        .map((match) => match[1])
        .filter((name) => !whitelist.has(name));
      expect(offenders, file).toEqual([]);
      expect(source, file).toContain("from '@geminilight/mindos/client-types'");
    }
  });

  it('keeps the Mobile dependency on the product package types-only', () => {
    const pkg = readJson<{ dependencies?: Record<string, string> }>('packages/mobile/package.json');
    expect(pkg.dependencies?.['@geminilight/mindos']).toBe('workspace:*');

    const reference = /(?:import|export)\s+(type\s+)?[^;]*?from\s+['"](@geminilight\/mindos(?:\/[^'"]*)?)['"]/g;
    for (const dir of ['packages/mobile/app', 'packages/mobile/lib', 'packages/mobile/components', 'packages/mobile/hooks']) {
      for (const file of listSourceFiles(dir)) {
        const source = stripComments(readFileSync(file, 'utf-8'));
        for (const match of source.matchAll(reference)) {
          const label = `${file.slice(root.length + 1)}: ${match[0].replace(/\s+/g, ' ')}`;
          expect(match[1], label).toBe('type ');
          expect(match[2], label).toBe('@geminilight/mindos/client-types');
        }
        expect(source, file.slice(root.length + 1)).not.toMatch(/require\(['"]@geminilight\/mindos/);
      }
    }
  });

  it('keeps the compile-time assertion files inside each package tsc program', () => {
    for (const [file, tsconfigPath] of [
      ['packages/web/lib/types.test-d.ts', 'packages/web/tsconfig.json'],
      ['packages/mobile/lib/types.test-d.ts', 'packages/mobile/tsconfig.json'],
    ]) {
      const source = read(file);
      const assertions = source.match(/Expect</g) ?? [];
      expect(assertions.length, file).toBeGreaterThanOrEqual(10);
      expect(source, file).toContain("from '@geminilight/mindos/client-types'");

      const tsconfig = readJson<{ include?: string[]; exclude?: string[] }>(tsconfigPath);
      expect(tsconfig.include, tsconfigPath).toContain('**/*.ts');
      expect(tsconfig.exclude ?? [], tsconfigPath).not.toContain('lib');
      expect((tsconfig.exclude ?? []).some((entry) => entry.includes('test-d')), tsconfigPath).toBe(false);
    }
  });
});
