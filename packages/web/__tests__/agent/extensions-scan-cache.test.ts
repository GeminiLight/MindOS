import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tempHome: string;
let previousHome: string | undefined;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-ext-scan-'));
  previousHome = process.env.HOME;
  process.env.HOME = tempHome;
  vi.resetModules();
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  fs.rmSync(tempHome, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

function extensionsDir(): string {
  return path.join(tempHome, '.mindos', 'extensions');
}

function seedExtension(name: string): void {
  fs.mkdirSync(extensionsDir(), { recursive: true });
  fs.writeFileSync(path.join(extensionsDir(), name), 'export default {};\n', 'utf-8');
}

/** Force a distinct directory mtime so rescan-on-change is deterministic. */
function bumpDirMtime(): void {
  const next = new Date(Date.now() + 2000);
  fs.utimesSync(extensionsDir(), next, next);
}

describe('scanExtensionPaths memoisation', () => {
  it('re-scans on the first call and skips readdir on an unchanged second call', async () => {
    seedExtension('alpha.ts');
    const { scanExtensionPaths } = await import('@/lib/pi-integration/extensions');

    const first = scanExtensionPaths();
    expect(first).toEqual([path.join(extensionsDir(), 'alpha.ts')]);

    const readdirSpy = vi.spyOn(fs, 'readdirSync');
    const second = scanExtensionPaths();
    expect(second).toEqual(first);
    expect(readdirSpy).not.toHaveBeenCalled();
  });

  it('re-scans when a new extension appears (directory mtime changes)', async () => {
    seedExtension('alpha.ts');
    const { scanExtensionPaths } = await import('@/lib/pi-integration/extensions');
    expect(scanExtensionPaths()).toHaveLength(1);

    seedExtension('beta.ts');
    bumpDirMtime();
    const paths = scanExtensionPaths();
    expect(paths).toEqual(expect.arrayContaining([
      path.join(extensionsDir(), 'alpha.ts'),
      path.join(extensionsDir(), 'beta.ts'),
    ]));
    expect(paths).toHaveLength(2);
  });

  it('re-scans after invalidateExtensionScanCache even when mtime is unchanged', async () => {
    seedExtension('alpha.ts');
    const { scanExtensionPaths, invalidateExtensionScanCache } = await import('@/lib/pi-integration/extensions');
    scanExtensionPaths();

    invalidateExtensionScanCache();
    const readdirSpy = vi.spyOn(fs, 'readdirSync');
    scanExtensionPaths();
    expect(readdirSpy).toHaveBeenCalled();
  });

  it('returns an empty list without throwing when the extensions directory is absent', async () => {
    const { scanExtensionPaths } = await import('@/lib/pi-integration/extensions');
    expect(scanExtensionPaths()).toEqual([]);
    // Memoises the miss; a second call is still empty and does not readdir.
    const readdirSpy = vi.spyOn(fs, 'readdirSync');
    expect(scanExtensionPaths()).toEqual([]);
    expect(readdirSpy).not.toHaveBeenCalled();
  });

  it('picks up index.ts inside subdirectories and returns a defensive copy', async () => {
    fs.mkdirSync(path.join(extensionsDir(), 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(extensionsDir(), 'pkg', 'index.ts'), 'export default {};\n', 'utf-8');
    const { scanExtensionPaths } = await import('@/lib/pi-integration/extensions');

    const first = scanExtensionPaths();
    expect(first).toEqual([path.join(extensionsDir(), 'pkg', 'index.ts')]);
    // Mutating the returned array must not corrupt the memo.
    first.push('mutated');
    expect(scanExtensionPaths()).toEqual([path.join(extensionsDir(), 'pkg', 'index.ts')]);
  });
});
