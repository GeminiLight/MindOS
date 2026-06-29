import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
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
    // JSONL format: one event per line, plus a meta sidecar marking the format.
    const lines = fs.readFileSync(changeLogPath(testMindRoot), 'utf-8').trim().split('\n');
    expect(lines.length).toBe(1);
    expect((JSON.parse(lines[0]) as { op: string }).op).toBe('save_file');
    expect(fs.existsSync(path.join(testMindRoot, '.mindos', 'change-log.meta.json'))).toBe(true);
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

  it('supports space and concrete agent filters', () => {
    appendContentChange(testMindRoot, {
      op: 'save_file',
      path: 'Research/a.md',
      source: 'agent',
      agentName: 'codex',
      before: '',
      after: 'agent',
      summary: 'agent changed',
    });
    appendContentChange(testMindRoot, {
      op: 'save_file',
      path: 'Personal/b.md',
      source: 'agent',
      agentName: 'claude-code',
      before: '',
      after: 'agent',
      summary: 'agent changed',
    });

    expect(listContentChanges(testMindRoot, { space: 'Research', limit: 10 }).every((e) => e.path.startsWith('Research/'))).toBe(true);
    expect(listContentChanges(testMindRoot, { agent: 'codex', limit: 10 }).every((e) => e.agentName === 'codex')).toBe(true);
    expect(listContentChanges(testMindRoot, { q: 'codex', limit: 10 }).some((e) => e.agentName === 'codex')).toBe(true);
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

    // Import counters now live in the meta sidecar, not the events file.
    const meta = JSON.parse(fs.readFileSync(path.join(testMindRoot, '.mindos', 'change-log.meta.json'), 'utf-8')) as {
      legacy?: { agentDiffImportedCount?: number };
    };
    expect(meta.legacy?.agentDiffImportedCount).toBe(1);
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

  it('migrates a legacy pretty-printed change log to JSONL once, carrying lastSeenAt', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-content-log-migrate-'));
    try {
      fs.mkdirSync(path.join(root, '.mindos'), { recursive: true });
      fs.writeFileSync(changeLogPath(root), JSON.stringify({
        version: 1,
        lastSeenAt: '2026-01-01T12:00:00.000Z',
        events: [
          { id: 'new', ts: '2026-01-02T00:00:00.000Z', op: 'save_file', path: 'a.md', source: 'user', summary: 'newer' },
          { id: 'old', ts: '2026-01-01T00:00:00.000Z', op: 'save_file', path: 'a.md', source: 'user', summary: 'older' },
        ],
      }, null, 2), 'utf-8');

      expect(listContentChanges(root, { limit: 10 }).map((e) => e.id)).toEqual(['new', 'old']);
      const summary = getContentChangeSummary(root);
      expect(summary.lastSeenAt).toBe('2026-01-01T12:00:00.000Z');
      expect(summary.unreadCount).toBe(1);

      // On disk the file is now JSONL, oldest-first.
      const lines = fs.readFileSync(changeLogPath(root), 'utf-8').trim().split('\n');
      expect(lines.map((line) => (JSON.parse(line) as { id: string }).id)).toEqual(['old', 'new']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('marks changes seen without rewriting the events file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-content-log-seen-'));
    try {
      appendContentChange(root, { op: 'save_file', path: 'a.md', source: 'user', summary: 'changed' });
      const before = fs.statSync(changeLogPath(root)).mtimeMs;

      markContentChangesSeen(root);

      expect(fs.statSync(changeLogPath(root)).mtimeMs).toBe(before);
      expect(getContentChangeSummary(root).unreadCount).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not write change logs through a symlinked .mindos directory outside mindRoot', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-content-log-root-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-content-log-outside-'));
    try {
      fs.symlinkSync(outside, path.join(root, '.mindos'), 'dir');

      expect(() => appendContentChange(root, {
        op: 'save_file',
        path: 'note.md',
        source: 'user',
        summary: 'updated',
      })).toThrow('Access denied');
      expect(fs.existsSync(path.join(outside, 'change-log.json'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
