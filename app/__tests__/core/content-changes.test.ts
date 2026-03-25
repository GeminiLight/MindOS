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

  it('imports legacy Agent-Diff.md agent-diff blocks into change-log', () => {
    const legacyPath = path.join(testMindRoot, 'Agent-Diff.md');
    fs.writeFileSync(legacyPath, [
      '# Agent Changes',
      '```agent-diff',
      JSON.stringify({
        ts: '2025-01-15T10:30:00Z',
        path: 'Profile/Identity.md',
        tool: 'mindos_write_file',
        before: '# Identity\n\nName: Alice',
        after: '# Identity\n\nName: Alice\nRole: Engineer',
      }, null, 2),
      '```',
    ].join('\n'), 'utf-8');

    const events = listContentChanges(testMindRoot, { limit: 10 });
    expect(events.length).toBe(1);
    expect(events[0].op).toBe('legacy_agent_diff_import');
    expect(events[0].path).toBe('Profile/Identity.md');
    expect(events[0].source).toBe('agent');

    const raw = JSON.parse(fs.readFileSync(changeLogPath(testMindRoot), 'utf-8')) as {
      legacy?: { agentDiffImportedCount?: number };
    };
    expect(raw.legacy?.agentDiffImportedCount).toBe(1);
    expect(fs.existsSync(legacyPath)).toBe(false);
  });

  it('imports only new legacy blocks on subsequent reads', () => {
    const legacyPath = path.join(testMindRoot, 'Agent-Diff.md');
    const makeBlock = (pathValue: string) => [
      '```agent-diff',
      JSON.stringify({
        ts: '2025-01-15T10:30:00Z',
        path: pathValue,
        tool: 'mindos_update_lines',
        before: 'a',
        after: 'b',
      }, null, 2),
      '```',
    ].join('\n');

    fs.writeFileSync(legacyPath, `# Agent Changes\n\n${makeBlock('a.md')}\n`, 'utf-8');
    const first = listContentChanges(testMindRoot, { limit: 10 });
    expect(first.map((e) => e.path)).toContain('a.md');

    // Re-create legacy file to simulate users adding it again manually.
    fs.writeFileSync(legacyPath, `# Agent Changes\n\n${makeBlock('a.md')}\n${makeBlock('b.md')}\n`, 'utf-8');
    const second = listContentChanges(testMindRoot, { limit: 10 });
    const importedLegacy = second.filter((e) => e.op === 'legacy_agent_diff_import');
    expect(importedLegacy.length).toBe(2);
    expect(importedLegacy.map((e) => e.path)).toEqual(expect.arrayContaining(['a.md', 'b.md']));
    expect(fs.existsSync(legacyPath)).toBe(false);
  });
});
