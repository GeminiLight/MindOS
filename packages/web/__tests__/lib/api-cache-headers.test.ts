import { describe, it, expect } from 'vitest';
import { formatBytes } from '@/lib/api-cache-headers';

// The unused ETag/Cache-Control helpers were removed from this module during
// the data-fetching perf hardening pass; only formatBytes remains in use
// (via lib/api-file-size-validation.ts).
describe('api-cache-headers', () => {
  describe('formatBytes', () => {
    it('formats common byte magnitudes', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
      expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB');
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    });

    it('formats sub-kilobyte values in bytes', () => {
      expect(formatBytes(512)).toBe('512.0 B');
    });
  });
});
