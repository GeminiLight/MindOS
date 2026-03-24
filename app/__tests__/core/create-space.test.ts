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

  it('throws when space README path already exists', () => {
    createSpaceFilesystem(mindRoot, 'Dup', 'a', '');
    expect(() => createSpaceFilesystem(mindRoot, 'Dup', 'b', '')).toThrow('already exists');
  });
});
