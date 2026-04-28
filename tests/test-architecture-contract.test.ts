import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

function listFiles(dir: string, relativeDir = ''): string[] {
  const ignoredDirs = new Set(['.git', 'node_modules', '.next', '.turbo', 'dist', 'dist-electron', 'dist-renderer', '_standalone']);
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      files.push(...listFiles(resolve(dir, entry.name), relativeDir ? `${relativeDir}/${entry.name}` : entry.name));
      continue;
    }

    if (entry.isFile()) {
      files.push(relativeDir ? `${relativeDir}/${entry.name}` : entry.name);
    }
  }

  return files.sort();
}

describe('test architecture contract', () => {
  it('documents the test placement standard in AGENTS.md', () => {
    const agentsGuide = readFileSync(resolve(root, 'AGENTS.md'), 'utf-8');

    expect(agentsGuide).toContain('#### 测试目录分层');
    expect(agentsGuide).toContain('packages/<domain>/<pkg>/src/*.test.ts');
    expect(agentsGuide).toContain('tests/integration/*.test.ts');
    expect(agentsGuide).toContain('index.test.ts');
  });

  it('keeps root test scripts mapped to explicit test layers', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.test).toBe('pnpm run test:contracts && pnpm run test:unit && turbo run test');
    expect(pkg.scripts?.['test:contracts']).toBe('vitest run tests/*.test.ts');
    expect(pkg.scripts?.['test:unit']).toBe('vitest run tests/unit/*.test.ts');
    expect(pkg.scripts?.['test:integration']).toBe('vitest run --config tests/integration/vitest.config.ts');
    expect(pkg.scripts?.['test:e2e']).toBe('playwright test -c tests/e2e/playwright.config.ts');
  });

  it('keeps the product package test script scoped to product source tests', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'packages/mindos/package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.test).toBe('vitest run --dir src');
  });

  it('keeps package index.test.ts only for single-module packages', () => {
    const genericPackageTests = listFiles(resolve(root, 'packages'))
      .filter((file) => /(^|\/)src\/index\.test\.[jt]sx?$/.test(file));
    const invalidGenericTests = genericPackageTests.filter((file) => {
      const [domainName, packageName] = file.split('/');
      const sourceFiles = listFiles(resolve(root, 'packages', domainName, packageName, 'src'))
        .filter((sourceFile) => /\.[jt]sx?$/.test(sourceFile))
        .filter((sourceFile) => !/\.d\.ts$/.test(sourceFile))
        .filter((sourceFile) => !/\.(test|spec)\.[jt]sx?$/.test(sourceFile));

      return sourceFiles.length > 1;
    });

    expect(invalidGenericTests).toEqual([]);
  });

  it('keeps generated test copies out of source test discovery', () => {
    const generatedTestCopies = listFiles(root)
      .filter((file) => /(^|\/)(\.next|_standalone|\.turbo)\//.test(file))
      .filter((file) => /(^|\/)(__tests__\/.*|.*\.(test|spec)\.[jt]sx?)$/.test(file));

    expect(generatedTestCopies).toEqual([]);
  });
});
