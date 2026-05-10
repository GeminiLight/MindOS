/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendEntry,
  loadHistory,
  normalizeHistoryEntries,
  saveHistory,
  type OrganizeHistoryEntry,
} from '@/lib/organize-history';

const STORAGE_KEY = 'mindos:organize-history';

const validEntry: OrganizeHistoryEntry = {
  id: 'org-1',
  timestamp: 1_700_000_000_000,
  sourceFiles: ['notes.md'],
  files: [{ action: 'create', path: 'Inbox/notes.md', ok: true }],
  status: 'completed',
  source: 'upload',
  durationMs: 42,
};

describe('organize history storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('normalizes non-array history caches to empty history', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries: [validEntry] }));

    expect(loadHistory()).toEqual([]);
  });

  it('filters malformed history entries', () => {
    expect(normalizeHistoryEntries([
      validEntry,
      { ...validEntry, id: 123 },
      { ...validEntry, files: [{ action: 'delete', path: 'x.md', ok: true }] },
      { ...validEntry, status: 'done' },
    ])).toEqual([validEntry]);
  });

  it('appends onto corrupted history cache without throwing', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries: 'bad shape' }));

    expect(() => appendEntry(validEntry)).not.toThrow();
    expect(loadHistory()).toEqual([validEntry]);
  });

  it('saves only the first 50 valid entries', () => {
    const entries = Array.from({ length: 55 }, (_, i) => ({
      ...validEntry,
      id: `org-${i}`,
      timestamp: validEntry.timestamp + i,
    }));

    saveHistory(entries);

    expect(loadHistory()).toHaveLength(50);
    expect(loadHistory()[0].id).toBe('org-0');
  });
});
