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

describe('ACP package migration contract', () => {
  it('uses packages/protocols/acp as the ACP core source package', () => {
    const pkg = readJson<{ name: string; scripts?: Record<string, string>; dependencies?: Record<string, string> }>(
      'packages/protocols/acp/package.json'
    );

    expect(pkg.name).toBe('@mindos/acp');
    expect(pkg.scripts?.build).toBe('tsc');
    expect(pkg.dependencies).toHaveProperty('@agentclientprotocol/sdk');
    for (const file of ['types.ts', 'agent-descriptors.ts', 'registry.ts', 'detect-local.ts', 'subprocess.ts', 'session.ts', 'index.ts']) {
      expect(existsSync(resolve(root, 'packages/protocols/acp/src', file)), `${file} should exist in packages/protocols/acp/src`).toBe(true);
    }
  });

  it('publishes the ACP package and wires Web through the workspace package', () => {
    const productPkg = readJson<{ files?: string[]; scripts?: Record<string, string> }>('packages/mindos/package.json');
    const webPkg = readJson<{ dependencies?: Record<string, string> }>('packages/web/package.json');

    expect(productPkg.files).toEqual(
      expect.arrayContaining([
        'packages/protocols/acp/dist/',
        'packages/protocols/acp/package.json',
      ])
    );
    expect(productPkg.files).not.toContain('packages/protocols/acp/');
    expect(productPkg.files).not.toContain('packages/protocols/acp/src/');
    expect(productPkg.files).not.toContain('packages/protocols/acp/tsconfig.json');
    expect(productPkg.scripts?.prepack).toContain('pnpm --filter @mindos/acp build');
    expect(webPkg.dependencies?.['@mindos/acp']).toBe('workspace:*');
  });

  it('keeps Web ACP code as adapters instead of duplicated protocol core', () => {
    const webAcpIndex = readText('packages/web/lib/acp/index.ts');
    expect(webAcpIndex).toContain("from '@mindos/acp'");

    for (const coreFile of ['types.ts', 'agent-descriptors.ts', 'registry.ts', 'detect-local.ts', 'subprocess.ts', 'session.ts']) {
      const content = readText(`packages/web/lib/acp/${coreFile}`);
      expect(content.trim(), `packages/web/lib/acp/${coreFile} should be a thin adapter`).toMatch(/^export /);
      expect(content, `packages/web/lib/acp/${coreFile} should not duplicate protocol implementation`).not.toContain('@agentclientprotocol/sdk');
    }
  });
});
