import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

// Track which paths "exist" for each test
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

// Import AFTER mocking
const { resolveScript } = await import('../../lib/core/resolve-script');

describe('resolveScript', () => {
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

  it('returns MINDOS_PROJECT_ROOT/packages/web/scripts/<name> when it exists', () => {
    process.env.MINDOS_PROJECT_ROOT = '/home/user/.mindos/runtime';
    const expected = path.join('/home/user/.mindos/runtime', 'packages', 'web', 'scripts', 'extract-pdf.cjs');
    existingPaths.add(expected);

    expect(resolveScript('extract-pdf.cjs')).toBe(expected);
  });

  it('returns cwd/scripts/<name> in dev mode (cwd = packages/web/)', () => {
    delete process.env.MINDOS_PROJECT_ROOT;
    process.cwd = () => '/project/packages/web';
    const expected = path.join('/project/packages/web', 'scripts', 'extract-pdf.cjs');
    existingPaths.add(expected);

    expect(resolveScript('extract-pdf.cjs')).toBe(expected);
  });

  it('falls back to cwd/../../scripts/<name> in standalone mode', () => {
    delete process.env.MINDOS_PROJECT_ROOT;
    process.cwd = () => '/project/packages/web/.next/standalone';
    const expected = path.resolve('/project/packages/web/.next/standalone', '..', '..', 'scripts', 'extract-pdf.cjs');
    existingPaths.add(expected);

    expect(resolveScript('extract-pdf.cjs')).toBe(expected);
  });

  it('falls back to cwd/.next/standalone/scripts/<name>', () => {
    delete process.env.MINDOS_PROJECT_ROOT;
    process.cwd = () => '/project/packages/web';
    const expected = path.join('/project/packages/web', '.next', 'standalone', 'scripts', 'extract-pdf.cjs');
    existingPaths.add(expected);

    expect(resolveScript('extract-pdf.cjs')).toBe(expected);
  });

  it('returns null when no candidate exists', () => {
    delete process.env.MINDOS_PROJECT_ROOT;
    process.cwd = () => '/nonexistent';
    // existingPaths is empty — nothing exists

    expect(resolveScript('extract-pdf.cjs')).toBeNull();
  });

  it('prefers MINDOS_PROJECT_ROOT over cwd fallbacks', () => {
    process.env.MINDOS_PROJECT_ROOT = '/runtime';
    process.cwd = () => '/project/packages/web';
    const projPath = path.join('/runtime', 'packages', 'web', 'scripts', 'extract-pdf.cjs');
    const cwdPath = path.join('/project/packages/web', 'scripts', 'extract-pdf.cjs');

    existingPaths.add(projPath);
    existingPaths.add(cwdPath);

    // MINDOS_PROJECT_ROOT should win (searched first)
    expect(resolveScript('extract-pdf.cjs')).toBe(projPath);
  });

  it('returns null for empty script name when nothing exists', () => {
    process.env.MINDOS_PROJECT_ROOT = '/runtime';
    // existingPaths is empty

    expect(resolveScript('')).toBeNull();
  });

  it('recovers when MINDOS_PROJECT_ROOT path is wrong but cwd/scripts/ exists (the bug scenario)', () => {
    // Simulates the exact scenario from the bug report:
    // MINDOS_PROJECT_ROOT points to runtime/ but scripts/ only exists under cwd
    process.env.MINDOS_PROJECT_ROOT = '/Users/geminilight/.mindos/runtime';
    process.cwd = () => '/Users/geminilight/.mindos/runtime/packages/web';

    // MINDOS_PROJECT_ROOT/packages/web/scripts/ does NOT exist (the bug)
    // but cwd/scripts/ DOES exist
    const cwdPath = path.join('/Users/geminilight/.mindos/runtime/packages/web', 'scripts', 'extract-pdf.cjs');
    existingPaths.add(cwdPath);

    const result = resolveScript('extract-pdf.cjs');
    expect(result).toBe(cwdPath);
    expect(result).not.toBeNull();
  });
});
