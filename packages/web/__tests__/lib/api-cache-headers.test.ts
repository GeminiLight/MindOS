import { describe, it, expect } from 'vitest';
import { generateETag, generateJsonETag, formatBytes } from '@/lib/api-cache-headers';

describe('api-cache-headers', () => {
  describe('generateETag', () => {
    it('should generate consistent ETag for same content', () => {
      const etag1 = generateETag('test content');
      const etag2 = generateETag('test content');
      
      expect(etag1).toBe(etag2);
    });

    it('should generate different ETag for different content', () => {
      const etag1 = generateETag('content 1');
      const etag2 = generateETag('content 2');
      
      expect(etag1).not.toBe(etag2);
    });

    it('should return quoted ETag per HTTP spec', () => {
      const etag = generateETag('test');
      
      expect(etag).toMatch(/^"[a-f0-9]+"$/);
    });

    it('should be 14 chars (12 hex + 2 quotes)', () => {
      const etag = generateETag('test');
      
      expect(etag.length).toBe(14);
    });
  });

  describe('generateJsonETag', () => {
    it('should generate ETag from JSON object', () => {
      const obj = { name: 'test', value: 123 };
      const etag = generateJsonETag(obj);
      
      expect(etag).toMatch(/^"[a-f0-9]+"$/);
    });

    it('should be consistent for same object', () => {
      const etag1 = generateJsonETag({ a: 1, b: 2 });
      const etag2 = generateJsonETag({ a: 1, b: 2 });
      
      expect(etag1).toBe(etag2);
    });

    it('should differ for different key order (JSON.stringify is order-sensitive)', () => {
      // This is expected behavior — JSON.stringify({ a: 1, b: 2 }) !== JSON.stringify({ b: 2, a: 1 })
      const etag1 = generateJsonETag({ a: 1, b: 2 });
      const etag2 = generateJsonETag({ b: 2, a: 1 });
      
      expect(etag1).not.toBe(etag2);
    });
  });

  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
      expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB');
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    });
  });
});
