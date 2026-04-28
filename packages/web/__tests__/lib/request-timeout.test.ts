import { describe, it, expect, vi } from 'vitest';
import { withTimeout, isTimeoutError } from '@/lib/request-timeout';

describe('request-timeout', () => {
  describe('withTimeout', () => {
    it('should resolve when promise completes before timeout', async () => {
      const result = await withTimeout(
        Promise.resolve('success'),
        1000,
        'test timeout'
      );
      expect(result).toBe('success');
    });

    it('should throw TimeoutError when promise exceeds timeout', async () => {
      const slowPromise = new Promise(resolve => 
        setTimeout(() => resolve('done'), 2000)
      );
      
      await expect(
        withTimeout(slowPromise, 100, 'Timed out')
      ).rejects.toThrow('Timed out');
    });

    it('should have TIMEOUT error code', async () => {
      const slowPromise = new Promise(resolve => 
        setTimeout(() => resolve('done'), 2000)
      );
      
      try {
        await withTimeout(slowPromise, 100, 'test');
      } catch (err: any) {
        expect(err.code).toBe('TIMEOUT');
      }
    });

    it('should reject if promise rejects before timeout', async () => {
      const failingPromise = Promise.reject(new Error('Custom error'));
      
      await expect(
        withTimeout(failingPromise, 1000, 'test')
      ).rejects.toThrow('Custom error');
    });

    it('should clear timeout handle after resolution', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      
      await withTimeout(Promise.resolve('done'), 1000);
      
      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });

  describe('isTimeoutError', () => {
    it('should return true for timeout error with TIMEOUT code', () => {
      const err = new Error('test timeout');
      (err as any).code = 'TIMEOUT';
      
      expect(isTimeoutError(err)).toBe(true);
    });

    it('should return false for error message mentioning timeout but without TIMEOUT code', () => {
      const err = new Error('Connection timeout after 5s');
      expect(isTimeoutError(err)).toBe(false);
    });

    it('should return false for other errors', () => {
      expect(isTimeoutError(new Error('Network error'))).toBe(false);
      expect(isTimeoutError(new Error('File not found'))).toBe(false);
    });

    it('should handle non-Error types', () => {
      expect(isTimeoutError(null)).toBe(false);
      expect(isTimeoutError('error string')).toBe(false);
      expect(isTimeoutError({})).toBe(false);
    });
  });
});
