import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isGitRepo, gitLog, gitShowFile } from './index';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';

const execFileAsync = promisify(execFile);

describe('Git Operations', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary directory for testing
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-test-'));

    // Initialize git repo
    await execFileAsync('git', ['init'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });

    // Create a test file
    const testFile = path.join(testDir, 'test.md');
    await fs.writeFile(testFile, 'Initial content\n');
    await execFileAsync('git', ['add', 'test.md'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: testDir });

    // Make another commit
    await fs.writeFile(testFile, 'Updated content\n');
    await execFileAsync('git', ['add', 'test.md'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'Update file'], { cwd: testDir });
  });

  afterEach(async () => {
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('isGitRepo', () => {
    it('should return true for a git repository', async () => {
      const result = await isGitRepo(testDir);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('should return false for a non-git directory', async () => {
      const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), 'non-git-'));
      try {
        const result = await isGitRepo(nonGitDir);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toBe(false);
        }
      } finally {
        await fs.rm(nonGitDir, { recursive: true, force: true });
      }
    });
  });

  describe('gitLog', () => {
    it('should retrieve git log for a file', async () => {
      const result = await gitLog(testDir, 'test.md', 10);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(2);
        expect(result.value[0].message).toBe('Update file');
        expect(result.value[1].message).toBe('Initial commit');
      }
    });

    it('should limit the number of log entries', async () => {
      const result = await gitLog(testDir, 'test.md', 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(1);
        expect(result.value[0].message).toBe('Update file');
      }
    });

    it('should return empty array for non-existent file', async () => {
      const result = await gitLog(testDir, 'nonexistent.md', 10);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(0);
      }
    });
  });

  describe('gitShowFile', () => {
    it('should retrieve file content at a specific commit', async () => {
      // Get the first commit hash
      const logResult = await gitLog(testDir, 'test.md', 10);
      expect(logResult.ok).toBe(true);
      if (!logResult.ok) return;

      const firstCommit = logResult.value[1].hash;
      const result = await gitShowFile(testDir, 'test.md', firstCommit);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('Initial content\n');
      }
    });

    it('should return error for invalid commit hash', async () => {
      const result = await gitShowFile(testDir, 'test.md', 'invalid-hash');
      expect(result.ok).toBe(false);
    });

    it('should show older content for a followed file rename', async () => {
      const renameDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-rename-test-'));
      try {
        await execFileAsync('git', ['init'], { cwd: renameDir });
        await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: renameDir });
        await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: renameDir });
        await fs.writeFile(path.join(renameDir, 'old.md'), 'Old content\n');
        await execFileAsync('git', ['add', 'old.md'], { cwd: renameDir });
        await execFileAsync('git', ['commit', '-m', 'Add old file'], { cwd: renameDir });
        const oldCommit = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: renameDir, encoding: 'utf-8' })).stdout.trim();
        await execFileAsync('git', ['mv', 'old.md', 'new.md'], { cwd: renameDir });
        await execFileAsync('git', ['commit', '-m', 'Rename file'], { cwd: renameDir });

        const logResult = await gitLog(renameDir, 'new.md', 10);
        expect(logResult.ok).toBe(true);
        if (!logResult.ok) return;
        expect(logResult.value.map(entry => entry.message)).toContain('Add old file');

        const showResult = await gitShowFile(renameDir, 'new.md', oldCommit);
        expect(showResult.ok).toBe(true);
        if (showResult.ok) {
          expect(showResult.value).toBe('Old content\n');
        }
      } finally {
        await fs.rm(renameDir, { recursive: true, force: true });
      }
    });
  });
});
