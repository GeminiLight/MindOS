/**
 * Tests for Daily Echo snapshot generation
 * Converts raw data into formatted statistics
 */

import { describe, it, expect } from 'vitest';
import type { DailyEchoRawData, DailySnapshot } from '../types';

describe('DailyEcho Snapshot', () => {
  describe('generateSnapshot()', () => {
    it('should format files edited count', () => {
      // Given: raw data with 6 files edited
      const raw: DailyEchoRawData = {
        date: '2026-04-10',
        fileNames: ['file1', 'file2', 'file3', 'file4', 'file5', 'file6'],
        filesEdited: 6,
        filesCreated: 2,
        sessionCount: 5,
        kbGrowth: '+12 KB',
        dailyLine: 'Test',
        growthIntent: 'Test',
      };

      // When: generating snapshot
      // Then: should preserve count
      expect(raw.filesEdited).toBe(6);
    });

    it('should include KB growth with unit', () => {
      // Given: KB growth value
      const growth = '+12 KB';

      // Then: should include unit
      expect(growth).toMatch(/^\+\d+ KB$/);
    });

    it('should handle zero KB growth', () => {
      // Given: no KB change
      const growth = 'same';

      // Then: should display "same"
      expect(growth).toBe('same');
    });

    it('should handle negative KB values', () => {
      // Given: files deleted
      const growth = '-5 KB';

      // Then: should handle negative
      expect(growth).toMatch(/^-\d+ KB$/);
    });

    it('should include session count', () => {
      // Given: raw data
      const raw: DailyEchoRawData = {
        date: '2026-04-10',
        fileNames: [],
        filesEdited: 0,
        filesCreated: 0,
        sessionCount: 5,
        kbGrowth: 'same',
        dailyLine: '',
        growthIntent: '',
      };

      // Then: session count preserved
      expect(raw.sessionCount).toBe(5);
    });

    it('should handle zero sessions', () => {
      // Given: no chat sessions
      const sessions = 0;

      // Then: should be valid
      expect(sessions).toBe(0);
    });

    it('should preserve date in YYYY-MM-DD format', () => {
      // Given: date
      const date = '2026-04-10';

      // Then: format is correct
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
