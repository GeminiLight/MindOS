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

describe('MCP package migration contract', () => {
  it('internalizes the MCP server under the product package', () => {
    expect(existsSync(resolve(root, 'packages/protocols/mcp-server/package.json'))).toBe(false);
    expect(existsSync(resolve(root, 'packages/mindos/src/protocols/mcp-server/index.ts'))).toBe(true);
  });

  it('does not publish the legacy top-level mcp directory as source of truth', () => {
    const productPkg = readJson<{
      files?: string[];
      scripts?: Record<string, string>;
    }>('packages/mindos/package.json');
    const npmignore = readText('.npmignore');

    expect(productPkg.files?.some((entry) => entry.startsWith('packages/protocols/mcp-server'))).toBe(false);
    expect(productPkg.files).not.toContain('mcp/');
    expect(productPkg.files).not.toContain('packages/protocols/mcp-server/src/');
    expect(productPkg.files).not.toContain('packages/protocols/mcp-server/tsconfig.json');
    expect(productPkg.scripts?.prepack).not.toContain('@mindos/mcp-server');
    expect(productPkg.scripts?.prepack).not.toContain('cd mcp');
    expect(npmignore).toMatch(/^packages\/protocols\/mcp-server\/node_modules\/$/m);
  });

  it('routes CLI MCP build helpers through product-owned protocol runtime', () => {
    const mcpBuild = readText('packages/mindos/bin/lib/mcp-build.js');
    const mcpSpawn = readText('packages/mindos/bin/lib/mcp-spawn.js');
    const mcpCommand = readText('packages/mindos/bin/commands/mcp-cmd.js');

    expect(mcpBuild).toContain("'dist', 'protocols', 'mcp-server', 'index.cjs'");
    expect(mcpBuild).toContain("'src', 'protocols', 'mcp-server'");
    expect(mcpSpawn).not.toContain("resolve(ROOT, 'mcp')");
    expect(mcpCommand).not.toContain("resolve(ROOT, 'mcp')");
  });
});
