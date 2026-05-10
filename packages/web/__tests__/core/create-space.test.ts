import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { mkTempMindRoot, cleanupMindRoot, readSeeded } from './helpers';
import { createSpaceFilesystem } from '@/lib/core/create-space';

describe('createSpaceFilesystem', () => {
  let mindRoot: string;

  beforeEach(() => {
    mindRoot = mkTempMindRoot();
  });
  afterEach(() => {
    cleanupMindRoot(mindRoot);
  });

  it('creates README and triggers INSTRUCTION scaffold for top-level space', () => {
    const { path: p } = createSpaceFilesystem(mindRoot, 'Zeta', 'desc here', '');
    expect(p).toBe('Zeta');
    expect(readSeeded(mindRoot, 'Zeta/README.md')).toContain('desc here');
    expect(fs.existsSync(path.join(mindRoot, 'Zeta', 'INSTRUCTION.md'))).toBe(true);
  });

  it('throws for empty name', () => {
    expect(() => createSpaceFilesystem(mindRoot, '  ', 'd', '')).toThrow('Space name is required');
  });

  it('creates INSTRUCTION.md for nested space under existing parent', () => {
    createSpaceFilesystem(mindRoot, 'Parent', 'top', '');
    createSpaceFilesystem(mindRoot, 'Child', 'nested', 'Parent');
    expect(fs.existsSync(path.join(mindRoot, 'Parent', 'Child', 'INSTRUCTION.md'))).toBe(true);
    expect(readSeeded(mindRoot, 'Parent/Child/README.md')).toContain('nested');
  });

  it('creates nested spaces under parent paths whose segment starts with consecutive dots', () => {
    createSpaceFilesystem(mindRoot, '..Parent', 'top', '');
    createSpaceFilesystem(mindRoot, 'Child', 'nested', '..Parent');
    expect(fs.existsSync(path.join(mindRoot, '..Parent', 'Child', 'INSTRUCTION.md'))).toBe(true);
    expect(readSeeded(mindRoot, '..Parent/Child/README.md')).toContain('nested');
  });

  it('throws for parent path traversal segments', () => {
    expect(() => createSpaceFilesystem(mindRoot, 'Child', 'nested', '../Parent')).toThrow('Invalid parent path');
  });

  it('throws when space README path already exists', () => {
    createSpaceFilesystem(mindRoot, 'Dup', 'a', '');
    expect(() => createSpaceFilesystem(mindRoot, 'Dup', 'b', '')).toThrow('already exists');
  });

  it('does not create nested spaces below symlinked parents outside mindRoot', () => {
    const outsideRoot = fs.mkdtempSync(path.join(path.dirname(mindRoot), 'mindos-create-space-outside-'));
    try {
      fs.symlinkSync(outsideRoot, path.join(mindRoot, 'LinkedParent'), 'dir');

      expect(() => createSpaceFilesystem(mindRoot, 'Child', 'nested', 'LinkedParent')).toThrow('Access denied');
      expect(fs.existsSync(path.join(outsideRoot, 'Child'))).toBe(false);
    } finally {
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});
