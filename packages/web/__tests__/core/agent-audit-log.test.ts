import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { testMindRoot } from '../setup';
import {
  appendAgentAuditEvent,
  listAgentAuditEvents,
} from '../../lib/core/agent-audit-log';

function auditLogPath(root: string) {
  return path.join(root, '.mindos', 'agent-audit-log.json');
}

describe('core/agent-audit-log', () => {
  it('creates .mindos/agent-audit-log.json on first append', () => {
    appendAgentAuditEvent(testMindRoot, {
      ts: '2026-03-25T00:00:00.000Z',
      tool: 'mindos_read_file',
      params: { path: 'README.md' },
      result: 'ok',
      message: 'read',
    });

    expect(fs.existsSync(auditLogPath(testMindRoot))).toBe(true);
    const raw = fs.readFileSync(auditLogPath(testMindRoot), 'utf-8');
    const json = JSON.parse(raw) as { events: unknown[] };
    expect(Array.isArray(json.events)).toBe(true);
    expect(json.events.length).toBe(1);
  });

  it('stores action summaries by default and keeps raw debug capture redacted when explicitly requested', () => {
    appendAgentAuditEvent(testMindRoot, {
      ts: '2026-03-25T00:00:00.000Z',
      tool: 'schedule_user_extension',
      params: {
        path: 'Daily.md',
        content: 'Authorization: Bearer sk-audit-secret-1234567890',
        nested: { apiKey: 'sk-audit-secret-abcdefghijkl' },
      },
      result: 'ok',
      message: 'token=abc123secret',
      debugCapture: 'redacted_raw',
    });

    const events = listAgentAuditEvents(testMindRoot, 10);
    expect(events).toHaveLength(1);
    expect(events[0].actionSummary).toContain('schedule_user_extension ok target=Daily.md');
    expect(events[0].params).toMatchObject({
      path: 'Daily.md',
      content: expect.stringMatching(/^\[\d+ chars\]$/),
      nested: { apiKey: '[redacted]' },
    });
    expect(events[0].message).toBe('token=[redacted]');
    expect(JSON.stringify(events[0].rawDebug)).toContain('[redacted]');
    expect(JSON.stringify(events[0])).not.toContain('sk-audit-secret');
    expect(JSON.stringify(events[0])).not.toContain('abc123secret');
  });

  it('redacts secrets from existing persisted audit logs before returning them', () => {
    fs.mkdirSync(path.join(testMindRoot, '.mindos'), { recursive: true });
    fs.writeFileSync(auditLogPath(testMindRoot), JSON.stringify({
      version: 1,
      events: [{
        id: 'old-1',
        ts: '2026-03-25T00:00:00.000Z',
        tool: 'old_tool',
        params: { Authorization: 'Bearer sk-old-secret-1234567890', content: 'raw text' },
        result: 'ok',
        message: 'apiKey=sk-old-secret-abcdefghijkl',
      }],
    }), 'utf-8');

    const events = listAgentAuditEvents(testMindRoot, 10);

    expect(JSON.stringify(events)).not.toContain('sk-old-secret');
    expect(events[0].params).toMatchObject({
      Authorization: '[redacted]',
      content: '[8 chars]',
    });
    expect(events[0].message).toBe('apiKey=[redacted]');
    expect(events[0].actionSummary).toContain('old_tool ok');
  });

  it('imports legacy Agent-Audit.md blocks into JSON log and removes legacy file', () => {
    const legacyPath = path.join(testMindRoot, 'Agent-Audit.md');
    fs.writeFileSync(legacyPath, [
      '# Agent Audit',
      '```agent-op',
      JSON.stringify({
        ts: '2026-03-25T10:30:00.000Z',
        tool: 'mindos_write_file',
        params: { path: 'Profile/Identity.md' },
        result: 'ok',
        message: 'updated',
      }, null, 2),
      '```',
    ].join('\n'), 'utf-8');

    const events = listAgentAuditEvents(testMindRoot, 10);
    expect(events.length).toBe(1);
    expect(events[0].op).toBe('legacy_agent_audit_md_import');
    expect(events[0].tool).toBe('mindos_write_file');
    expect(fs.existsSync(legacyPath)).toBe(false);
  });

  it('imports legacy .agent-log.json JSONL into JSON log and removes legacy file', () => {
    const legacyPath = path.join(testMindRoot, '.agent-log.json');
    const entry = {
      ts: '2026-03-25T11:00:00.000Z',
      tool: 'mindos_update_lines',
      params: { path: 'x.md', start: 1, end: 1 },
      result: 'ok',
      message: 'updated',
    };
    fs.writeFileSync(legacyPath, `${JSON.stringify(entry)}\n`, 'utf-8');

    const events = listAgentAuditEvents(testMindRoot, 10);
    expect(events.length).toBe(1);
    expect(events[0].op).toBe('legacy_agent_log_jsonl_import');
    expect(events[0].tool).toBe('mindos_update_lines');
    expect(fs.existsSync(legacyPath)).toBe(false);
  });

  it('does not write audit logs through a symlinked .mindos directory outside mindRoot', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-audit-log-root-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-audit-log-outside-'));
    try {
      fs.symlinkSync(outside, path.join(root, '.mindos'), 'dir');

      expect(() => appendAgentAuditEvent(root, {
        ts: '2026-03-25T00:00:00.000Z',
        tool: 'mindos_write_file',
        params: { path: 'note.md' },
        result: 'ok',
      })).toThrow('Access denied');
      expect(fs.existsSync(path.join(outside, 'agent-audit-log.json'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
