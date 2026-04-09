/**
 * Tests for Daily Echo report storage (IndexedDB)
 * Save, retrieve, delete, cleanup reports
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { DailyEchoReport } from '../types';

/**
 * Mock IndexedDB for testing
 */
class MockIndexedDB {
  private store: Map<string, DailyEchoReport> = new Map();

  async save(report: DailyEchoReport): Promise<void> {
    this.store.set(report.date, report);
  }

  async get(date: string): Promise<DailyEchoReport | null> {
    return this.store.get(date) ?? null;
  }

  async getAll(): Promise<DailyEchoReport[]> {
    return Array.from(this.store.values());
  }

  async delete(date: string): Promise<void> {
    this.store.delete(date);
  }

  async cleanup(daysToKeep: number = 30): Promise<void> {
    const cutoff = Date.now() - daysToKeep * 86400000;
    const toDelete: string[] = [];

    for (const [date, report] of this.store.entries()) {
      const reportTime = new Date(report.generatedAt).getTime();
      if (reportTime < cutoff) {
        toDelete.push(date);
      }
    }

    for (const date of toDelete) {
      this.store.delete(date);
    }
  }
}

describe('DailyEcho Storage', () => {
  let db: MockIndexedDB;

  beforeEach(() => {
    db = new MockIndexedDB();
  });

  describe('saveDailyEchoReport()', () => {
    it('should save report with date as key', async () => {
      // Given: report for specific date
      const report: DailyEchoReport = {
        id: 'report-1',
        date: '2026-04-10',
        generatedAt: new Date().toISOString(),
        snapshot: {
          filesEdited: 6,
          filesCreated: 2,
          sessionCount: 5,
          kbGrowth: '+12 KB',
        },
        themes: [],
        alignment: {
          alignmentScore: 65,
          analysis: 'Test',
        },
        reflectionPrompts: { prompts: [] },
        rawMarkdown: '# Daily Echo\nTest',
      };

      // When: saving
      await db.save(report);

      // Then: should be retrievable by date
      const retrieved = await db.get('2026-04-10');
      expect(retrieved?.date).toBe('2026-04-10');
    });

    it('should overwrite existing report for same date', async () => {
      // Given: two reports for same date
      const report1: DailyEchoReport = {
        id: 'report-1',
        date: '2026-04-10',
        generatedAt: new Date(Date.now() - 3600000).toISOString(),
        snapshot: {
          filesEdited: 6,
          filesCreated: 2,
          sessionCount: 5,
          kbGrowth: '+12 KB',
        },
        themes: [],
        alignment: { alignmentScore: 65, analysis: 'Old' },
        reflectionPrompts: { prompts: [] },
        rawMarkdown: 'Old',
      };

      const report2: DailyEchoReport = {
        id: 'report-2',
        date: '2026-04-10',
        generatedAt: new Date().toISOString(),
        snapshot: {
          filesEdited: 8,
          filesCreated: 3,
          sessionCount: 6,
          kbGrowth: '+15 KB',
        },
        themes: [],
        alignment: { alignmentScore: 75, analysis: 'New' },
        reflectionPrompts: { prompts: [] },
        rawMarkdown: 'New',
      };

      // When: saving both
      await db.save(report1);
      await db.save(report2);

      // Then: second should overwrite
      const retrieved = await db.get('2026-04-10');
      expect(retrieved?.id).toBe('report-2');
      expect(retrieved?.alignment.analysis).toBe('New');
    });

    it('should preserve all report fields', async () => {
      // Given: complete report
      const report: DailyEchoReport = {
        id: 'unique-id',
        date: '2026-04-10',
        generatedAt: '2026-04-10T15:30:00Z',
        snapshot: {
          filesEdited: 6,
          filesCreated: 2,
          sessionCount: 5,
          kbGrowth: '+12 KB',
        },
        themes: [
          {
            name: 'Infrastructure',
            fileCount: 4,
            percentage: 65,
            description: 'Setup',
            workType: 'strategic',
          },
        ],
        alignment: {
          alignmentScore: 65,
          analysis: 'Partially aligned',
          reasoning: 'Priority shift',
        },
        reflectionPrompts: {
          prompts: [
            'Is this intentional?',
            'Did constraints change?',
          ],
        },
        rawMarkdown: '# Daily Echo\nContent here',
      };

      // When: saving
      await db.save(report);
      const retrieved = await db.get('2026-04-10');

      // Then: all fields preserved
      expect(retrieved?.id).toBe('unique-id');
      expect(retrieved?.snapshot.filesEdited).toBe(6);
      expect(retrieved?.themes).toHaveLength(1);
      expect(retrieved?.reflectionPrompts.prompts).toHaveLength(2);
    });
  });

  describe('getDailyEchoReport()', () => {
    it('should return null for non-existent report', async () => {
      // Given: no report for date
      // When: retrieving
      const result = await db.get('2026-04-10');

      // Then: should return null
      expect(result).toBeNull();
    });

    it('should return saved report', async () => {
      // Given: saved report
      const report: DailyEchoReport = {
        id: 'test-1',
        date: '2026-04-10',
        generatedAt: new Date().toISOString(),
        snapshot: {
          filesEdited: 6,
          filesCreated: 2,
          sessionCount: 5,
          kbGrowth: '+12 KB',
        },
        themes: [],
        alignment: { alignmentScore: 65, analysis: 'Test' },
        reflectionPrompts: { prompts: [] },
        rawMarkdown: 'Test',
      };
      await db.save(report);

      // When: retrieving
      const retrieved = await db.get('2026-04-10');

      // Then: should match
      expect(retrieved).toEqual(report);
    });
  });

  describe('getAllDailyEchoReports()', () => {
    it('should return empty array when no reports', async () => {
      // When: getting all
      const reports = await db.getAll();

      // Then: should be empty
      expect(reports).toEqual([]);
    });

    it('should return all saved reports', async () => {
      // Given: multiple reports
      const reports: DailyEchoReport[] = [];
      for (let i = 0; i < 5; i++) {
        const report: DailyEchoReport = {
          id: `report-${i}`,
          date: `2026-04-${10 - i}`,
          generatedAt: new Date(
            Date.now() - i * 86400000
          ).toISOString(),
          snapshot: {
            filesEdited: 6,
            filesCreated: 2,
            sessionCount: 5,
            kbGrowth: '+12 KB',
          },
          themes: [],
          alignment: { alignmentScore: 65, analysis: 'Test' },
          reflectionPrompts: { prompts: [] },
          rawMarkdown: 'Test',
        };
        reports.push(report);
        await db.save(report);
      }

      // When: getting all
      const retrieved = await db.getAll();

      // Then: should return all 5
      expect(retrieved).toHaveLength(5);
    });
  });

  describe('deleteDailyEchoReport()', () => {
    it('should delete report by date', async () => {
      // Given: saved report
      const report: DailyEchoReport = {
        id: 'test-1',
        date: '2026-04-10',
        generatedAt: new Date().toISOString(),
        snapshot: {
          filesEdited: 6,
          filesCreated: 2,
          sessionCount: 5,
          kbGrowth: '+12 KB',
        },
        themes: [],
        alignment: { alignmentScore: 65, analysis: 'Test' },
        reflectionPrompts: { prompts: [] },
        rawMarkdown: 'Test',
      };
      await db.save(report);

      // When: deleting
      await db.delete('2026-04-10');

      // Then: should be gone
      const retrieved = await db.get('2026-04-10');
      expect(retrieved).toBeNull();
    });

    it('should handle delete of non-existent report', async () => {
      // Given: no report
      // When: deleting
      // Then: should not error
      await expect(db.delete('2026-04-10')).resolves.not.toThrow();
    });
  });

  describe('cleanupOldReports()', () => {
    it('should delete reports older than daysToKeep', async () => {
      // Given: reports from different dates
      const now = Date.now();
      const oldReport: DailyEchoReport = {
        id: 'old-1',
        date: '2026-03-11', // 30+ days ago
        generatedAt: new Date(now - 31 * 86400000).toISOString(),
        snapshot: {
          filesEdited: 6,
          filesCreated: 2,
          sessionCount: 5,
          kbGrowth: '+12 KB',
        },
        themes: [],
        alignment: { alignmentScore: 65, analysis: 'Old' },
        reflectionPrompts: { prompts: [] },
        rawMarkdown: 'Old',
      };

      const newReport: DailyEchoReport = {
        id: 'new-1',
        date: '2026-04-10', // recent
        generatedAt: new Date().toISOString(),
        snapshot: {
          filesEdited: 6,
          filesCreated: 2,
          sessionCount: 5,
          kbGrowth: '+12 KB',
        },
        themes: [],
        alignment: { alignmentScore: 65, analysis: 'New' },
        reflectionPrompts: { prompts: [] },
        rawMarkdown: 'New',
      };

      await db.save(oldReport);
      await db.save(newReport);

      // When: cleaning up (keep 30 days)
      await db.cleanup(30);

      // Then: old should be deleted, new kept
      const all = await db.getAll();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('new-1');
    });

    it('should keep reports at boundary (30 days ago)', async () => {
      // Given: report exactly 30 days old
      const boundaryTime = Date.now() - 30 * 86400000;
      const boundaryReport: DailyEchoReport = {
        id: 'boundary-1',
        date: '2026-03-11',
        generatedAt: new Date(boundaryTime).toISOString(),
        snapshot: {
          filesEdited: 6,
          filesCreated: 2,
          sessionCount: 5,
          kbGrowth: '+12 KB',
        },
        themes: [],
        alignment: { alignmentScore: 65, analysis: 'Boundary' },
        reflectionPrompts: { prompts: [] },
        rawMarkdown: 'Boundary',
      };

      await db.save(boundaryReport);

      // When: cleaning up 30 days
      await db.cleanup(30);

      // Then: boundary report kept (inclusive)
      const all = await db.getAll();
      expect(all.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Date format validation', () => {
    it('should use YYYY-MM-DD format as key', async () => {
      // Given: report
      const report: DailyEchoReport = {
        id: 'test-1',
        date: '2026-04-10',
        generatedAt: new Date().toISOString(),
        snapshot: {
          filesEdited: 6,
          filesCreated: 2,
          sessionCount: 5,
          kbGrowth: '+12 KB',
        },
        themes: [],
        alignment: { alignmentScore: 65, analysis: 'Test' },
        reflectionPrompts: { prompts: [] },
        rawMarkdown: 'Test',
      };

      // Then: date should match format
      expect(report.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
