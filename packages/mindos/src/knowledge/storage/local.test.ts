import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalFileSystem } from './local.js';

describe('LocalFileSystem.writeFile', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mindos-local-fs-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes through a temp file and leaves only the target behind', async () => {
    const fs = new LocalFileSystem();
    const target = join(root, 'nested', 'note.md');
    const result = await fs.writeFile(target, '# hello');
    expect(result.ok).toBe(true);
    expect(readFileSync(target, 'utf-8')).toBe('# hello');
    expect(readdirSync(join(root, 'nested'))).toEqual(['note.md']);
  });

  it('replaces existing content without an intermediate truncated state', async () => {
    const fs = new LocalFileSystem();
    const target = join(root, 'note.md');
    await fs.writeFile(target, 'first');
    await fs.writeFile(target, 'second version');
    expect(readFileSync(target, 'utf-8')).toBe('second version');
    expect(readdirSync(root)).toEqual(['note.md']);
  });
});
