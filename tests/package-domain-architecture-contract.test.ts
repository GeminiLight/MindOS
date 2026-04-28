import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');

const domains = {
  retrieval: ['search', 'vector', 'indexer', 'api'],
  protocols: ['acp', 'mcp-server'],
} as const;

const internalizedDomains = ['foundation', 'knowledge'] as const;

const topLevelWorkspacePackages = [
  'mindos',
  'web',
  'desktop',
  'mobile',
  'browser-extension',
  'desktop-tauri',
] as const;

function readText(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

describe('package domain architecture contract', () => {
  it('keeps product and app packages at the OpenCode-style top level while domain libraries stay grouped', () => {
    const unexpectedFlatPackageJsons = readdirSync(resolve(root, 'packages'))
      .filter((entry) => statSync(resolve(root, 'packages', entry)).isDirectory())
      .filter((entry) => existsSync(resolve(root, 'packages', entry, 'package.json')))
      .filter((entry) => !topLevelWorkspacePackages.includes(entry as (typeof topLevelWorkspacePackages)[number]));

    expect(unexpectedFlatPackageJsons).toEqual([]);

    for (const productPackage of topLevelWorkspacePackages) {
      expect(
        existsSync(resolve(root, 'packages', productPackage, 'package.json')),
        `${productPackage} should live at packages/${productPackage}`,
      ).toBe(true);
    }
    expect(existsSync(resolve(root, 'packages/cli/package.json'))).toBe(false);
    expect(existsSync(resolve(root, 'packages/mindos/bin/cli.js'))).toBe(true);

    for (const domain of internalizedDomains) {
      expect(
        existsSync(resolve(root, 'packages', domain)),
        `${domain} should be internalized under packages/mindos/src/${domain}`,
      ).toBe(false);
      expect(
        existsSync(resolve(root, 'packages/mindos/src', domain)),
        `${domain} source should live inside packages/mindos/src/${domain}`,
      ).toBe(true);
    }

    for (const [domain, packageNames] of Object.entries(domains)) {
      for (const packageName of packageNames) {
        expect(
          existsSync(resolve(root, 'packages', domain, packageName, 'package.json')),
          `${packageName} should live under packages/${domain}/${packageName}`,
        ).toBe(true);
      }
    }
  });

  it('lets pnpm discover the product main package and nested domain packages', () => {
    const workspace = readText('pnpm-workspace.yaml');

    expect(workspace).toContain("'packages/mindos'");
    expect(workspace).toContain("'packages/*/*'");
  });

  it('keeps retrieval packages out of the Web direct dependency surface', () => {
    const webPackage = JSON.parse(readText('packages/web/package.json')) as {
      dependencies?: Record<string, string>;
    };

    expect(Object.keys(webPackage.dependencies ?? {})
      .filter((name) => name.startsWith('@mindos/') || name === '@geminilight/mindos')
      .sort()).toEqual([
      '@geminilight/mindos',
      '@mindos/acp',
    ]);

    expect(webPackage.dependencies).not.toHaveProperty('@mindos/indexer');
    expect(webPackage.dependencies).not.toHaveProperty('@mindos/search');
    expect(webPackage.dependencies).not.toHaveProperty('@mindos/vector');
    expect(webPackage.dependencies).not.toHaveProperty('@mindos/api');
  });

  it('keeps retrieval adapters on MindOS core contracts instead of redefining product types', () => {
    const adapterFiles = [
      'packages/retrieval/search/src/types.ts',
      'packages/retrieval/vector/src/types.ts',
      'packages/retrieval/indexer/src/types.ts',
      'packages/retrieval/indexer/src/chunker.ts',
    ];

    for (const file of adapterFiles) {
      const source = readText(file);
      expect(source, file).toContain('@geminilight/mindos/retrieval');
      expect(source, file).not.toMatch(/^export interface /m);
    }

    const productFacade = readText('packages/mindos/src/retrieval.ts');
    expect(productFacade).not.toContain('@mindos/search');
    expect(productFacade).not.toContain('@mindos/vector');
    expect(productFacade).not.toContain('@mindos/indexer');
    expect(productFacade).not.toContain('meilisearch');
    expect(productFacade).not.toContain('vectordb');
    expect(productFacade).not.toContain('express');
  });
});
