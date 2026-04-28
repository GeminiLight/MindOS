import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '..');
const ignoredDirs = new Set([
  'node_modules',
  '.next',
  '.expo',
  '.turbo',
  'dist',
  'build',
  'coverage',
  'dist-electron',
  'mindos-runtime',
]);

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(root, relativePath), 'utf-8')) as T;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
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

function listSourceFiles(relativeDir: string): string[] {
  return listFiles(resolve(root, relativeDir))
    .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
    .filter((file) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file));
}

function declaredMindosDeps(relativePackageJson: string): string[] {
  const pkg = readJson<{ dependencies?: Record<string, string> }>(relativePackageJson);
  return Object.keys(pkg.dependencies ?? {})
    .filter((name) => name.startsWith('@mindos/'))
    .sort();
}

function directMindosImports(relativeDir: string): string[] {
  const imports = new Set<string>();
  const importPattern = /(?:from\s+['"](@mindos\/[^/'"]+)(?:\/[^'"]*)?['"]|require\(['"](@mindos\/[^/'"]+)(?:\/[^'"]*)?['"]\))/g;

  for (const file of listSourceFiles(relativeDir)) {
    const text = readFileSync(file, 'utf-8');
    for (const match of text.matchAll(importPattern)) {
      imports.add(match[1] ?? match[2]);
    }
  }

  return [...imports].sort();
}

function packageDir(packageName: string): string {
  const packageDirs = listFiles(resolve(root, 'packages'))
    .filter((file) => file.endsWith('/package.json'))
    .filter((file) => !file.includes('/packages/mindos/apps/'))
    .filter((file) => !file.includes('/packages/mindos/packages/'))
    .filter((file) => !file.includes('/packages/mindos/scripts/'));

  for (const manifestPath of packageDirs) {
    const pkg = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { name?: string };
    if (pkg.name === packageName) return manifestPath.slice(root.length + 1, -'/package.json'.length);
  }

  return packageName.replace('@mindos/', 'packages/');
}

function workspaceDependencyClosure(packageNames: string[]): string[] {
  const queue = [...packageNames];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const packageName = queue.shift();
    if (!packageName || seen.has(packageName)) continue;
    seen.add(packageName);

    const manifestPath = `${packageDir(packageName)}/package.json`;
    if (!existsSync(resolve(root, manifestPath))) continue;
    for (const dep of declaredMindosDeps(manifestPath)) queue.push(dep);
  }

  return [...seen].sort();
}

function rootFilesIncludesPackage(pkgFiles: string[] | undefined, packageName: string): boolean {
  const dir = packageDir(packageName);
  return Boolean(pkgFiles?.some((entry) => entry === `${dir}/` || entry.startsWith(`${dir}/`)));
}

describe('workspace package architecture contract', () => {
  it('keeps app workspace dependencies limited to directly imported packages', () => {
    for (const appDir of ['packages/web', 'packages/mobile', 'packages/desktop']) {
      expect(declaredMindosDeps(`${appDir}/package.json`), appDir).toEqual(directMindosImports(appDir));
    }
  });

  it('publishes the workspace package closure needed by the Web app fallback sources', () => {
    const productPkg = readJson<{ files?: string[] }>('packages/mindos/package.json');
    const webWorkspaceClosure = workspaceDependencyClosure(directMindosImports('packages/web'));

    for (const packageName of webWorkspaceClosure) {
      expect(rootFilesIncludesPackage(productPkg.files, packageName), packageName).toBe(true);
    }
  });

  it('does not keep package debug probes as source files', () => {
    const debugFiles = listFiles(resolve(root, 'packages'))
      .map((file) => file.slice(root.length + 1))
      .filter((file) => /(^|\/)(test-debug\d*|test-pattern\d*)\.[cm]?js$/.test(file));

    expect(debugFiles).toEqual([]);
  });
});
