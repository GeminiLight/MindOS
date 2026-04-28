import { describe, it, expect } from 'vitest';
import {
  assertWithinRoot,
  isWithinRoot,
  resolveSafe,
  resolveSafeResult,
  isRootProtected,
  assertNotProtected,
  validatePath,
  normalizePath,
} from './index';
import * as path from 'path';

describe('@mindos/security', () => {
  const testRoot = '/test/root';

  describe('assertWithinRoot', () => {
    it('should not throw for paths within root', () => {
      expect(() => assertWithinRoot('/test/root/file.txt', testRoot)).not.toThrow();
    });

    it('should throw for paths outside root', () => {
      expect(() => assertWithinRoot('/other/path', testRoot)).toThrow();
    });

    it('should allow root itself', () => {
      expect(() => assertWithinRoot(testRoot, testRoot)).not.toThrow();
    });
  });

  describe('isWithinRoot', () => {
    it('should return true for paths within root', () => {
      const result = isWithinRoot('/test/root/file.txt', testRoot);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('should return true for root itself', () => {
      const result = isWithinRoot(testRoot, testRoot);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });
  });

  describe('resolveSafe', () => {
    it('should resolve safe paths', () => {
      const resolved = resolveSafe(testRoot, 'file.txt');
      expect(resolved).toBe(path.join(testRoot, 'file.txt'));
    });

    it('should throw for path traversal attempts', () => {
      expect(() => resolveSafe(testRoot, '../../../etc/passwd')).toThrow();
    });

    it('should throw for absolute paths', () => {
      expect(() => resolveSafe(testRoot, '/etc/passwd')).toThrow();
    });
  });

  describe('resolveSafeResult', () => {
    it('should return ok for safe paths', () => {
      const result = resolveSafeResult(testRoot, 'file.txt');
      expect(result.ok).toBe(true);
    });

    it('should return err for unsafe paths', () => {
      const result = resolveSafeResult(testRoot, '../../../etc/passwd');
      expect(result.ok).toBe(false);
    });
  });

  describe('isRootProtected', () => {
    it('should return true for INSTRUCTION.md', () => {
      expect(isRootProtected('INSTRUCTION.md')).toBe(true);
    });

    it('should return false for other files', () => {
      expect(isRootProtected('README.md')).toBe(false);
    });
  });

  describe('assertNotProtected', () => {
    it('should not throw for non-protected files', () => {
      expect(() => assertNotProtected('README.md', 'delete')).not.toThrow();
    });

    it('should throw for protected files', () => {
      expect(() => assertNotProtected('INSTRUCTION.md', 'delete')).toThrow();
    });
  });

  describe('validatePath', () => {
    it('should validate safe paths', () => {
      const result = validatePath(testRoot, 'file.txt');
      expect(result.ok).toBe(true);
    });

    it('should reject unsafe paths', () => {
      const result = validatePath(testRoot, '../../../etc/passwd');
      expect(result.ok).toBe(false);
    });

    it('should reject absolute paths', () => {
      const result = validatePath(testRoot, '/tmp/file.txt');
      expect(result.ok).toBe(false);
    });

    it('should reject protected files when operation is specified', () => {
      const result = validatePath(testRoot, 'INSTRUCTION.md', 'delete');
      expect(result.ok).toBe(false);
    });

    it('should allow nested space instruction files when operation is specified', () => {
      const result = validatePath(testRoot, 'Projects/INSTRUCTION.md', 'write');
      expect(result.ok).toBe(true);
    });
  });

  describe('normalizePath', () => {
    it('should convert backslashes to forward slashes', () => {
      expect(normalizePath('path\\to\\file.txt')).toBe('path/to/file.txt');
    });

    it('should leave forward slashes unchanged', () => {
      expect(normalizePath('path/to/file.txt')).toBe('path/to/file.txt');
    });
  });
});
