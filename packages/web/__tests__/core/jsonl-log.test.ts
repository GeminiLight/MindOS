import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendJsonlEvents,
  compactJsonlIfNeeded,
  ensureJsonlStore,
  readJsonlEvents,
  readJsonlMeta,
  writeJsonlMeta,
  type JsonlCompactionConfig,
} from '../../lib/core/jsonl-log';

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'web-jsonl-log-'));
  return {
    dir,
    file: join(dir, 'log.json'),
    metaFile: join(dir, 'log.meta.json'),
  };
}

const config: JsonlCompactionConfig = { maxEvents: 100, maxBytes: 10_000, targetBytes: 5_000 };

describe('jsonl-log store', () => {
  it('appends each event as a single JSON line without rewriting earlier lines', () => {
    const { file, metaFile } = makeStore();
    appendJsonlEvents(file, metaFile, [{ id: 'a' }], config);
    const firstLine = readFileSync(file, 'utf-8');
    appendJsonlEvents(file, metaFile, [{ id: 'b' }, { id: 'c' }], config);

    const raw = readFileSync(file, 'utf-8');
    expect(raw.startsWith(firstLine)).toBe(true);
    expect(raw.trim().split('\n')).toHaveLength(3);
    expect(JSON.parse(raw.trim().split('\n')[0])).toEqual({ id: 'a' });
  });

  it('creates the parent directory on first append', () => {
    const { dir } = makeStore();
    const file = join(dir, 'nested', 'deep', 'log.json');
    const metaFile = join(dir, 'nested', 'deep', 'log.meta.json');
    appendJsonlEvents(file, metaFile, [{ id: 'a' }], config);
    expect(existsSync(file)).toBe(true);
  });

  it('reads events newest-first and skips corrupted lines', () => {
    const { file, metaFile } = makeStore();
    appendJsonlEvents(file, metaFile, [{ id: 'old' }, { id: 'mid' }], config);
    appendFileSync(file, 'not-json {{{\n[1,2,3]\n', 'utf-8');
    appendJsonlEvents(file, metaFile, [{ id: 'new' }], config);

    const { events } = readJsonlEvents(file, metaFile);
    expect(events).toEqual([{ id: 'new' }, { id: 'mid' }, { id: 'old' }]);
  });

  it('returns no events for a missing or empty log file', () => {
    const { file, metaFile, dir } = makeStore();
    expect(readJsonlEvents(file, metaFile).events).toEqual([]);
    writeFileSync(file, '', 'utf-8');
    expect(readJsonlEvents(file, metaFile).events).toEqual([]);
    // Read on a missing store must not create files as a side effect.
    expect(readdirSync(dir)).toEqual(['log.json']);
  });

  it('migrates a legacy pretty-printed state file to JSONL exactly once, preserving newest-first order', () => {
    const { file, metaFile } = makeStore();
    writeFileSync(file, JSON.stringify({
      version: 1,
      lastSeenAt: '2026-01-03T00:00:00.000Z',
      events: [{ id: 'newest' }, { id: 'oldest' }],
      legacy: { agentDiffImportedCount: 4 },
    }, null, 2), 'utf-8');

    const { events, meta } = readJsonlEvents(file, metaFile);
    expect(events).toEqual([{ id: 'newest' }, { id: 'oldest' }]);
    expect(meta.lastSeenAt).toBe('2026-01-03T00:00:00.000Z');
    expect(meta.legacy).toMatchObject({ agentDiffImportedCount: 4 });

    // On disk the file is now JSONL (oldest-first) and the meta sidecar marks migration done.
    const lines = readFileSync(file, 'utf-8').trim().split('\n');
    expect(JSON.parse(lines[0])).toEqual({ id: 'oldest' });
    expect(JSON.parse(lines[1])).toEqual({ id: 'newest' });
    expect(readJsonlMeta(metaFile)).not.toBeNull();

    // A subsequent append goes through the fast JSONL path.
    appendJsonlEvents(file, metaFile, [{ id: 'live' }], config);
    expect(readJsonlEvents(file, metaFile).events[0]).toEqual({ id: 'live' });
  });

  it('treats an unparseable file as JSONL and keeps its valid lines', () => {
    const { file, metaFile } = makeStore();
    writeFileSync(file, `${JSON.stringify({ id: 'kept' })}\n{broken\n`, 'utf-8');
    const { events } = readJsonlEvents(file, metaFile);
    expect(events).toEqual([{ id: 'kept' }]);
  });

  it('compacts the file to the newest events when it exceeds the byte cap', () => {
    const { file, metaFile } = makeStore();
    const small: JsonlCompactionConfig = { maxEvents: 5, maxBytes: 400, targetBytes: 200 };
    for (let i = 0; i < 50; i++) {
      appendJsonlEvents(file, metaFile, [{ id: `e-${i}`, pad: 'x'.repeat(20) }], small);
    }
    expect(statSync(file).size).toBeLessThanOrEqual(small.maxBytes);
    const { events } = readJsonlEvents(file, metaFile);
    expect(events.length).toBeLessThan(50);
    expect((events[0] as { id: string }).id).toBe('e-49');
  });

  it('enforces the entry-count cap during compaction', () => {
    const { file, metaFile } = makeStore();
    const small: JsonlCompactionConfig = { maxEvents: 3, maxBytes: 300, targetBytes: 10_000 };
    for (let i = 0; i < 30; i++) {
      appendJsonlEvents(file, metaFile, [{ id: `e-${i}` }], small);
    }
    compactJsonlIfNeeded(file, { ...small, maxBytes: 0 });
    const { events } = readJsonlEvents(file, metaFile);
    expect(events.map((event) => (event as { id: string }).id)).toEqual(['e-29', 'e-28', 'e-27']);
  });

  it('round-trips meta through the sidecar file', () => {
    const { file, metaFile } = makeStore();
    const meta = ensureJsonlStore(file, metaFile, { persistIfMissing: true });
    meta.lastSeenAt = '2026-02-01T00:00:00.000Z';
    writeJsonlMeta(metaFile, meta);
    expect(readJsonlMeta(metaFile)).toMatchObject({ lastSeenAt: '2026-02-01T00:00:00.000Z' });
  });

  it('recovers a default meta from a corrupted sidecar file', () => {
    const { file, metaFile } = makeStore();
    writeFileSync(metaFile, '{nope', 'utf-8');
    appendJsonlEvents(file, metaFile, [{ id: 'a' }], config);
    expect(readJsonlEvents(file, metaFile).events).toEqual([{ id: 'a' }]);
  });
});
