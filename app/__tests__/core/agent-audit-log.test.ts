import { describe, it, expect } from 'vitest';
import fs from 'fs';
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
});

