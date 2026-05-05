import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copyRuntimeDependencyClosure, runtimeDependencySeeds } from '../scripts/lib/runtime-dependency-closure.mjs';

const created: string[] = [];

function makeTemp(prefix: string) {
  const dir = path.join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  created.push(dir);
  return dir;
}

function writePackage(root: string, name: string, pkg: Record<string, unknown>) {
  const dir = path.join(root, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...pkg }), 'utf-8');
  writeFileSync(path.join(dir, 'index.js'), `export default ${JSON.stringify(name)};`, 'utf-8');
  return dir;
}

afterEach(() => {
  while (created.length) {
    const dir = created.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('runtime dependency closure', () => {
  it('keeps SSR external dependency seeds in one shared module', () => {
    expect(runtimeDependencySeeds).toContain('@mariozechner/pi-coding-agent');
    expect(runtimeDependencySeeds).toContain('@sinclair/typebox');
    expect(runtimeDependencySeeds).toContain('partial-json');
    expect(runtimeDependencySeeds).toContain('ajv');
    expect(runtimeDependencySeeds).toContain('ajv-formats');
  });

  it('copies required dependency and peer dependency closure into standalone node_modules', () => {
    const appDir = makeTemp('mindos-app-');
    const standalone = makeTemp('mindos-standalone-');
    const destNodeModules = path.join(standalone, 'node_modules');
    mkdirSync(destNodeModules, { recursive: true });

    writePackage(appDir, '@scope/root', {
      dependencies: { dep: '1.0.0' },
      peerDependencies: { peer: '1.0.0', optionalPeer: '1.0.0' },
      peerDependenciesMeta: { optionalPeer: { optional: true } },
    });
    writePackage(appDir, 'dep', { dependencies: { transitive: '1.0.0' } });
    writePackage(appDir, 'peer', {});
    writePackage(appDir, 'transitive', {});

    copyRuntimeDependencyClosure(destNodeModules, ['@scope/root'], {
      appDir,
      label: 'test-runtime-closure',
    });

    expect(existsSync(path.join(destNodeModules, '@scope/root/package.json'))).toBe(true);
    expect(existsSync(path.join(destNodeModules, 'dep/package.json'))).toBe(true);
    expect(existsSync(path.join(destNodeModules, 'peer/package.json'))).toBe(true);
    expect(existsSync(path.join(destNodeModules, 'transitive/package.json'))).toBe(true);
    expect(existsSync(path.join(destNodeModules, 'optionalPeer/package.json'))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(destNodeModules, 'dep/package.json'), 'utf-8')).name).toBe('dep');
  });

  it('fails fast when a required transitive dependency is missing', () => {
    const appDir = makeTemp('mindos-app-');
    const standalone = makeTemp('mindos-standalone-');
    const destNodeModules = path.join(standalone, 'node_modules');
    mkdirSync(destNodeModules, { recursive: true });

    writePackage(appDir, 'root', {
      dependencies: { missingRequired: '1.0.0' },
    });

    expect(() =>
      copyRuntimeDependencyClosure(destNodeModules, ['root'], {
        appDir,
        label: 'test-runtime-closure',
      }),
    ).toThrow('runtime dependency not resolvable: missingRequired');
  });

  it('does not let a missing optional dependency mask a later required dependency', () => {
    const appDir = makeTemp('mindos-app-');
    const standalone = makeTemp('mindos-standalone-');
    const destNodeModules = path.join(standalone, 'node_modules');
    mkdirSync(destNodeModules, { recursive: true });

    writePackage(appDir, 'optional-root', {
      optionalDependencies: { sharedMissing: '1.0.0' },
    });
    writePackage(appDir, 'required-root', {
      dependencies: { sharedMissing: '1.0.0' },
    });

    expect(() =>
      copyRuntimeDependencyClosure(destNodeModules, ['optional-root', 'required-root'], {
        appDir,
        label: 'test-runtime-closure',
      }),
    ).toThrow('runtime dependency not resolvable: sharedMissing');
  });

  it('resolves transitive dependencies from the package that declares them before app-level fallbacks', () => {
    const appDir = makeTemp('mindos-app-');
    const standalone = makeTemp('mindos-standalone-');
    const destNodeModules = path.join(standalone, 'node_modules');
    mkdirSync(destNodeModules, { recursive: true });

    const rootDir = writePackage(appDir, 'root', {
      dependencies: { dep: '2.0.0' },
    });
    writePackage(appDir, 'dep', { version: '1.0.0' });
    mkdirSync(path.join(rootDir, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(
      path.join(rootDir, 'node_modules', 'dep', 'package.json'),
      JSON.stringify({ name: 'dep', version: '2.0.0' }),
      'utf-8',
    );
    writeFileSync(path.join(rootDir, 'node_modules', 'dep', 'index.js'), 'export default "dep@2";', 'utf-8');

    copyRuntimeDependencyClosure(destNodeModules, ['root'], {
      appDir,
      label: 'test-runtime-closure',
    });

    expect(JSON.parse(readFileSync(path.join(destNodeModules, 'dep/package.json'), 'utf-8')).version).toBe('2.0.0');
  });
});
