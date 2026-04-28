import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.MINDOS_DESKTOP_HOME_DIR = '/tmp/mock-home';
});

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => name === 'home' ? '/tmp/mock-home' : `/tmp/mock-${name}`,
    getVersion: () => '0.0.0',
  },
}));

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { CoreUpdater } from './core-updater';
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
