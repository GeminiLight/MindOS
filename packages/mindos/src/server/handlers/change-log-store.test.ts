import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { closeAllMindosDatabases } from '../../foundation/storage/sqlite.js';
import { readStudioAutomationState } from '../automations/store.js';
import {
  CHANGE_LOG_DB_RELATIVE_PATH,
  appendContentChangeToLog,
  getContentChangeFacetsFromLog,
  getContentChangeSummaryFromLog,
  listContentChangesFromLog,
  markContentChangesSeenInLog,
  type ContentChangeListOptions,
} from './change-log-store.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'change-log');
const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'mindos-change-log-store-'));
  roots.push(root);
  return root;
}

function changeLogPath(root: string): string {
  return join(root, '.mindos', 'change-log.json');
}

function dbPath(root: string): string {
  return join(root, ...CHANGE_LOG_DB_RELATIVE_PATH.split('/'));
}

function seedJsonlEvents(root: string, events: Array<Record<string, unknown>>, lastSeenAt: string | null = null): void {
  mkdirSync(join(root, '.mindos'), { recursive: true });
  // Oldest-first on disk, as written by the legacy JSONL appenders.
  writeFileSync(changeLogPath(root), events.map((event) => `${JSON.stringify(event)}\n`).join(''), 'utf-8');
  writeFileSync(join(root, '.mindos', 'change-log.meta.json'), JSON.stringify({ version: 2, lastSeenAt, legacy: {} }), 'utf-8');
}

