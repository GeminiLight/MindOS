import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(root, relativePath), 'utf-8')) as T;
}

describe('legacy top-level source cleanup contract', () => {
  it('keeps only v1 workspace app/package roots as active source directories', () => {
    for (const legacyDir of ['app', 'mcp', 'desktop', 'mobile']) {
      expect(existsSync(resolve(root, legacyDir)), `${legacyDir}/ should not exist`).toBe(false);
    }

    for (const activeDir of ['packages/web', 'packages/desktop', 'packages/mobile', 'packages/protocols/acp', 'packages/mindos/src/foundation/permissions', 'packages/protocols/mcp-server']) {
      expect(existsSync(resolve(root, activeDir)), `${activeDir}/ should exist`).toBe(true);
    }
  });

  it('does not publish legacy top-level source directories', () => {
    const pkg = readJson<{ files?: string[] }>('packages/mindos/package.json');

    expect(pkg.files).not.toEqual(expect.arrayContaining(['app/', 'mcp/', 'desktop/', 'mobile/', 'packages/web/']));
    expect(pkg.files).toEqual(
      expect.arrayContaining([
        '_standalone/',
        'packages/protocols/acp/dist/',
        'packages/protocols/acp/package.json',
        'dist/',
        'src/cli.js',
        'package.json',
        'packages/protocols/mcp-server/dist/',
        'packages/protocols/mcp-server/package.json',
      ])
    );
  });

  it('does not keep live source references to deleted top-level app code', () => {
    const sourceFiles = [
      'packages/web/lib/agent/skill-paths.ts',
      'packages/web/lib/agent/headless.ts',
      'packages/web/app/api/ask/route.ts',
      'packages/web/app/api/mcp/agents/route.ts',
      'packages/web/app/api/mcp/install/route.ts',
      'packages/web/app/api/agents/copy-skill/route.ts',
      'packages/web/app/api/skills/route.ts',
      'packages/web/lib/core/resolve-script.ts',
      'packages/mindos/bin/commands/update.js',
      'scripts/download-community-plugins.js',
      'tests/unit/custom-agents.test.ts',
    ];

    for (const file of sourceFiles) {
      const content = readFileSync(resolve(root, file), 'utf-8');
      expect(content, file).not.toContain("projectRoot, 'app'");
      expect(content, file).not.toContain("projRoot, 'app'");
      expect(content, file).not.toContain('../../app/lib');
      expect(content, file).not.toContain('app/data/skills');
      expect(content, file).not.toContain("newRoot, 'app'");
      expect(content, file).not.toContain("../app/__fixtures__");
    }
  });

  it('uses a single pnpm workspace lockfile instead of legacy npm lockfiles', () => {
    expect(existsSync(resolve(root, 'pnpm-workspace.yaml')), 'pnpm-workspace.yaml should exist').toBe(true);
    expect(existsSync(resolve(root, 'pnpm-lock.yaml')), 'pnpm-lock.yaml should exist').toBe(true);
    expect(existsSync(resolve(root, 'package-lock.json')), 'root package-lock.json should not exist').toBe(false);

    const packageLockFiles = findPackageLockFiles(root);
    expect(packageLockFiles).toEqual([]);
  });
});

function findPackageLockFiles(dir: string, relativeDir = ''): string[] {
  const ignoredDirs = new Set(['.git', 'node_modules', '.next', 'dist', 'dist-electron', 'dist-renderer', '_standalone']);
  const result: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      result.push(...findPackageLockFiles(resolve(dir, entry.name), relativeDir ? `${relativeDir}/${entry.name}` : entry.name));
      continue;
    }

    if (entry.isFile() && entry.name === 'package-lock.json') {
      result.push(relativeDir ? `${relativeDir}/package-lock.json` : 'package-lock.json');
    }
  }

  return result.sort();
}
