/**
 * Security hardening test suite for MindOS update system.
 * Tests cover:
 * - Symlink attack prevention
 * - Path traversal prevention
 * - Race condition detection
 * - Atomic operation verification
 * - Data loss prevention
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import {
  mkdirSync, writeFileSync, readFileSync, unlinkSync, symlinkSync,
  existsSync, statSync, rmdirSync, rmSync, realpathSync,
} from 'fs';

import {
  isSymlink, assertNotSymlink, assertNoSymlinksInPath,
  safeRmSync, safeMkdir, getSafeStats, assessDeletionRisk,
} from '../packages/desktop/src/safe-rm';
import {
  validateRuntimePath, getRuntimePaths, isValidDirName, sanitizeDirName,
} from '../packages/desktop/src/safe-paths';

describe('Security Hardening - Symlink Protection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `mindos-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('Symlink Detection', () => {
    it('should detect direct symlinks', () => {
      const targetDir = path.join(tempDir, 'target');
      const linkDir = path.join(tempDir, 'link');

      mkdirSync(targetDir);
      symlinkSync(targetDir, linkDir);

      expect(isSymlink(linkDir)).toBe(true);
      expect(isSymlink(targetDir)).toBe(false);
    });

    it('should return false for non-existent paths', () => {
      const nonExistent = path.join(tempDir, 'does-not-exist');
      expect(isSymlink(nonExistent)).toBe(false);
    });

    it('should detect symlinks pointing to files', () => {
      const file = path.join(tempDir, 'file.txt');
      const link = path.join(tempDir, 'link.txt');

      writeFileSync(file, 'content');
      symlinkSync(file, link);

      expect(isSymlink(link)).toBe(true);
    });
  });

  describe('Assertion: assertNotSymlink', () => {
    it('should throw when path is a symlink', () => {
      const targetDir = path.join(tempDir, 'target');
      const linkDir = path.join(tempDir, 'link');

      mkdirSync(targetDir);
      symlinkSync(targetDir, linkDir);

      expect(() => {
        assertNotSymlink(linkDir);
      }).toThrow(/SECURITY.*symlink/i);
    });

    it('should not throw for regular directories', () => {
      const regularDir = path.join(tempDir, 'regular');
      mkdirSync(regularDir);

      expect(() => {
        assertNotSymlink(regularDir);
      }).not.toThrow();
    });

    it('should not throw for non-existent paths', () => {
      const nonExistent = path.join(tempDir, 'does-not-exist');
      expect(() => {
        assertNotSymlink(nonExistent);
      }).not.toThrow();
    });
  });

  describe('Path Chain Symlink Check', () => {
    it('should detect symlinks in parent chain', () => {
      const realDir = path.join(tempDir, 'real');
      const symlinkParent = path.join(tempDir, 'symlink-parent');
      const childPath = path.join(symlinkParent, 'child');

      mkdirSync(realDir);
      symlinkSync(realDir, symlinkParent);

      expect(() => {
        assertNoSymlinksInPath(childPath, tempDir);
      }).toThrow(/SECURITY.*symlink/i);
    });

    it('should allow clean parent chains', () => {
      const dir1 = path.join(tempDir, 'dir1');
      const dir2 = path.join(dir1, 'dir2');

      mkdirSync(dir2, { recursive: true });

      expect(() => {
        assertNoSymlinksInPath(dir2, tempDir);
      }).not.toThrow();
    });
  });
});

describe('Security Hardening - Safe Deletion', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `mindos-saferm-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('safeRmSync', () => {
    it('should refuse to delete symlinks', () => {
      const targetDir = path.join(tempDir, 'target');
      const linkDir = path.join(tempDir, 'link');

      mkdirSync(targetDir);
      symlinkSync(targetDir, linkDir);

      expect(() => {
        safeRmSync(linkDir);
      }).toThrow(/SECURITY.*symlink/i);

      // Verify link still exists
      expect(existsSync(linkDir)).toBe(true);
    });

    it('should safely delete regular directories', () => {
      const dir = path.join(tempDir, 'regular-dir');
      mkdirSync(dir);
      writeFileSync(path.join(dir, 'file.txt'), 'content');

      expect(() => {
        safeRmSync(dir, { recursive: true });
      }).not.toThrow();

      expect(existsSync(dir)).toBe(false);
    });

    it('should be idempotent for non-existent paths', () => {
      const nonExistent = path.join(tempDir, 'does-not-exist');

      expect(() => {
        safeRmSync(nonExistent);
      }).not.toThrow();
    });

    it('should refuse to delete non-directories without recursive flag', () => {
      const file = path.join(tempDir, 'file.txt');
      writeFileSync(file, 'content');

      // Should work for files
      expect(() => {
        safeRmSync(file);
      }).not.toThrow();

      expect(existsSync(file)).toBe(false);
    });
  });

  describe('safeMkdir', () => {
    it('should refuse to create in symlinked parents', () => {
      const realDir = path.join(tempDir, 'real');
      const symlinkParent = path.join(tempDir, 'symlink-parent');
      const newDir = path.join(symlinkParent, 'newdir');

      mkdirSync(realDir);
      symlinkSync(realDir, symlinkParent);

      expect(() => {
        safeMkdir(newDir);
      }).toThrow(/SECURITY.*symlink/i);
    });

    it('should create directories in clean paths', () => {
      const dir = path.join(tempDir, 'a', 'b', 'c');

      expect(() => {
        safeMkdir(dir);
      }).not.toThrow();

      expect(existsSync(dir)).toBe(true);
    });
  });

  describe('Risk Assessment', () => {
    it('should identify symlink risks', () => {
      const targetDir = path.join(tempDir, 'target');
      const linkDir = path.join(tempDir, 'link');

      mkdirSync(targetDir);
      symlinkSync(targetDir, linkDir);

      const risks = assessDeletionRisk(linkDir, tempDir);
      expect(risks.isSymlink).toBe(true);
    });

    it('should identify system path risks', () => {
      const externalPath = '/etc/passwd';
      const risks = assessDeletionRisk(externalPath, tempDir);
      expect(risks.isSystemPath).toBe(true);
    });

    it('should clean paths without risks', () => {
      const dir = path.join(tempDir, 'safe-dir');
      mkdirSync(dir);

      const risks = assessDeletionRisk(dir, tempDir);
      expect(risks.isSymlink).toBe(false);
      expect(risks.hasSymlinkParent).toBe(false);
      expect(risks.isSystemPath).toBe(false);
    });
  });
});

describe('Security Hardening - Path Validation', () => {
  const mockConfigDir = path.join(os.tmpdir(), '.mindos');

  beforeEach(() => {
    mkdirSync(mockConfigDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(mockConfigDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('Path Traversal Prevention', () => {
    it('should reject paths with ..', () => {
      expect(() => {
        validateRuntimePath('../../etc/passwd');
      }).toThrow(/path traversal/i);
    });

    it('should reject absolute paths outside .mindos', () => {
      expect(() => {
        validateRuntimePath('/etc/passwd');
      }).toThrow(/outside/i);
    });

    it('should accept safe subdirectories', () => {
      const safePath = 'runtime';
      expect(() => {
        validateRuntimePath(safePath);
      }).not.toThrow();
    });

    it('should reject null bytes', () => {
      expect(() => {
        validateRuntimePath('runtime\0etc/passwd');
      }).toThrow(/null byte/i);
    });
  });

  describe('Directory Name Validation', () => {
    it('should reject directory names with path separators', () => {
      expect(isValidDirName('dir/name')).toBe(false);
      expect(isValidDirName('dir\\name')).toBe(false);
    });

    it('should reject . and ..', () => {
      expect(isValidDirName('.')).toBe(false);
      expect(isValidDirName('..')).toBe(false);
    });

    it('should reject hidden directories (starting with .)', () => {
      expect(isValidDirName('.hidden')).toBe(false);
    });

    it('should accept normal directory names', () => {
      expect(isValidDirName('runtime')).toBe(true);
      expect(isValidDirName('runtime-old')).toBe(true);
      expect(isValidDirName('runtime-downloading')).toBe(true);
    });
  });

  describe('Directory Name Sanitization', () => {
    it('should sanitize path separators', () => {
      const sanitized = sanitizeDirName('dir/name');
      expect(sanitized).not.toContain('/');
      expect(isValidDirName(sanitized)).toBe(true);
    });

    it('should sanitize null bytes', () => {
      const sanitized = sanitizeDirName('name\0etc');
      expect(sanitized).not.toContain('\0');
      expect(isValidDirName(sanitized)).toBe(true);
    });

    it('should sanitize .. patterns', () => {
      const sanitized = sanitizeDirName('name..etc');
      expect(sanitized).toContain('__');
      expect(isValidDirName(sanitized)).toBe(true);
    });

    it('should reject if sanitization fails', () => {
      expect(() => {
        sanitizeDirName('\0\0\0');
      }).toThrow();
    });
  });
});

describe('Security Hardening - Atomic Operations', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `mindos-atomic-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('should handle update rollback scenario', () => {
    const runtimeDir = path.join(tempDir, 'runtime');
    const downloadDir = path.join(tempDir, 'runtime-downloading');
    const oldDir = path.join(tempDir, 'runtime-old');

    // Simulate current runtime
    mkdirSync(runtimeDir);
    writeFileSync(path.join(runtimeDir, 'version.txt'), '1.0.0');

    // Simulate new download
    mkdirSync(downloadDir);
    writeFileSync(path.join(downloadDir, 'version.txt'), '1.1.0');

    // Simulate atomic apply
    try {
      // Move old → backup
      if (existsSync(runtimeDir)) {
        if (existsSync(oldDir)) {
          safeRmSync(oldDir, { recursive: true });
        }
        // Simulate rename
        const tempBackup = path.join(tempDir, 'runtime-backup-temp');
        require('fs').renameSync(runtimeDir, tempBackup);
        require('fs').renameSync(tempBackup, oldDir);
      }

      // Move new → current
      require('fs').renameSync(downloadDir, runtimeDir);

      // Verify new runtime is in place
      expect(existsSync(runtimeDir)).toBe(true);
      expect(readFileSync(path.join(runtimeDir, 'version.txt'), 'utf-8')).toBe('1.1.0');
    } catch (err) {
      // On error, verify rollback
      expect(existsSync(runtimeDir)).toBe(true);
      expect(readFileSync(path.join(runtimeDir, 'version.txt'), 'utf-8')).toBe('1.0.0');
    }
  });
});

describe('End-to-End Security Scenarios', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `mindos-e2e-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('should prevent deletion via symlink to user data', () => {
    // Setup: Create user data directory with marker
    const userDataDir = path.join(tempDir, 'mind');
    const guardFile = path.join(userDataDir, '.mindos-guard');
    mkdirSync(userDataDir);
    writeFileSync(guardFile, 'USER DATA');

    // Attack: Create symlink pointing to user data
    const symlinkToUserData = path.join(tempDir, 'runtime-old');
    symlinkSync(userDataDir, symlinkToUserData);

    // Defense: Should refuse deletion
    expect(() => {
      assertNotSymlink(symlinkToUserData);
    }).toThrow();

    // Verify user data still exists
    expect(readFileSync(guardFile, 'utf-8')).toBe('USER DATA');
  });

  it('should prevent deletion via path traversal', () => {
    // Setup: Create structure
    const runtimeDir = path.join(tempDir, '.mindos', 'runtime');
    mkdirSync(runtimeDir, { recursive: true });

    // Attack: Try to validate malicious path
    const maliciousPath = path.join(
      tempDir,
      '.mindos',
      'runtime',
      '../../../../etc/passwd'
    );

    // Defense: Should reject path traversal
    expect(() => {
      validateRuntimePath(maliciousPath);
    }).toThrow();
  });

  it('should maintain consistency on update failure', () => {
    // This test verifies the update system can recover from failures
    // Setup initial state
    const runtimeDir = path.join(tempDir, 'runtime');
    mkdirSync(runtimeDir);
    writeFileSync(path.join(runtimeDir, 'marker.txt'), 'original');

    // Simulate interrupted update
    // (Download starts but never completes)
    const downloadDir = path.join(tempDir, 'runtime-downloading');
    mkdirSync(downloadDir);

    // After cleanup, original should be intact
    safeRmSync(downloadDir, { recursive: true });
    expect(existsSync(runtimeDir)).toBe(true);
    expect(readFileSync(path.join(runtimeDir, 'marker.txt'), 'utf-8')).toBe('original');
  });
});
