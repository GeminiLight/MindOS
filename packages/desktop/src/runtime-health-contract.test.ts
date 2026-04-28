import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  getArchiveValidationEntries,
  getRuntimeHealthContract,
  getStandaloneAppRequiredEntries,
  hasRequiredStandaloneAppFiles,
} from './runtime-health-contract';

const created: string[] = [];

function makeTemp(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

function writeEntries(baseDir: string) {
  for (const entry of getStandaloneAppRequiredEntries()) {
    const target = path.join(baseDir, entry.path);
    if (entry.type === 'directory') {
      mkdirSync(target, { recursive: true });
    } else {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, `// ${entry.path}`, 'utf-8');
    }
  }
}

afterEach(() => {
  while (created.length) {
    const dir = created.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('runtime health contract', () => {
  it('defines portable relative paths for all platforms', () => {
    const contract = getRuntimeHealthContract();
    expect(contract.version).toBeGreaterThan(0);
    expect(getStandaloneAppRequiredEntries().every(entry => !entry.path.startsWith('app/'))).toBe(true);
    expect(getArchiveValidationEntries().every(entry => !path.isAbsolute(entry.path))).toBe(true);
    expect(getArchiveValidationEntries().every(entry => !entry.path.includes('\\'))).toBe(true);
  });

  it('uses v1 runtime paths for archive validation instead of top-level compatibility roots', () => {
    const archivePaths = getArchiveValidationEntries().map(entry => entry.path);

    expect(archivePaths).toContain('packages/web/.next/standalone/server.js');
    expect(archivePaths).toContain('packages/protocols/mcp-server/dist/index.cjs');
    expect(archivePaths).toContain('bin/cli.js');
    expect(archivePaths).toContain('src/cli.js');
    expect(archivePaths.some(entry => entry.startsWith('app/'))).toBe(false);
    expect(archivePaths.some(entry => entry.startsWith('mcp/'))).toBe(false);
  });

  it('marks app unhealthy when any required standalone entry is removed', () => {
    const appDir = makeTemp('runtime-health-app-');
    writeEntries(appDir);
    expect(hasRequiredStandaloneAppFiles(appDir)).toBe(true);

    const fileEntry = getStandaloneAppRequiredEntries().find(entry => entry.type === 'file');
    expect(fileEntry).toBeTruthy();
    if (!fileEntry) return;

    unlinkSync(path.join(appDir, fileEntry.path));
    expect(hasRequiredStandaloneAppFiles(appDir)).toBe(false);
  });
});
