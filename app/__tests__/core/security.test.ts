import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot } from './helpers';
import {
  resolveSafe,
  assertNotProtected,
  isRootProtected,
  assertWithinRoot,
} from '@/lib/core/security';
import { MindOSError, ErrorCodes } from '@/lib/errors';
import path from 'path';

describe('security', () => {
  let mindRoot: string;

  beforeEach(() => { mindRoot = mkTempMindRoot(); });
  afterEach(() => { cleanupMindRoot(mindRoot); });

  describe('resolveSafe', () => {
    it('resolves a valid relative path', () => {
      const resolved = resolveSafe(mindRoot, 'foo/bar.md');
      expect(resolved).toBe(path.resolve(mindRoot, 'foo/bar.md'));
    });

    it('throws MindOSError with PATH_OUTSIDE_ROOT on path traversal', () => {
      try {
        resolveSafe(mindRoot, '../../../etc/passwd');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MindOSError);
        expect((err as MindOSError).code).toBe(ErrorCodes.PATH_OUTSIDE_ROOT);
      }
    });

    it('throws on path that escapes via symlink-like traversal', () => {
      // path.join normalizes away leading /, so we use .. to escape
      expect(() => resolveSafe(mindRoot, '../../../../../../etc/passwd')).toThrow('Access denied');
    });

    it('allows paths that resolve to root itself', () => {
      const resolved = resolveSafe(mindRoot, '.');
      expect(resolved).toBe(path.resolve(mindRoot));
    });

    it('prevents double-encoded path traversal', () => {
      expect(() => resolveSafe(mindRoot, 'foo/../../..')).toThrow('Access denied');
    });
  });

  describe('assertWithinRoot', () => {
    it('does not throw for paths within root', () => {
      const root = path.resolve(mindRoot);
      expect(() => assertWithinRoot(path.join(root, 'file.md'), root)).not.toThrow();
    });

    it('throws for paths outside root', () => {
      const root = path.resolve(mindRoot);
      expect(() => assertWithinRoot('/tmp/other', root)).toThrow('Access denied');
    });
  });

  describe('isRootProtected / assertNotProtected', () => {
    it('marks INSTRUCTION.md as protected', () => {
      expect(isRootProtected('INSTRUCTION.md')).toBe(true);
    });

    it('does not mark other files as protected', () => {
      expect(isRootProtected('README.md')).toBe(false);
      expect(isRootProtected('nested/INSTRUCTION.md')).toBe(false);
    });

    it('assertNotProtected throws MindOSError with PROTECTED_FILE for INSTRUCTION.md', () => {
      try {
        assertNotProtected('INSTRUCTION.md', 'modified');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MindOSError);
        expect((err as MindOSError).code).toBe(ErrorCodes.PROTECTED_FILE);
      }
    });

    it('assertNotProtected passes for normal files', () => {
      expect(() => assertNotProtected('README.md', 'modified')).not.toThrow();
    });
  });
});
