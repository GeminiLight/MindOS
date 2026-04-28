import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile, readSeeded } from './helpers';
import { scaffoldIfNewSpace } from '@/lib/core/space-scaffold';
import fs from 'fs';
import path from 'path';

describe('scaffoldIfNewSpace', () => {
  let mindRoot: string;

  beforeEach(() => { mindRoot = mkTempMindRoot(); });
  afterEach(() => { cleanupMindRoot(mindRoot); });

  // --- Normal paths ---

  it('creates INSTRUCTION.md and README.md for a new top-level directory', () => {
    // Pre-create the directory (simulating mkdirSync in createFile)
    fs.mkdirSync(path.join(mindRoot, 'Learning'), { recursive: true });

    scaffoldIfNewSpace(mindRoot, 'Learning/note.md');

    expect(fs.existsSync(path.join(mindRoot, 'Learning/INSTRUCTION.md'))).toBe(true);
    expect(fs.existsSync(path.join(mindRoot, 'Learning/README.md'))).toBe(true);

    const instruction = readSeeded(mindRoot, 'Learning/INSTRUCTION.md');
    expect(instruction).toContain('Learning Instruction Set');
    expect(instruction).toContain('Root `INSTRUCTION.md`');

    const readme = readSeeded(mindRoot, 'Learning/README.md');
    expect(readme).toContain('# Learning');
    expect(readme).toContain('INSTRUCTION.md');
  });

  it('uses cleaned name for emoji-prefixed directories', () => {
    fs.mkdirSync(path.join(mindRoot, '📖 Learning'), { recursive: true });

    scaffoldIfNewSpace(mindRoot, '📖 Learning/note.md');

    const instruction = readSeeded(mindRoot, '📖 Learning/INSTRUCTION.md');
    expect(instruction).toContain('Learning Instruction Set');
    // Should not contain the emoji in the title
    expect(instruction).not.toMatch(/^# 📖/m);
  });

  it('only scaffolds first-level directory for deeply nested paths', () => {
    fs.mkdirSync(path.join(mindRoot, 'Learning/sub/deep'), { recursive: true });

    scaffoldIfNewSpace(mindRoot, 'Learning/sub/deep/file.md');

    // INSTRUCTION.md should be in Learning/, not in sub/ or deep/
    expect(fs.existsSync(path.join(mindRoot, 'Learning/INSTRUCTION.md'))).toBe(true);
    expect(fs.existsSync(path.join(mindRoot, 'Learning/sub/INSTRUCTION.md'))).toBe(false);
  });

  // --- Idempotency ---

  it('does not overwrite existing INSTRUCTION.md', () => {
    seedFile(mindRoot, 'Existing/INSTRUCTION.md', '# Custom rules');

    scaffoldIfNewSpace(mindRoot, 'Existing/note.md');

    expect(readSeeded(mindRoot, 'Existing/INSTRUCTION.md')).toBe('# Custom rules');
  });

  it('creates only INSTRUCTION.md when README.md already exists', () => {
    seedFile(mindRoot, 'Partial/README.md', '# My custom README');

    scaffoldIfNewSpace(mindRoot, 'Partial/note.md');

    // INSTRUCTION.md should be created
    expect(fs.existsSync(path.join(mindRoot, 'Partial/INSTRUCTION.md'))).toBe(true);
    // README.md should NOT be overwritten
    expect(readSeeded(mindRoot, 'Partial/README.md')).toBe('# My custom README');
  });

  // --- Skip conditions ---

  it('skips root-level files (no top-level directory)', () => {
    scaffoldIfNewSpace(mindRoot, 'notes.md');

    // Nothing should be created at root level
    expect(fs.existsSync(path.join(mindRoot, 'INSTRUCTION.md'))).toBe(false);
  });

  it('skips hidden directories', () => {
    fs.mkdirSync(path.join(mindRoot, '.agents/skills'), { recursive: true });

    scaffoldIfNewSpace(mindRoot, '.agents/skills/test.md');

    expect(fs.existsSync(path.join(mindRoot, '.agents/INSTRUCTION.md'))).toBe(false);
  });

  it('skips empty path', () => {
    // Should not throw
    scaffoldIfNewSpace(mindRoot, '');
  });

  it('skips path with only slashes', () => {
    scaffoldIfNewSpace(mindRoot, '///');
    // No crash, no files created
  });

  // --- Error resilience ---

  it('does not throw even if mindRoot does not exist', () => {
    // Should silently catch the error
    expect(() => scaffoldIfNewSpace('/nonexistent/path', 'Learning/note.md')).not.toThrow();
  });

  it('does not throw on read-only directory', () => {
    // Create dir then make it read-only (skip on non-POSIX)
    const dir = path.join(mindRoot, 'ReadOnly');
    fs.mkdirSync(dir);
    try {
      fs.chmodSync(dir, 0o444);
      expect(() => scaffoldIfNewSpace(mindRoot, 'ReadOnly/note.md')).not.toThrow();
    } finally {
      fs.chmodSync(dir, 0o755); // restore for cleanup
    }
  });
});
