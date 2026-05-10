import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

const httpsGetMock = vi.hoisted(() => vi.fn());

vi.hoisted(() => {
  process.env.MINDOS_DESKTOP_HOME_DIR = '/tmp/mock-home';
});

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => name === 'home' ? '/tmp/mock-home' : `/tmp/mock-${name}`,
    getVersion: () => '0.0.0',
  },
}));

vi.mock('https', () => ({
  default: { get: httpsGetMock },
  get: httpsGetMock,
}));

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { CoreUpdater, _downloadFile_forTest } from './core-updater';
import { getStandaloneAppRequiredEntries } from './runtime-health-contract';

const CONFIG_DIR = '/tmp/mock-home/.mindos';
const RUNTIME_DIR = path.join(CONFIG_DIR, 'runtime');

function writeRuntime(version: string, complete: boolean) {
  mkdirSync(path.join(RUNTIME_DIR, 'packages', 'protocols', 'mcp-server', 'dist'), { recursive: true });
  writeFileSync(path.join(RUNTIME_DIR, 'package.json'), JSON.stringify({ version }), 'utf-8');
  writeFileSync(path.join(RUNTIME_DIR, 'packages', 'protocols', 'mcp-server', 'dist', 'index.cjs'), '// mcp', 'utf-8');
  for (const entry of getStandaloneAppRequiredEntries()) {
    const shouldSkip = !complete && entry.path.includes('pdfjs-dist');
    if (shouldSkip) continue;
    const target = path.join(RUNTIME_DIR, 'packages', 'web', entry.path);
    if (entry.type === 'directory') {
      mkdirSync(target, { recursive: true });
    } else {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, `// ${entry.path}`, 'utf-8');
    }
  }
}

describe('CoreUpdater.cleanupOnBoot', () => {
  beforeEach(() => {
    rmSync(CONFIG_DIR, { recursive: true, force: true });
    mkdirSync(CONFIG_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(CONFIG_DIR, { recursive: true, force: true });
    delete process.env.MINDOS_DESKTOP_HOME_DIR;
  });

  it('removes cached runtime when critical pdf runtime files are missing even if cached version is newer', () => {
    writeRuntime('9.9.9', false);

    const updater = new CoreUpdater();
    updater.cleanupOnBoot('0.6.78');

    expect(existsSync(RUNTIME_DIR)).toBe(false);
  });

  it('keeps cached runtime when it is complete and newer than bundled', () => {
    writeRuntime('9.9.9', true);

    const updater = new CoreUpdater();
    updater.cleanupOnBoot('0.6.78');

    expect(existsSync(RUNTIME_DIR)).toBe(true);
  });

  it('still removes cached runtime when bundled version is same or newer', () => {
    writeRuntime('0.6.78', true);

    const updater = new CoreUpdater();
    updater.cleanupOnBoot('0.6.78');

    expect(existsSync(RUNTIME_DIR)).toBe(false);
  });
});

describe('CoreUpdater download fallback cleanup', () => {
  it('destroys the active response before retrying after a URL timeout', async () => {
    const request = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headers: {},
      destroyed: false,
      destroy: vi.fn(function (this: { destroyed: boolean }) {
        this.destroyed = true;
      }),
      pipe: vi.fn(),
      resume: vi.fn(),
    });
    httpsGetMock.mockImplementation((_url, _options, callback) => {
      callback(response);
      return request;
    });

    const controller = new AbortController();
    const download = _downloadFile_forTest(
      ['https://updates.example/runtime.tar.gz'],
      path.join(CONFIG_DIR, 'runtime.tar.gz'),
      0,
      controller.signal,
      () => {},
    );

    request.emit('timeout');

    await expect(download).rejects.toThrow('All download URLs failed: timeout');
    expect(request.destroy).toHaveBeenCalledTimes(1);
    expect(response.destroy).toHaveBeenCalledTimes(1);
  });
});
