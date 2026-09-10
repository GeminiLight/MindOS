import { describe, expect, it } from 'vitest';
import {
  CODEX_KNOWN_SILENT_NOTIFICATIONS,
  CODEX_TOOL_NOTIFICATION_PHASES,
  describeCodexUnhandledNotification,
  mapCodexAppServerNotificationToSseEvents,
} from './codex-app-server-events.js';

/**
 * Oracle: the legacy regex classification this module replaced. Kept verbatim
 * so the table-driven test can prove every enumerated method maps to the same
 * phase the old `/(tool|command|exec|approval|permission|patch)/` +
 * `/outputdelta/` + start/end regexes produced.
 */
function legacyGateMatches(method: string): boolean {
  return /(tool|command|exec|approval|permission|patch)/.test(method.toLowerCase());
}

function legacyPhase(method: string): 'start' | 'delta' | 'end' | 'none' {
  const lower = method.toLowerCase();
  if (!legacyGateMatches(lower)) return 'none';
  if (/outputdelta|output_delta/.test(lower)) return 'delta';
  if (/(end|ended|complete|completed|result|output|failed|error|rejected|denied|approved|allowed)/.test(lower)) return 'end';
  if (/(start|started|begin|began|added|call|request|requested|created)/.test(lower)) return 'start';
  return 'none';
}

describe('codex app-server notification phase table', () => {
  it('maps every tool-phase table entry to the phase the legacy regex produced', () => {
    expect(CODEX_TOOL_NOTIFICATION_PHASES.size).toBeGreaterThan(0);
    for (const [method, phase] of CODEX_TOOL_NOTIFICATION_PHASES) {
      expect(legacyPhase(method), `phase for ${method}`).toBe(phase);
    }
  });

  it('classifies every known-silent method as a legacy no-op', () => {
    expect(CODEX_KNOWN_SILENT_NOTIFICATIONS.size).toBeGreaterThan(0);
    for (const method of CODEX_KNOWN_SILENT_NOTIFICATIONS) {
      expect(legacyPhase(method), `silent for ${method}`).toBe('none');
    }
  });

  it('covers the methods the recorded fixtures and existing tests exercise', () => {
    // These appeared in codex-app-server.test.ts / fake-codex-app-server.mjs.
    for (const method of ['item/command/started', 'item/permission/requested']) {
      expect(CODEX_TOOL_NOTIFICATION_PHASES.has(method)).toBe(true);
    }
    for (const method of ['turn/started', 'serverRequest/resolved']) {
      expect(CODEX_KNOWN_SILENT_NOTIFICATIONS.has(method)).toBe(true);
    }
  });
});

describe('codex tool notification mapping (table-driven)', () => {
  it('maps a start-phase method to tool_start with sanitised args', () => {
    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'execCommand/begin',
      params: { id: 'exec-1', command: 'echo hi' },
    })).toEqual([{
      type: 'tool_start',
      toolCallId: 'exec-1',
      toolName: 'Bash',
      args: 'echo hi',
      runtime: 'codex',
    }]);
  });

  it('maps an end-phase method to tool_end and flags failure methods as errors', () => {
    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'execCommand/end',
      params: { id: 'exec-1', toolName: 'Bash', output: 'done' },
    })).toEqual([{
      type: 'tool_end',
      toolCallId: 'exec-1',
      toolName: 'Bash',
      output: 'done',
      isError: false,
      runtime: 'codex',
    }]);
    const failed = mapCodexAppServerNotificationToSseEvents({
      method: 'item/command/failed',
      params: { id: 'cmd-9', output: 'boom' },
    });
    expect(failed).toEqual([expect.objectContaining({ type: 'tool_end', isError: true, runtime: 'codex' })]);
  });

  it('maps a delta-phase method to a redacted tool_delta', () => {
    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'item/command/outputDelta',
      params: { id: 'cmd-1', toolName: 'Bash', delta: 'token=abc123\n' },
    })).toEqual([{
      type: 'tool_delta',
      toolCallId: 'cmd-1',
      toolName: 'Bash',
      delta: 'token=[redacted]\n',
      runtime: 'codex',
    }]);
  });

  it('keeps item/permission/requested as a tool_start (matches existing pinned behaviour)', () => {
    expect(mapCodexAppServerNotificationToSseEvents({
      method: 'item/permission/requested',
      params: { requestId: 'perm-1', toolName: 'Bash', command: 'mindos file delete "Profile.md"' },
    })).toEqual([{
      type: 'tool_start',
      toolCallId: 'perm-1',
      toolName: 'Bash',
      args: 'mindos file delete "Profile.md"',
      runtime: 'codex',
    }]);
  });

  it('returns no event for known-silent notifications', () => {
    for (const method of ['turn/started', 'item/permission/resolved', 'serverRequest/resolved', 'item/updated']) {
      expect(mapCodexAppServerNotificationToSseEvents({ method, params: {} })).toEqual([]);
    }
  });
});

describe('codex unhandled notifications', () => {
  it('does not fabricate a tool row for an unknown method', () => {
    const events = mapCodexAppServerNotificationToSseEvents({
      method: 'toolInvocation/started',
      params: { id: 'x-1', command: 'do thing' },
    });
    // The legacy gate matched 'tool' and the start phase matched 'started', so
    // the old code fabricated a tool_start; the explicit table must NOT.
    expect(legacyPhase('toolInvocation/started')).toBe('start');
    expect(events).toEqual([]);
    expect(events.some((event) => event.type.startsWith('tool_'))).toBe(false);
  });

  it('does not fabricate a codex-${method} tool row for an unknown tool-ish method', () => {
    const events = mapCodexAppServerNotificationToSseEvents({
      method: 'toolCallWeird',
      params: {},
    });
    expect(events).toEqual([]);
  });

  it('describes an unhandled notification as a typed debug event', () => {
    const described = describeCodexUnhandledNotification({
      method: 'item/mystery/updated',
      params: { id: 'm-1', detail: 'sk-live-abcdef1234567890' },
    });
    expect(described.type).toBe('unhandled-notification');
    expect(described.method).toBe('item/mystery/updated');
    expect(described.paramsSummary).toContain('m-1');
    expect(described.paramsSummary).not.toContain('sk-live-abcdef1234567890');
  });

  it('summarises unserialisable params without throwing', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => describeCodexUnhandledNotification({ method: 'weird', params: circular })).not.toThrow();
  });
});