afterEach(() => {
  closeAllMindosDatabases();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('handlers/change-log store (sqlite)', () => {
  it('lists imported JSONL change events newest-first with filters and limit', () => {
    const root = makeRoot();
    seedJsonlEvents(root, [
      { id: '1', ts: '2026-01-01T00:00:00.000Z', op: 'save_file', path: 'a.md', source: 'user', summary: 'a changed' },
      { id: '2', ts: '2026-01-02T00:00:00.000Z', op: 'save_file', path: 'Research/b.md', source: 'agent', agentName: 'codex', summary: 'b changed' },
    ]);

    const all = listContentChangesFromLog(root, {});
    expect(all.map((event) => event.id)).toEqual(['2', '1']);

    expect(listContentChangesFromLog(root, { path: 'a.md' }).map((event) => event.id)).toEqual(['1']);
    expect(listContentChangesFromLog(root, { source: 'agent' }).map((event) => event.id)).toEqual(['2']);
    expect(listContentChangesFromLog(root, { space: 'Research' }).map((event) => event.id)).toEqual(['2']);
    expect(listContentChangesFromLog(root, { agent: 'codex' }).map((event) => event.id)).toEqual(['2']);
    expect(listContentChangesFromLog(root, { q: 'codex' }).map((event) => event.id)).toEqual(['2']);
    expect(listContentChangesFromLog(root, { q: 'b changed' }).map((event) => event.id)).toEqual(['2']);
    expect(listContentChangesFromLog(root, { limit: 1 }).map((event) => event.id)).toEqual(['2']);
  });

  it('matches the frozen JSONL implementation on the parity fixture (list, summary, facets)', () => {
    const root = makeRoot();
    mkdirSync(join(root, '.mindos'), { recursive: true });
    writeFileSync(changeLogPath(root), readFileSync(join(fixtureDir, 'change-log.jsonl')));
    writeFileSync(join(root, '.mindos', 'change-log.meta.json'), readFileSync(join(fixtureDir, 'change-log.meta.json')));
    const queries = JSON.parse(readFileSync(join(fixtureDir, 'queries.json'), 'utf-8')) as Record<string, ContentChangeListOptions>;
    const expected = JSON.parse(readFileSync(join(fixtureDir, 'expected.json'), 'utf-8')) as {
      list: Record<string, unknown[]>;
      summary: unknown;
      facets: unknown;
    };

    for (const [name, options] of Object.entries(queries)) {
      expect(listContentChangesFromLog(root, options), `query ${name}`).toEqual(expected.list[name]);
    }
    expect(getContentChangeSummaryFromLog(root)).toEqual(expected.summary);
    expect(getContentChangeFacetsFromLog(root)).toEqual(expected.facets);
  });

  it('builds compact facets for spaces, agents, operations and sources', () => {
    const root = makeRoot();
    seedJsonlEvents(root, [
      { id: '1', ts: '2026-01-01T00:00:00.000Z', op: 'save_file', path: 'root.md', source: 'user', summary: 'root changed' },
      { id: '2', ts: '2026-01-02T00:00:00.000Z', op: 'save_file', path: 'Research/b.md', source: 'agent', agentName: 'codex', summary: 'b changed' },
      { id: '3', ts: '2026-01-03T00:00:00.000Z', op: 'create_file', path: 'Research/c.md', source: 'agent', summary: 'c changed' },
    ]);

    const facets = getContentChangeFacetsFromLog(root);

    expect(facets.spaces).toEqual([
      { value: 'Research', count: 2 },
      { value: '__root__', count: 1 },
    ]);
    expect(facets.agents).toEqual([
      { value: '__agent_unknown__', count: 1 },
      { value: 'codex', count: 1 },
    ]);
    expect(facets.operations).toEqual([
      { value: 'save_file', count: 2 },
      { value: 'create_file', count: 1 },
    ]);
    expect(facets.sources).toEqual([
      { value: 'agent', count: 2 },
      { value: 'user', count: 1 },
    ]);
  });

  it('imports a legacy pretty-printed change log once, carrying lastSeenAt, and renames it to *.migrated', () => {
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

    expect(existsSync(dbPath(root))).toBe(true);
    expect(existsSync(changeLogPath(root))).toBe(false);
    expect(existsSync(`${changeLogPath(root)}.migrated`)).toBe(true);
    expect(existsSync(join(root, '.mindos', 'change-log.meta.json'))).toBe(false);

    // A second read does not import the migrated file again.
    closeAllMindosDatabases();
    expect(listContentChangesFromLog(root, {}).map((event) => event.id)).toEqual(['new', 'old']);
    expect(getContentChangeSummaryFromLog(root).totalCount).toBe(2);
  });

  it('appends events with the same shape as the legacy writer and emits a knowledge.changed automation event', () => {
    const root = makeRoot();
    const event = appendContentChangeToLog(root, {
      op: 'save_file',
      path: 'Research/note.md',
      source: 'agent',
      agentName: '  codex  ',
      summary: 'updated',
      before: 'a',
      after: 'x'.repeat(13_000),
      beforePath: 'Research/old.md',
    });
    expect(event).toMatchObject({
      op: 'save_file',
      path: 'Research/note.md',
      source: 'agent',
      agentName: 'codex',
      summary: 'updated',
      before: 'a',
      beforePath: 'Research/old.md',
      truncated: true,
    });
    expect(event.after).toHaveLength(12_000);
    expect(event.id).toMatch(/^[0-9a-z]+-[0-9a-z]{6}$/);
    expect(Number.isNaN(new Date(event.ts).getTime())).toBe(false);
    expect(event.afterPath).toBeUndefined();

    expect(listContentChangesFromLog(root, {})).toEqual([event]);
    expect(getContentChangeSummaryFromLog(root)).toEqual({ unreadCount: 1, totalCount: 1, lastSeenAt: null, latest: event });
    expect(readStudioAutomationState(root).events[0]).toMatchObject({
      source: 'knowledge',
      key: event.id,
      type: 'knowledge.changed',
      payload: expect.objectContaining({ path: 'Research/note.md', op: 'save_file', source: 'agent', agentName: 'codex' }),
    });
    // The legacy JSONL file is never written again.
    expect(existsSync(changeLogPath(root))).toBe(false);

    const user = appendContentChangeToLog(root, { op: 'save_file', path: 'b.md', source: 'user', agentName: 'ignored', summary: 'user edit' });
    expect(user.agentName).toBeUndefined();
    expect(user.truncated).toBeUndefined();
  });

  it('keeps only the newest 500 events by row count', () => {
    const root = makeRoot();
    for (let index = 0; index < 510; index += 1) {
      appendContentChangeToLog(root, { op: 'save_file', path: `Bulk/f-${index}.md`, source: 'user', summary: `bulk ${index}` });
    }
    const summary = getContentChangeSummaryFromLog(root);
    expect(summary.totalCount).toBe(500);
    expect(summary.latest?.summary).toBe('bulk 509');
    const oldest = listContentChangesFromLog(root, { limit: 200 });
    expect(oldest).toHaveLength(200);
    expect(listContentChangesFromLog(root, { q: 'bulk 0' })).toEqual([]);
    expect(listContentChangesFromLog(root, { path: 'Bulk/f-9.md' })).toEqual([]);
    expect(listContentChangesFromLog(root, { path: 'Bulk/f-10.md' })).toHaveLength(1);
  });

  it('marks changes seen in the state table without recreating legacy files', () => {
    const root = makeRoot();
    seedJsonlEvents(root, [
      { id: '1', ts: '2026-01-01T00:00:00.000Z', op: 'save_file', path: 'a.md', source: 'user', summary: 'a changed' },
    ]);
    expect(getContentChangeSummaryFromLog(root).unreadCount).toBe(1);

    markContentChangesSeenInLog(root);

    expect(getContentChangeSummaryFromLog(root).unreadCount).toBe(0);
    expect(getContentChangeSummaryFromLog(root).lastSeenAt).not.toBeNull();
    expect(existsSync(changeLogPath(root))).toBe(false);
    expect(existsSync(join(root, '.mindos', 'change-log.meta.json'))).toBe(false);

    // A newer event is unread again.
    appendContentChangeToLog(root, { op: 'save_file', path: 'b.md', source: 'user', summary: 'later' });
    expect(getContentChangeSummaryFromLog(root).unreadCount).toBe(1);
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
    expect(getContentChangeFacetsFromLog(root)).toEqual({ spaces: [], agents: [], operations: [], sources: [] });
    expect(existsSync(join(root, '.mindos'))).toBe(false);
  });

  it('skips corrupted JSONL lines when importing', () => {
    const root = makeRoot();
    seedJsonlEvents(root, [
      { id: '1', ts: '2026-01-01T00:00:00.000Z', op: 'save_file', path: 'a.md', source: 'user', summary: 'ok' },
    ]);
    writeFileSync(changeLogPath(root), `${readFileSync(changeLogPath(root), 'utf-8')}{broken\n[1,2]\n`, 'utf-8');

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
    expect(events[0]?.op).toBe('legacy_agent_diff_import');
    expect(events[0]?.path).toBe('P/i.md');
    expect(events[0]?.summary).toBe('Imported legacy agent diff (write_file)');
    expect(existsSync(join(root, 'Agent-Diff.md'))).toBe(false);

    // Re-created legacy file: only blocks beyond the imported count are added.
    writeFileSync(join(root, 'Agent-Diff.md'), [
      '```agent-diff',
      JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', path: 'P/i.md', tool: 'write_file', before: 'a', after: 'b' }),
      '```',
      '```agent-diff',
      JSON.stringify({ ts: '2026-01-02T00:00:00.000Z', path: 'P/j.md', tool: 'update_lines' }),
      '```',
    ].join('\n'), 'utf-8');
    const imported = listContentChangesFromLog(root, {}).filter((event) => event.op === 'legacy_agent_diff_import');
    expect(imported.map((event) => event.path).sort()).toEqual(['P/i.md', 'P/j.md']);
  });

  it('refuses to write through a symlinked .mindos directory outside the mind root', () => {
    const root = makeRoot();
    const outside = makeRoot();
    symlinkSync(outside, join(root, '.mindos'), 'dir');

    expect(() => appendContentChangeToLog(root, { op: 'save_file', path: 'a.md', source: 'user', summary: 'x' }))
      .toThrow('Access denied');
    expect(existsSync(join(outside, 'db'))).toBe(false);
    expect(listContentChangesFromLog(root, {})).toEqual([]);
  });

  it('treats LIKE metacharacters in the keyword filter literally', () => {
    const root = makeRoot();
    appendContentChangeToLog(root, { op: 'save_file', path: 'a.md', source: 'user', summary: '100% done' });
    appendContentChangeToLog(root, { op: 'save_file', path: 'b.md', source: 'user', summary: '100 percent done' });
    appendContentChangeToLog(root, { op: 'save_file', path: 'snake_case.md', source: 'user', summary: 'underscore' });

    expect(listContentChangesFromLog(root, { q: '100%' }).map((event) => event.path)).toEqual(['a.md']);
    expect(listContentChangesFromLog(root, { q: 'snake_' }).map((event) => event.path)).toEqual(['snake_case.md']);
    expect(listContentChangesFromLog(root, { q: 'SNAKE' }).map((event) => event.path)).toEqual(['snake_case.md']);
    expect(listContentChangesFromLog(root, { q: '\\' })).toEqual([]);
  });
});
