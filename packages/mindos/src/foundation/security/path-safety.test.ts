import { describe, it, expect } from 'vitest';
import {
  assertWithinRoot,
  isWithinRoot,
  resolveSafe,
  resolveExistingSafe,
  resolveSafeResult,
  isRootProtected,
  assertNotProtected,
  validatePath,
  normalizePath,
} from './index';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

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

    it('should allow paths within a root that has a trailing separator', () => {
      expect(() => assertWithinRoot('/test/root/file.txt', `${testRoot}/`)).not.toThrow();
    });

    it('should reject sibling paths that only share the root prefix', () => {
      expect(() => assertWithinRoot('/test/rooted/file.txt', testRoot)).toThrow();
    });

    it('should allow in-root child paths whose segment starts with consecutive dots', () => {
      expect(() => assertWithinRoot('/test/root/..notes/file.txt', testRoot)).not.toThrow();
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

    it('should return true for paths within a root that has a trailing separator', () => {
      const result = isWithinRoot('/test/root/file.txt', `${testRoot}/`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('should return false for sibling paths that only share the root prefix', () => {
      const result = isWithinRoot('/test/rooted/file.txt', testRoot);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('should return true for in-root child paths whose segment starts with consecutive dots', () => {
      const result = isWithinRoot('/test/root/..notes/file.txt', testRoot);
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

    it('should throw for Windows absolute paths even on POSIX hosts', () => {
      expect(() => resolveSafe(testRoot, 'C:/Users/Ada/secret.md')).toThrow();
      expect(() => resolveSafe(testRoot, 'C:\\Users\\Ada\\secret.md')).toThrow();
      expect(() => resolveSafe(testRoot, '\\\\server\\share\\secret.md')).toThrow();
    });

    it('should throw for Windows drive-relative paths even on POSIX hosts', () => {
      expect(() => resolveSafe(testRoot, 'C:secret.md')).toThrow();
      expect(() => resolveSafe(testRoot, 'd:Projects/note.md')).toThrow();
    });

    it('should treat backslashes as path separators for traversal checks', () => {
      expect(() => resolveSafe(testRoot, '..\\secret.md')).toThrow();
      expect(resolveSafe(testRoot, 'Projects\\note.md')).toBe(path.join(testRoot, 'Projects', 'note.md'));
    });

    it('should resolve safe paths whose segment starts with consecutive dots', () => {
      const resolved = resolveSafe(testRoot, '..notes/file.txt');
      expect(resolved).toBe(path.join(testRoot, '..notes/file.txt'));
    });

    it('should reject Windows-invalid path segments on every platform', () => {
      expect(() => resolveSafe(testRoot, 'CON.md')).toThrow();
      expect(() => resolveSafe(testRoot, 'Projects/prn.txt')).toThrow();
      expect(() => resolveSafe(testRoot, 'notes/bad:name.md')).toThrow();
      expect(() => resolveSafe(testRoot, 'notes/trailing-dot.md.')).toThrow();
      expect(() => resolveSafe(testRoot, 'notes/trailing-space.md ')).toThrow();
      expect(() => resolveSafe(testRoot, 'notes/line\nbreak.md')).toThrow();
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

  describe('resolveExistingSafe', () => {
    it('should reject existing paths whose real path escapes through a symlink', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-resolve-existing-root-'));
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-resolve-existing-outside-'));
      try {
        fs.writeFileSync(path.join(outside, 'secret.md'), 'outside', 'utf-8');
        fs.symlinkSync(outside, path.join(root, 'linked-outside'), 'dir');

        expect(() => resolveExistingSafe(root, 'linked-outside/secret.md')).toThrow();
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('should reject new paths below a symlinked parent that resolves outside root', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-resolve-new-root-'));
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-resolve-new-outside-'));
      try {
        fs.symlinkSync(outside, path.join(root, 'linked-outside'), 'dir');

        expect(() => resolveExistingSafe(root, 'linked-outside/new.md')).toThrow();
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('should allow existing paths whose real path stays inside root', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-resolve-existing-inside-'));
      try {
        fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
        fs.writeFileSync(path.join(root, 'notes', 'safe.md'), 'safe', 'utf-8');

        expect(resolveExistingSafe(root, 'notes/safe.md')).toBe(path.join(root, 'notes', 'safe.md'));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
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
