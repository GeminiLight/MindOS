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
  it('uses packages/protocols/mcp-server as the MCP source package', () => {
    const pkg = readJson<{ name: string; scripts?: Record<string, string> }>(
      'packages/protocols/mcp-server/package.json'
    );

    expect(pkg.name).toBe('@mindos/mcp-server');
    expect(pkg.scripts?.build).toContain('src/index.ts');
    expect(existsSync(resolve(root, 'packages/protocols/mcp-server/src/index.ts'))).toBe(true);
  });

  it('does not publish the legacy top-level mcp directory as source of truth', () => {
    const productPkg = readJson<{
      files?: string[];
      scripts?: Record<string, string>;
    }>('packages/mindos/package.json');
    const npmignore = readText('.npmignore');

    expect(productPkg.files).toEqual(
      expect.arrayContaining([
        'packages/protocols/mcp-server/dist/',
        'packages/protocols/mcp-server/package.json',
      ])
    );
    expect(productPkg.files).not.toContain('mcp/');
    expect(productPkg.files).not.toContain('packages/protocols/mcp-server/src/');
    expect(productPkg.files).not.toContain('packages/protocols/mcp-server/tsconfig.json');
    expect(productPkg.scripts?.prepack).toContain('pnpm --filter @mindos/mcp-server build');
    expect(productPkg.scripts?.prepack).not.toContain('cd mcp');
    expect(npmignore).toMatch(/^packages\/protocols\/mcp-server\/node_modules\/$/m);
  });

  it('routes CLI MCP build helpers through packages/protocols/mcp-server', () => {
    const mcpBuild = readText('packages/mindos/bin/lib/mcp-build.js');
    const mcpSpawn = readText('packages/mindos/bin/lib/mcp-spawn.js');
    const mcpCommand = readText('packages/mindos/bin/commands/mcp-cmd.js');

    expect(mcpBuild).toContain("'packages', 'protocols', 'mcp-server'");
    expect(mcpSpawn).not.toContain("resolve(ROOT, 'mcp')");
    expect(mcpCommand).not.toContain("resolve(ROOT, 'mcp')");
  });
});
