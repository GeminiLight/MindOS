import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendAgentAuditEvents,
  listAgentAuditEventsFromLog,
  parseAgentAuditJsonLines,
} from './audit-log.js';

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'mindos-audit-log-store-'));
}

function auditLogPath(root: string): string {
  return join(root, '.mindos', 'agent-audit-log.json');
}

describe('handlers/audit-log store', () => {
  it('appends a batch of events as one JSONL line per event', () => {
    const root = makeRoot();
    appendAgentAuditEvents(root, [
      { ts: '2026-01-01T00:00:00.000Z', tool: 'read_file', params: { path: 'a.md' }, result: 'ok' },
      { ts: '2026-01-02T00:00:00.000Z', tool: 'write_file', params: { path: 'b.md' }, result: 'error', message: 'boom' },
    ]);

    const lines = readFileSync(auditLogPath(root), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]) as { tool: string; op: string; id: string };
    expect(first.tool).toBe('read_file');
    expect(first.op).toBe('append');
    expect(first.id).toBeTruthy();
  });

  it('lists events newest-first with action summaries and limit', () => {
    const root = makeRoot();
    appendAgentAuditEvents(root, [
      { ts: '2026-01-01T00:00:00.000Z', tool: 'first_tool', params: { path: 'a.md' }, result: 'ok' },
      { ts: '2026-01-02T00:00:00.000Z', tool: 'second_tool', params: {}, result: 'ok' },
    ]);

    const events = listAgentAuditEventsFromLog(root, 10);
    expect(events.map((event) => event.tool)).toEqual(['second_tool', 'first_tool']);
    expect(events[1].actionSummary).toContain('first_tool ok target=a.md');

    expect(listAgentAuditEventsFromLog(root, 1)).toHaveLength(1);
  });

  it('redacts secrets and summarizes large content fields at write time', () => {
    const root = makeRoot();
    appendAgentAuditEvents(root, [{
      ts: '2026-01-01T00:00:00.000Z',
      tool: 'write_file',
      params: { path: 'a.md', content: 'x'.repeat(50), apiKey: 'sk-secret-1234567890abcdef' },
      result: 'ok',
      message: 'token=abc123secret',
    }]);

    const raw = readFileSync(auditLogPath(root), 'utf-8');
    expect(raw).not.toContain('sk-secret-1234567890abcdef');
    expect(raw).not.toContain('abc123secret');
    const events = listAgentAuditEventsFromLog(root, 10);
    expect(events[0].params).toMatchObject({ path: 'a.md', content: '[50 chars]' });
  });

  it('migrates a legacy pretty-printed audit log on first read, preserving order', () => {
    const root = makeRoot();
    mkdirSync(join(root, '.mindos'), { recursive: true });
    // Legacy writers unshifted, so persisted arrays are newest-first.
    writeFileSync(auditLogPath(root), JSON.stringify({
      version: 1,
      events: [
        { id: '2', ts: '2026-01-02T00:00:00.000Z', tool: 'read_file', params: {}, result: 'ok' },
        { id: '1', ts: '2026-01-01T00:00:00.000Z', tool: 'write_file', params: {}, result: 'ok' },
      ],
    }, null, 2), 'utf-8');

    const events = listAgentAuditEventsFromLog(root, 10);
    expect(events.map((event) => event.id)).toEqual(['2', '1']);

    // The file is now JSONL: appends after migration are plain line appends.
    appendAgentAuditEvents(root, [{ ts: '2026-01-03T00:00:00.000Z', tool: 'new_tool', params: {}, result: 'ok' }]);
    expect(listAgentAuditEventsFromLog(root, 10).map((event) => event.tool)).toEqual(['new_tool', 'read_file', 'write_file']);
    const lines = readFileSync(auditLogPath(root), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(3);
  });

  it('skips corrupted JSONL lines when listing', () => {
    const root = makeRoot();
    appendAgentAuditEvents(root, [{ ts: '2026-01-01T00:00:00.000Z', tool: 'good', params: {}, result: 'ok' }]);
    writeFileSync(auditLogPath(root), `${readFileSync(auditLogPath(root), 'utf-8')}{broken json\n`, 'utf-8');
    const events = listAgentAuditEventsFromLog(root, 10);
    expect(events).toHaveLength(1);
    expect(events[0].tool).toBe('good');
  });

  it('imports legacy Agent-Audit.md and .agent-log.json files and removes them', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'Agent-Audit.md'), [
      '# Audit',
      '```agent-op',
      JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', tool: 'md_tool', params: {}, result: 'ok' }),
      '```',
    ].join('\n'), 'utf-8');
    writeFileSync(join(root, '.agent-log.json'), `${JSON.stringify({ ts: '2026-01-02T00:00:00.000Z', tool: 'jsonl_tool', params: {}, result: 'ok' })}\n`, 'utf-8');

    const events = listAgentAuditEventsFromLog(root, 10);
    expect(events.map((event) => event.tool)).toEqual(expect.arrayContaining(['md_tool', 'jsonl_tool']));
    expect(events.find((event) => event.tool === 'md_tool')?.op).toBe('legacy_agent_audit_md_import');
    expect(existsSync(join(root, 'Agent-Audit.md'))).toBe(false);
    expect(existsSync(join(root, '.agent-log.json'))).toBe(false);
  });

  it('returns an empty list for a missing log without creating files', () => {
    const root = makeRoot();
    expect(listAgentAuditEventsFromLog(root, 10)).toEqual([]);
    expect(existsSync(join(root, '.mindos'))).toBe(false);
  });

  it('refuses to write through a symlinked .mindos directory outside mindRoot', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-audit-symlink-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'mindos-audit-symlink-outside-'));
    try {
      symlinkSync(outside, join(root, '.mindos'), 'dir');
      expect(() => appendAgentAuditEvents(root, [
        { ts: '2026-01-01T00:00:00.000Z', tool: 'write_file', params: {}, result: 'ok' },
      ])).toThrow(/Access denied/i);
      expect(existsSync(join(outside, 'agent-audit-log.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('parses agent audit JSON lines leniently, skipping comments and bad lines', () => {
    const parsed = parseAgentAuditJsonLines([
      '# comment',
      '// another',
      JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', tool: 't', params: { a: 1 }, result: 'error' }),
      '{bad',
      JSON.stringify({ result: 'ok' }),
    ].join('\n'));

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ tool: 't', result: 'error', params: { a: 1 } });
    expect(parsed[1].tool).toBe('unknown-tool');
  });
});
