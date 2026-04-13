import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateFileSize, validateFileBatch, MAX_FILE_SIZE, MAX_TOTAL_ATTACHED_SIZE } from '@/lib/api-file-size-validation';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('api-file-size-validation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
  });

  afterEach(() => {
    // Clean up temp files
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('validateFileSize', () => {
    it('should accept file within size limits', () => {
      const testFile = path.join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'content');

      const result = validateFileSize(testFile, 0);

      expect(result.valid).toBe(true);
      expect(result.fileSize).toBeGreaterThan(0);
      expect(result.newCumulativeSize).toBe(result.fileSize);
    });

    it('should reject file that exceeds individual limit', () => {
      const testFile = path.join(tempDir, 'large.txt');
      // Create a file slightly larger than MAX_FILE_SIZE
      const oversizedContent = Buffer.alloc(MAX_FILE_SIZE + 1);
      fs.writeFileSync(testFile, oversizedContent);

      const result = validateFileSize(testFile, 0);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('too large');
    });

    it('should reject when cumulative size exceeds limit', () => {
      const testFile = path.join(tempDir, 'test.txt');
      // Create a file that will exceed cumulative limit
      const largeContent = Buffer.alloc(5 * 1024 * 1024); // 5 MB
      fs.writeFileSync(testFile, largeContent);

      // Start with cumulative size near the limit
      const result = validateFileSize(testFile, MAX_TOTAL_ATTACHED_SIZE - 1 * 1024 * 1024);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('too large');
    });

    it('should not leak full path in error messages (security)', () => {
      const testFile = path.join(tempDir, 'large.txt');
      const oversizedContent = Buffer.alloc(MAX_FILE_SIZE + 1);
      fs.writeFileSync(testFile, oversizedContent);

      const result = validateFileSize(testFile, 0);

      expect(result.valid).toBe(false);
      // Error should show basename only, not full directory path
      expect(result.error).toContain('large.txt');
      expect(result.error).not.toContain(tempDir);
    });

    it('should handle non-existent files', () => {
      const result = validateFileSize('/non/existent/file.txt', 0);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Cannot access');
    });
  });

  describe('validateFileBatch', () => {
    it('should validate multiple files', () => {
      const files = [1, 2, 3].map(i => {
        const f = path.join(tempDir, `file${i}.txt`);
        fs.writeFileSync(f, `content ${i}`);
        return f;
      });

      const result = validateFileBatch(files);

      expect(result.valid).toBe(true);
      expect(result.results).toHaveLength(3);
      expect(result.results.every(r => r.valid)).toBe(true);
    });

    it('should stop on first error', () => {
      const file1 = path.join(tempDir, 'file1.txt');
      fs.writeFileSync(file1, 'content');

      const file2 = '/non/existent/file.txt';

      const result = validateFileBatch([file1, file2]);

      expect(result.valid).toBe(false);
      expect(result.results).toHaveLength(2);
      expect(result.results[1].valid).toBe(false);
    });
  });
});
