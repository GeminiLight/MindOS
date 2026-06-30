import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tempDir: string;
let packageJson: string;
let updateCheckPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-cli-update-check-'));
  packageJson = path.join(tempDir, 'package.json');
  updateCheckPath = path.join(tempDir, 'update-check.json');
  fs.writeFileSync(packageJson, JSON.stringify({ name: '@geminilight/mindos', version: '1.1.53' }));

  vi.resetModules();
  vi.doMock('../../packages/mindos/bin/lib/constants.js', () => ({
    PRODUCT_PACKAGE_JSON: packageJson,
    UPDATE_CHECK_PATH: updateCheckPath,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('CLI update check', () => {
  it('ignores stale lower cache and chooses the highest registry version', async () => {
    fs.writeFileSync(updateCheckPath, JSON.stringify({
      lastCheck: new Date().toISOString(),
      latestVersion: '0.6.33',
    }));

    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        version: url.includes('npmmirror') ? '0.6.33' : '1.1.55',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { checkForUpdate } = await import('../../packages/mindos/bin/lib/update-check.js');

    await expect(checkForUpdate()).resolves.toBe('1.1.55');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fs.readFileSync(updateCheckPath, 'utf-8'))).toMatchObject({
      latestVersion: '1.1.55',
    });
  });
});
