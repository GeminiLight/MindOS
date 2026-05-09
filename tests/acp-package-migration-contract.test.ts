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
  it('internalizes ACP core under the product package', () => {
    expect(existsSync(resolve(root, 'packages/protocols/acp/package.json'))).toBe(false);
    for (const file of ['types.ts', 'agent-descriptors.ts', 'registry.ts', 'detect-local.ts', 'subprocess.ts', 'session.ts', 'index.ts']) {
      expect(existsSync(resolve(root, 'packages/mindos/src/protocols/acp', file)), `${file} should exist in packages/mindos/src/protocols/acp`).toBe(true);
    }
  });

  it('publishes ACP through the product package and wires Web through the product facade', () => {
    const productPkg = readJson<{ files?: string[]; scripts?: Record<string, string> }>('packages/mindos/package.json');
    const webPkg = readJson<{ dependencies?: Record<string, string> }>('packages/web/package.json');

    expect(productPkg.files?.some((entry) => entry.startsWith('packages/protocols/acp'))).toBe(false);
    expect(productPkg.files).not.toContain('packages/protocols/acp/src/');
    expect(productPkg.files).not.toContain('packages/protocols/acp/tsconfig.json');
    expect(productPkg.scripts?.prepack).not.toContain('@mindos/acp');
    expect(webPkg.dependencies).not.toHaveProperty('@mindos/acp');
  });

  it('keeps Web ACP code as adapters instead of duplicated protocol core', () => {
    const webAcpIndex = readText('packages/web/lib/acp/index.ts');
    expect(webAcpIndex).toContain("from '@geminilight/mindos/protocols/acp'");

    for (const coreFile of ['types.ts', 'agent-descriptors.ts', 'registry.ts', 'detect-local.ts', 'subprocess.ts', 'session.ts']) {
      const content = readText(`packages/web/lib/acp/${coreFile}`);
      expect(content.trim(), `packages/web/lib/acp/${coreFile} should be a thin adapter`).toMatch(/^export /);
      expect(content, `packages/web/lib/acp/${coreFile} should not duplicate protocol implementation`).not.toContain('@agentclientprotocol/sdk');
    }
  });
});
