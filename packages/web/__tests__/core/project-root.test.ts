import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';

let existingPaths: Set<string>;

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: (p: string) => existingPaths.has(p),
    },
    existsSync: (p: string) => existingPaths.has(p),
  };
});

const { getProjectRoot, resolveMindosCliPath, resolveMindosCliLibPath } = await import('../../lib/project-root');

describe('getProjectRoot', () => {
  const originalEnv = { ...process.env };
  let originalCwd: () => string;

  beforeEach(() => {
    existingPaths = new Set();
    process.env = { ...originalEnv };
    originalCwd = process.cwd;
  });

  afterEach(() => {
    process.env = originalEnv;
    process.cwd = originalCwd;
  });

  it('prefers MINDOS_PROJECT_ROOT when it is set', () => {
    process.env.MINDOS_PROJECT_ROOT = '/runtime/root';
    process.cwd = () => '/repo/packages/web';

    expect(getProjectRoot()).toBe('/runtime/root');
  });

  it('resolves the repo root from packages/web dev mode', () => {
    delete process.env.MINDOS_PROJECT_ROOT;
    process.cwd = () => '/repo/packages/web';
    existingPaths.add(path.join('/repo', 'pnpm-workspace.yaml'));

    expect(getProjectRoot()).toBe('/repo');
  });

  it('walks out of a standalone cwd to the workspace root', () => {
    delete process.env.MINDOS_PROJECT_ROOT;
    process.cwd = () => '/repo/packages/web/.next/standalone';
    existingPaths.add(path.join('/repo', 'packages', 'mindos', 'package.json'));

    expect(getProjectRoot()).toBe('/repo');
  });

  it('resolves the repo CLI from an OpenCode-style source checkout', () => {
    delete process.env.MINDOS_PROJECT_ROOT;
    delete process.env.MINDOS_CLI_PATH;
    process.cwd = () => '/repo/packages/web';
    existingPaths.add(path.join('/repo', 'pnpm-workspace.yaml'));
    existingPaths.add(path.join('/repo', 'packages', 'mindos', 'bin', 'cli.js'));

    expect(resolveMindosCliPath()).toBe(path.join('/repo', 'packages', 'mindos', 'bin', 'cli.js'));
  });

  it('falls back to the packaged CLI layout after npm install', () => {
    delete process.env.MINDOS_PROJECT_ROOT;
    delete process.env.MINDOS_CLI_PATH;
    process.cwd = () => '/runtime/_standalone';
    existingPaths.add(path.join('/runtime', 'bin', 'cli.js'));
    existingPaths.add(path.join('/runtime', 'packages', 'mindos', 'package.json'));

    expect(resolveMindosCliPath()).toBe(path.join('/runtime', 'bin', 'cli.js'));
  });

  it('resolves CLI library files in source and packaged layouts', () => {
    delete process.env.MINDOS_PROJECT_ROOT;
    process.cwd = () => '/repo/packages/web';
    existingPaths.add(path.join('/repo', 'pnpm-workspace.yaml'));
    existingPaths.add(path.join('/repo', 'packages', 'mindos', 'bin', 'lib', 'sync.js'));

    expect(resolveMindosCliLibPath('sync.js')).toBe(path.join('/repo', 'packages', 'mindos', 'bin', 'lib', 'sync.js'));
  });
});
