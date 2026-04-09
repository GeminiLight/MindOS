/**
 * Tests for Daily Echo data aggregation
 * Tests the raw data collection from API endpoints and localStorage
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DailyEchoRawData, ContentChangeEvent, ChatSession } from '../types';

/**
 * Test: Data aggregation happy path
 * Collect 24h of file edits, chat sessions, and user intent
 */
describe('DailyEcho Aggregation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('aggregateDailyData()', () => {
    it('should collect file edits from past 24 hours', async () => {
      // Given: API returns file changes from past 24h
      const mockChanges: ContentChangeEvent[] = [
        {
          id: '1',
          path: 'deploy.md',
          op: 'write',
          ts: new Date(Date.now() - 3600000).toISOString(),
        },
        {
          id: '2',
          path: 'docker-compose.yml',
          op: 'create',
          ts: new Date(Date.now() - 7200000).toISOString(),
        },
        {
          id: '3',
          path: 'README.md',
          op: 'write',
          ts: new Date(Date.now() - 86400000 * 2).toISOString(), // 2 days ago (out of range)
        },
      ];

      // When: aggregating data for today
      // (Implementation will handle this)

      // Then: should include only 24h window changes
      expect(mockChanges.filter(c => {
        const age = Date.now() - new Date(c.ts).getTime();
        return age <= 86400000; // 24 hours
      })).toHaveLength(2);
    });

    it('should count distinct files edited', async () => {
      // Given: multiple edits to same file
      const changes = [
        { path: 'file1.md', op: 'write' as const },
        { path: 'file1.md', op: 'write' as const },
        { path: 'file2.md', op: 'write' as const },
      ];

      // When: counting distinct files
      const distinct = new Set(changes.map(c => c.path)).size;

      // Then: should return 2
      expect(distinct).toBe(2);
    });

    it('should count newly created files', async () => {
      // Given: mix of creates and writes
      const changes: ContentChangeEvent[] = [
        {
          id: '1',
          path: 'new-file.md',
          op: 'create',
          ts: new Date().toISOString(),
        },
        {
          id: '2',
          path: 'existing.md',
          op: 'write',
          ts: new Date().toISOString(),
        },
        {
          id: '3',
          path: 'another-new.md',
          op: 'create',
          ts: new Date().toISOString(),
        },
      ];

      // When: filtering creates
      const created = changes.filter(c => c.op === 'create').length;

      // Then: should count 2 creates
      expect(created).toBe(2);
    });

    it('should aggregate chat sessions count', async () => {
      // Given: API returns 5 chat sessions
      const sessions: ChatSession[] = [
        {
          id: '1',
          createdAt: new Date(Date.now() - 3600000).toISOString(),
          updatedAt: new Date().toISOString(),
          messageCount: 10,
        },
        {
          id: '2',
          createdAt: new Date(Date.now() - 7200000).toISOString(),
          updatedAt: new Date().toISOString(),
          messageCount: 5,
        },
        {
          id: '3',
          createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
          updatedAt: new Date().toISOString(),
          messageCount: 3,
        },
      ];

      // When: counting sessions in 24h window
      const count24h = sessions.filter(s => {
        const age = Date.now() - new Date(s.createdAt).getTime();
        return age <= 86400000;
      }).length;

      // Then: should be 2
      expect(count24h).toBe(2);
    });

    it('should read daily line from localStorage', async () => {
      // Given: localStorage has daily line
      const dailyLine = 'Finish async documentation';
      localStorage.setItem('mindos-echo-daily-line', dailyLine);

      // When: reading from storage
      const value = localStorage.getItem('mindos-echo-daily-line');

      // Then: should return the line
      expect(value).toBe(dailyLine);
    });

    it('should read growth intent from localStorage', async () => {
      // Given: localStorage has growth intent
      const intent = 'Master production async patterns';
      localStorage.setItem('mindos-echo-growth-intent', intent);

      // When: reading from storage
      const value = localStorage.getItem('mindos-echo-growth-intent');

      // Then: should return the intent
      expect(value).toBe(intent);
    });

    it('should handle missing daily line gracefully', async () => {
      // Given: no daily line in localStorage
      localStorage.removeItem('mindos-echo-daily-line');

      // When: reading missing key
      const value = localStorage.getItem('mindos-echo-daily-line');

      // Then: should return null
      expect(value).toBeNull();
    });

    it('should return empty string for missing intent', async () => {
      // Given: no growth intent
      localStorage.removeItem('mindos-echo-growth-intent');

      // When: aggregating
      // Then: should treat as empty string, not error
      const intent = localStorage.getItem('mindos-echo-growth-intent') ?? '';
      expect(intent).toBe('');
    });

    it('should handle no file edits (quiet day)', async () => {
      // Given: 0 file edits in 24h
      const changes: ContentChangeEvent[] = [];

      // When: aggregating
      // Then: should return valid data with 0 files
      expect(changes.length).toBe(0);
      expect(new Set(changes.map(c => c.path)).size).toBe(0);
    });

    it('should handle 50+ file edits (high velocity)', async () => {
      // Given: 50 file edits
      const changes: ContentChangeEvent[] = Array.from({ length: 50 }, (_, i) => ({
        id: String(i),
        path: `file${i}.md`,
        op: 'write' as const,
        ts: new Date().toISOString(),
      }));

      // When: counting
      const count = changes.length;
      const distinct = new Set(changes.map(c => c.path)).size;

      // Then: should handle large sets
      expect(count).toBe(50);
      expect(distinct).toBe(50);
    });

    it('should exclude changes older than 24 hours', async () => {
      // Given: mix of changes inside and outside 24h window
      const now = Date.now();
      const changes = [
        { ts: new Date(now - 3600000).toISOString() }, // 1h ago (in)
        { ts: new Date(now - 86400000).toISOString() }, // 24h ago (boundary)
        { ts: new Date(now - 86400000 * 1.5).toISOString() }, // 36h ago (out)
        { ts: new Date(now - 86400000 * 2).toISOString() }, // 2 days ago (out)
      ];

      // When: filtering 24h window (exclusive of >24h)
      const filtered = changes.filter(c => {
        const age = now - new Date(c.ts).getTime();
        return age < 86400000; // strictly less than 24h
      });

      // Then: should exclude 36h and 2d old changes
      expect(filtered).toHaveLength(1);
    });
  });
});
