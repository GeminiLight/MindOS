import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getContentChangeSummaryFromLog,
  listContentChangesFromLog,
  markContentChangesSeenInLog,
} from './change-log-store.js';

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'mindos-change-log-store-'));
}

function changeLogPath(root: string): string {
  return join(root, '.mindos', 'change-log.json');
}

function seedJsonlEvents(root: string, events: Array<Record<string, unknown>>): void {
  mkdirSync(join(root, '.mindos'), { recursive: true });
  // Oldest-first on disk, as written by the JSONL appenders.
  writeFileSync(changeLogPath(root), events.map((event) => `${JSON.stringify(event)}\n`).join(''), 'utf-8');
  writeFileSync(join(root, '.mindos', 'change-log.meta.json'), JSON.stringify({ version: 2, lastSeenAt: null, legacy: {} }), 'utf-8');
}

describe('handlers/change-log store', () => {
  it('lists JSONL change events newest-first with filters and limit', () => {
    const root = makeRoot();
    seedJsonlEvents(root, [
      { id: '1', ts: '2026-01-01T00:00:00.000Z', op: 'save_file', path: 'a.md', source: 'user', summary: 'a changed' },
      { id: '2', ts: '2026-01-02T00:00:00.000Z', op: 'save_file', path: 'b.md', source: 'agent', summary: 'b changed' },
    ]);

    const all = listContentChangesFromLog(root, {});
    expect(all.map((event) => event.id)).toEqual(['2', '1']);

    expect(listContentChangesFromLog(root, { path: 'a.md' }).map((event) => event.id)).toEqual(['1']);
    expect(listContentChangesFromLog(root, { source: 'agent' }).map((event) => event.id)).toEqual(['2']);
    expect(listContentChangesFromLog(root, { q: 'b changed' }).map((event) => event.id)).toEqual(['2']);
    expect(listContentChangesFromLog(root, { limit: 1 }).map((event) => event.id)).toEqual(['2']);
  });

  it('migrates a legacy pretty-printed change log on first read, carrying lastSeenAt', () => {
    const root = makeRoot();
    mkdirSync(join(root, '.mindos'), { recursive: true });
    writeFileSync(changeLogPath(root), JSON.stringify({
      version: 1,
      lastSeenAt: '2026-01-01T12:00:00.000Z',
      events: [
        { id: 'new', ts: '2026-01-02T00:00:00.000Z', op: 'save_file', path: 'a.md', source: 'user', summary: 'newer' },
        { id: 'old', ts: '2026-01-01T00:00:00.000Z', op: 'save_file', path: 'a.md', source: 'user', summary: 'older' },
      ],
      legacy: { agentDiffImportedCount: 0, lastImportedAt: null },
    }, null, 2), 'utf-8');

    const events = listContentChangesFromLog(root, {});
    expect(events.map((event) => event.id)).toEqual(['new', 'old']);

    const summary = getContentChangeSummaryFromLog(root);
    expect(summary.lastSeenAt).toBe('2026-01-01T12:00:00.000Z');
    expect(summary.totalCount).toBe(2);
    expect(summary.unreadCount).toBe(1);
    expect(summary.latest?.id).toBe('new');

    // File is JSONL after migration.
    const lines = readFileSync(changeLogPath(root), 'utf-8').trim().split('\n');
    expect(lines.map((line) => (JSON.parse(line) as { id: string }).id)).toEqual(['old', 'new']);
  });

  it('marks changes seen by writing only the meta sidecar, not the events file', () => {
    const root = makeRoot();
    seedJsonlEvents(root, [
      { id: '1', ts: '2026-01-01T00:00:00.000Z', op: 'save_file', path: 'a.md', source: 'user', summary: 'a changed' },
    ]);
    const before = statSync(changeLogPath(root)).mtimeMs;
    const sizeBefore = statSync(changeLogPath(root)).size;

    markContentChangesSeenInLog(root);

    expect(statSync(changeLogPath(root)).mtimeMs).toBe(before);
    expect(statSync(changeLogPath(root)).size).toBe(sizeBefore);
    expect(getContentChangeSummaryFromLog(root).unreadCount).toBe(0);
  });

  it('returns an empty summary for a missing log without creating files', () => {
    const root = makeRoot();
    expect(getContentChangeSummaryFromLog(root)).toEqual({
      unreadCount: 0,
      totalCount: 0,
      lastSeenAt: null,
      latest: null,
    });
    expect(listContentChangesFromLog(root, {})).toEqual([]);
    expect(existsSync(join(root, '.mindos'))).toBe(false);
  });

  it('skips corrupted JSONL lines when listing and summarizing', () => {
    const root = makeRoot();
    seedJsonlEvents(root, [
      { id: '1', ts: '2026-01-01T00:00:00.000Z', op: 'save_file', path: 'a.md', source: 'user', summary: 'ok' },
    ]);
    writeFileSync(changeLogPath(root), `${readFileSync(changeLogPath(root), 'utf-8')}{broken\n`, 'utf-8');

    expect(listContentChangesFromLog(root, {})).toHaveLength(1);
    expect(getContentChangeSummaryFromLog(root).totalCount).toBe(1);
  });

  it('imports legacy Agent-Diff.md blocks and removes the legacy file', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'Agent-Diff.md'), [
      '# Changes',
      '```agent-diff',
      JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', path: 'P/i.md', tool: 'write_file', before: 'a', after: 'b' }),
      '```',
    ].join('\n'), 'utf-8');

    const events = listContentChangesFromLog(root, {});
    expect(events).toHaveLength(1);
    expect(events[0].op).toBe('legacy_agent_diff_import');
    expect(events[0].path).toBe('P/i.md');
    expect(existsSync(join(root, 'Agent-Diff.md'))).toBe(false);
  });
});
