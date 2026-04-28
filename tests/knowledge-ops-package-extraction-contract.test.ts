import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

function readText(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf-8');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readText(relativePath)) as T;
}

describe('knowledge operation package extraction contract', () => {
  it('defines knowledge operations as a pure internal product module', () => {
    const source = readText('packages/mindos/src/knowledge/knowledge-ops/index.ts');

    expect(source).not.toMatch(/from ['"]next\//);
    expect(source).not.toMatch(/from ['"]@\//);
    expect(source).not.toMatch(/from ['"].*components/);
    expect(existsSync(resolve(root, 'packages/knowledge/knowledge-ops'))).toBe(false);
    expect(existsSync(resolve(root, 'packages/mindos/src/knowledge/knowledge-ops/index.test.ts'))).toBe(true);
  });

  it('keeps the Web file route as the Next.js adapter over the runtime facade', () => {
    const adapter = readText('packages/web/app/api/file/operation-kernel.ts');
    const webPkg = readJson<{ dependencies?: Record<string, string> }>('packages/web/package.json');

    expect(webPkg.dependencies?.['@geminilight/mindos']).toBe('workspace:*');
    expect(webPkg.dependencies?.['@mindos/knowledge-ops']).toBeUndefined();
    expect(adapter).toContain("from '@geminilight/mindos'");
    expect(adapter).toContain('executeKernel');
    expect(adapter).not.toContain('evaluatePermission');
    expect(adapter).not.toContain('TREE_CHANGING_OPS');
  });

  it('builds the product package before building the Web app for release surfaces', () => {
    const rootPkg = readJson<{ scripts?: Record<string, string>; files?: string[] }>('package.json');
    const productPkg = readJson<{ scripts?: Record<string, string>; files?: string[] }>('packages/mindos/package.json');
    const publishNpm = readText('.github/workflows/publish-npm.yml');
    const publishRuntime = readText('.github/workflows/publish-runtime.yml');
    const buildDesktop = readText('.github/workflows/build-desktop.yml');

    expect(rootPkg.private).toBe(true);
    expect(productPkg.files).toEqual(expect.arrayContaining([
      'dist/',
      'src/cli.js',
    ]));
    expect(productPkg.scripts?.prepack).not.toContain('@mindos/knowledge-ops');
    expect(productPkg.scripts?.prepack).toContain('pnpm --filter @geminilight/mindos build');
    expect(publishNpm).not.toContain('@mindos/knowledge-ops');
    expect(publishNpm).toContain('pnpm --filter @geminilight/mindos build');
    expect(publishRuntime).not.toContain('@mindos/knowledge-ops');
    expect(publishRuntime).toContain('pnpm --filter @geminilight/mindos build');
    expect(buildDesktop).not.toContain('@mindos/knowledge-ops');
    expect(buildDesktop).toContain('pnpm --filter @geminilight/mindos build');
  });
});
