import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MINDOS_PRODUCT_RUNTIME_BOUNDARIES } from '../packages/mindos/src/capabilities';

const root = resolve(__dirname, '..');

const productRuntimeSubpaths = [
  '@geminilight/mindos/server',
  '@geminilight/mindos/client',
  '@geminilight/mindos/session',
  '@geminilight/mindos/agent',
  '@geminilight/mindos/tool',
  '@geminilight/mindos/plugin',
  '@geminilight/mindos/protocols',
] as const;

function readText(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf-8');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readText(relativePath)) as T;
}

function findPackageManifests(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.next', '.turbo', '_standalone'].includes(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findPackageManifests(abs));
    } else if (entry.isFile() && entry.name === 'package.json') {
      out.push(abs);
    }
  }

  return out.sort();
}

describe('OpenCode architecture quality goal contract', () => {
  it('documents subpath boundaries as the default instead of package splitting', () => {
    const spec = readText('wiki/specs/spec-opencode-architecture-quality-goal.md');

    for (const required of [
      'OpenCode Architecture Quality Goal',
      'Package / Subpath Graduation Rule',
      'Allowed Imports Matrix',
      'not a package split',
      '不是默认的 package split plan',
      '新增 package 前必须先证明 subpath boundary 不够用',
    ]) {
      expect(spec).toContain(required);
    }
  });

  it('keeps product runtime boundaries as public subpath exports on the product package', () => {
    const pkg = readJson<{ exports?: Record<string, unknown> }>('packages/mindos/package.json');
    const exportKeys = Object.keys(pkg.exports ?? {});

    for (const publicEntry of productRuntimeSubpaths) {
      const subpath = publicEntry.replace('@geminilight/mindos', '.');
      expect(exportKeys, publicEntry).toContain(subpath);
    }

    expect(MINDOS_PRODUCT_RUNTIME_BOUNDARIES.map((entry) => entry.publicEntry).sort()).toEqual(
      [...productRuntimeSubpaths].sort(),
    );

    for (const boundary of MINDOS_PRODUCT_RUNTIME_BOUNDARIES) {
      expect(boundary.owner).toBe('@geminilight/mindos');
      expect(boundary.defaultForm, boundary.publicEntry).toBe('subpath');
      expect(boundary.packageSplitDefault, boundary.publicEntry).toBe(false);
      expect(boundary.graduationRequired, boundary.publicEntry).toBe(true);
      expect(boundary.allowedImporters.length, boundary.publicEntry).toBeGreaterThan(0);
      expect(boundary.forbiddenImporters.length, boundary.publicEntry).toBeGreaterThan(0);
      expect(boundary.graduationCriteria.length, boundary.publicEntry).toBeGreaterThanOrEqual(2);
    }
  });

  it('does not introduce independent packages for product runtime subpath boundaries', () => {
    const packageNames = findPackageManifests(resolve(root, 'packages')).map((manifestPath) => {
      const pkg = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { name?: string };
      return pkg.name;
    });

    for (const forbidden of [
      '@geminilight/mindos-server',
      '@geminilight/mindos-client',
      '@geminilight/mindos-session',
      '@geminilight/mindos-agent',
      '@geminilight/mindos-tool',
      '@geminilight/mindos-plugin',
      '@geminilight/mindos-protocols',
      '@mindos/server',
      '@mindos/client',
      '@mindos/session',
      '@mindos/agent',
      '@mindos/tool',
      '@mindos/plugin',
      '@mindos/protocols',
    ]) {
      expect(packageNames, forbidden).not.toContain(forbidden);
    }

    for (const forbiddenDir of [
      'packages/server',
      'packages/client',
      'packages/session',
      'packages/agent',
      'packages/tool',
      'packages/plugin',
      'packages/protocols',
    ]) {
      expect(existsSync(resolve(root, forbiddenDir)), forbiddenDir).toBe(false);
    }
  });
});
