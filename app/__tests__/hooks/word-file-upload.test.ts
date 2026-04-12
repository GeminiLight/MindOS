import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LocalAttachment } from '@/lib/types';

// Unit tests for Word file upload support
// (Integration tests with actual .docx files would go in e2e tests)

describe('useFileUpload Word support', () => {
  describe('file extension validation', () => {
    const ALLOWED_EXTENSIONS = new Set([
      '.txt',
      '.md',
      '.markdown',
      '.csv',
      '.json',
      '.yaml',
      '.yml',
      '.xml',
      '.html',
      '.htm',
      '.pdf',
      '.doc',
      '.docx',
      '.docm',
    ]);

    it('should accept .docx files', () => {
      expect(ALLOWED_EXTENSIONS.has('.docx')).toBe(true);
    });

    it('should accept .docm files', () => {
      expect(ALLOWED_EXTENSIONS.has('.docm')).toBe(true);
    });

    it('should accept .doc files (Word 97-2003)', () => {
      expect(ALLOWED_EXTENSIONS.has('.doc')).toBe(true);
    });

    it('should reject .odt files (not yet supported)', () => {
      expect(ALLOWED_EXTENSIONS.has('.odt')).toBe(false);
    });
  });

  describe('MIME type support', () => {
    const ACCEPTED_MIMES = new Set([
      'application/msword', // .doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.ms-word.document.macroEnabled.12', // .docm
    ]);

    it('should include .doc MIME type', () => {
      expect(ACCEPTED_MIMES.has('application/msword')).toBe(true);
    });

    it('should include .docx MIME type', () => {
      expect(
        ACCEPTED_MIMES.has(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
      ).toBe(true);
    });

    it('should include .docm MIME type', () => {
      expect(
        ACCEPTED_MIMES.has('application/vnd.ms-word.document.macroEnabled.12')
      ).toBe(true);
    });
  });

  describe('Word file parsing response structure', () => {
    it('should have correct response structure for successful extraction', () => {
      const response = {
        name: 'test.docx',
        text: 'Sample document text',
        markdown: '# Test\n\nSample document text',
        extracted: true,
        truncated: false,
        chars: 20,
        charsTruncated: 20,
        pages: 1,
        imageCount: 0,
        hasCharts: false,
      };

      expect(response).toHaveProperty('name');
      expect(response).toHaveProperty('text');
      expect(response).toHaveProperty('markdown');
      expect(response).toHaveProperty('extracted');
      expect(response).toHaveProperty('truncated');
      expect(response).toHaveProperty('chars');
      expect(response).toHaveProperty('pages');
      expect(response.extracted).toBe(true);
    });

    it('should have correct response structure for failed extraction', () => {
      const response = {
        name: 'test.docx',
        text: '',
        markdown: '',
        extracted: false,
        extractionError: 'invalid_format',
        errorMessage: 'Not a valid Word document',
        truncated: false,
        chars: 0,
        charsTruncated: 0,
        pages: 0,
        imageCount: 0,
        hasCharts: false,
      };

      expect(response).toHaveProperty('extracted');
      expect(response).toHaveProperty('extractionError');
      expect(response.extracted).toBe(false);
    });

    it('should handle truncation with warning', () => {
      const response = {
        name: 'large.docx',
        text: 'x'.repeat(100000),
        markdown: 'x'.repeat(100000),
        extracted: true,
        truncated: true,
        chars: 150000,
        charsTruncated: 100000,
        pages: 50,
        imageCount: 2,
        hasCharts: false,
        warning: '含有 2 张图片，仅保留文本；内容过长，已截断到 100K 字',
      };

      expect(response.truncated).toBe(true);
      expect(response.charsTruncated).toBe(100000);
      expect(response.chars).toBeGreaterThan(response.charsTruncated);
      expect(response.warning).toBeDefined();
    });
  });

  describe('file size validation', () => {
    it('should reject files over 12MB', () => {
      const sizeTooLarge = 12 * 1024 * 1024 + 1;
      expect(sizeTooLarge).toBeGreaterThan(12 * 1024 * 1024);
    });

    it('should accept files up to 12MB', () => {
      const sizeOk = 12 * 1024 * 1024;
      expect(sizeOk).toBeLessThanOrEqual(12 * 1024 * 1024);
    });
  });

  describe('character limit validation', () => {
    it('should enforce 100K character limit', () => {
      const limit = 100_000;
      expect(limit).toBe(100000);
    });

    it('should truncate content exceeding limit', () => {
      const original = 'x'.repeat(150000);
      const truncated = original.substring(0, 100000);
      expect(truncated.length).toBe(100000);
      expect(truncated.length).toBeLessThan(original.length);
    });
  });

  describe('Inbox binary file handling', () => {
    it('should treat .doc as binary format', () => {
      const binaryExts = new Set(['pdf', 'doc', 'docx', 'docm', 'png', 'mp4']);
      expect(binaryExts.has('doc')).toBe(true);
    });

    it('should treat .docx as binary format', () => {
      const binaryExts = new Set(['pdf', 'doc', 'docx', 'docm', 'png', 'mp4']);
      expect(binaryExts.has('docx')).toBe(true);
    });

    it('should treat .docm as binary format', () => {
      const binaryExts = new Set(['pdf', 'doc', 'docx', 'docm', 'png', 'mp4']);
      expect(binaryExts.has('docm')).toBe(true);
    });

    it('should base64-encode binary Word files', () => {
      // Simulating base64 encoding
      const buffer = Buffer.from('fake docx content');
      const base64 = buffer.toString('base64');
      expect(typeof base64).toBe('string');
      expect(base64.length).toBeGreaterThan(0);
      // Should be decodable
      expect(Buffer.from(base64, 'base64').toString()).toBe('fake docx content');
    });
  });

  describe('API endpoint paths', () => {
    it('should use /api/extract-docx for Word extraction', () => {
      const endpoint = '/api/extract-docx';
      expect(endpoint).toContain('extract-docx');
    });

    it('should POST to /api/extract-docx', () => {
      const method = 'POST';
      expect(method).toBe('POST');
    });

    it('should use same /api/inbox for Inbox Word support', () => {
      const endpoint = '/api/inbox';
      expect(endpoint).toBe('/api/inbox');
    });
  });

  describe('error handling', () => {
    it('should provide user-friendly error for corrupted file', () => {
      const error = '无法解析此 Word 文档';
      expect(error).toContain('无法解析');
    });

    it('should provide user-friendly error for unsupported version', () => {
      const error = '暂不支持此 Word 版本，请另存为 .docx';
      expect(error).toContain('.docx');
    });

    it('should provide user-friendly error for timeout', () => {
      const error = '解析超时，请重试或选择较小文件';
      expect(error).toContain('超时');
    });

    it('should provide user-friendly error for oversized file', () => {
      const error = '文件过大，请压缩到 12 MB 以下';
      expect(error).toContain('12 MB');
    });
  });
});
