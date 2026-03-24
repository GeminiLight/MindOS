import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { testMindRoot } from '../setup';
import {
  appendContentChange,
  listContentChanges,
  getContentChangeSummary,
  markContentChangesSeen,
} from '../../lib/core/content-changes';

function changeLogPath(root: string) {
  return path.join(root, '.mindos', 'change-log.json');
}

describe('core/content-changes', () => {
  it('creates .mindos/change-log.json on first append', () => {
    appendContentChange(testMindRoot, {
      op: 'save_file',
      path: 'note.md',
      source: 'user',
      before: 'a',
      after: 'b',
      summary: 'updated file',
    });

    expect(fs.existsSync(changeLogPath(testMindRoot))).toBe(true);
    const raw = fs.readFileSync(changeLogPath(testMindRoot), 'utf-8');
    const json = JSON.parse(raw) as { events: unknown[] };
    expect(Array.isArray(json.events)).toBe(true);
    expect(json.events.length).toBe(1);
  });

  it('lists latest events first and supports path filter', () => {
    appendContentChange(testMindRoot, {
      op: 'save_file',
      path: 'a.md',
      source: 'user',
      before: '1',
      after: '2',
      summary: 'a changed',
    });
    appendContentChange(testMindRoot, {
      op: 'save_file',
      path: 'b.md',
      source: 'agent',
      before: 'x',
      after: 'y',
      summary: 'b changed',
    });

    const all = listContentChanges(testMindRoot, { limit: 10 });
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all[0].ts >= all[1].ts).toBe(true);

    const onlyA = listContentChanges(testMindRoot, { path: 'a.md', limit: 10 });
    expect(onlyA.every((e) => e.path === 'a.md')).toBe(true);
  });

  it('computes unread summary and mark seen resets unread', () => {
    appendContentChange(testMindRoot, {
      op: 'save_file',
      path: 'summary.md',
      source: 'agent',
      before: '',
      after: 'new',
      summary: 'summary changed',
    });
    const beforeSeen = getContentChangeSummary(testMindRoot);
    expect(beforeSeen.unreadCount).toBeGreaterThan(0);

    markContentChangesSeen(testMindRoot);
    const afterSeen = getContentChangeSummary(testMindRoot);
    expect(afterSeen.unreadCount).toBe(0);
  });
});
