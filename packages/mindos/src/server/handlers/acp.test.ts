import { describe, expect, it } from 'vitest';
import {
  handleAcpConfigDelete,
  handleAcpConfigPost,
  handleAcpDetectGet,
  handleAcpSessionGet,
  invalidateAcpDetectCache,
} from './acp.js';

function detectServices() {
  let settings: { acpAgents?: Record<string, unknown> } = { acpAgents: {} };
  let detectCalls = 0;
  return {
    readSettings: () => settings as { acpAgents?: Record<string, never> },
    writeSettings: (next: typeof settings) => { settings = next; },
    detectLocalAcpAgents: async () => {
      detectCalls += 1;
      return { installed: [], notInstalled: [] };
    },
    detectCalls: () => detectCalls,
  };
}

describe('ACP detect cache', () => {
  it('re-detects after a config write instead of serving the 30 minute cache', async () => {
    invalidateAcpDetectCache();
    const services = detectServices();

    await handleAcpDetectGet(new URLSearchParams(), services);
    await handleAcpDetectGet(new URLSearchParams(), services);
    expect(services.detectCalls()).toBe(1);

    handleAcpConfigPost({ agentId: 'custom-acp', config: { command: 'custom-acp' } }, services);
    await handleAcpDetectGet(new URLSearchParams(), services);
    expect(services.detectCalls()).toBe(2);

    handleAcpConfigDelete({ agentId: 'custom-acp' }, services);
    await handleAcpDetectGet(new URLSearchParams(), services);
    expect(services.detectCalls()).toBe(3);
  });

  it('keeps the cache when a config write is rejected', async () => {
    invalidateAcpDetectCache();
    const services = detectServices();

    await handleAcpDetectGet(new URLSearchParams(), services);
    handleAcpConfigPost({ agentId: '__proto__', config: {} }, services);
    await handleAcpDetectGet(new URLSearchParams(), services);

    expect(services.detectCalls()).toBe(1);
  });

  it('emits settings.changed on the injected bus after an acpAgents write', () => {
    const emitted: Array<{ type: string }> = [];
    const services = {
      ...detectServices(),
      events: { emit: (event: { type: string }) => { emitted.push(event); } },
    };

    handleAcpConfigPost({ agentId: 'custom-acp', config: { command: 'custom-acp' } }, services);
    handleAcpConfigDelete({ agentId: 'custom-acp' }, services);
    handleAcpConfigPost({ agentId: '__proto__', config: {} }, services);

    expect(emitted).toEqual([{ type: 'settings.changed' }, { type: 'settings.changed' }]);
  });
});

describe('handleAcpSessionGet', () => {
  it('returns a bounded, detached view of each session', () => {
    const big = 'x'.repeat(5_000);
    const session = {
      id: 'ses-1',
      agentId: 'agent',
      agentSessionId: 'agent-ses-1',
      state: 'idle',
      cwd: '/work',
      createdAt: '2026-09-10T00:00:00.000Z',
      lastActivityAt: '2026-09-10T00:00:01.000Z',
      messages: [{ role: 'user', text: big }],
      turns: [{ id: 1 }],
      toolCalls: Array.from({ length: 40 }, (_, index) => ({
        toolCallId: `tc-${index}`,
        status: 'completed',
        rawInput: big,
        rawOutput: big,
      })),
      permissionEvents: Array.from({ length: 30 }, (_, index) => ({
        requestId: `req-${index}`,
        sessionId: 'agent-ses-1',
        toolCallId: `tc-${index}`,
        toolName: 'Write file',
        status: 'resolved',
        options: [],
        requestedAt: '2026-09-10T00:00:00.000Z',
      })),
    };

    const response = handleAcpSessionGet({ getActiveSessions: () => [session] });
    const body = response.body as { sessions: Array<Record<string, any>> };
    const [view] = body.sessions;

    expect(response.status).toBe(200);
    expect(view).toMatchObject({
      id: 'ses-1',
      agentId: 'agent',
      agentSessionId: 'agent-ses-1',
      state: 'idle',
      cwd: '/work',
      createdAt: '2026-09-10T00:00:00.000Z',
      lastActivityAt: '2026-09-10T00:00:01.000Z',
    });
    expect(view).not.toHaveProperty('messages');
    expect(view).not.toHaveProperty('turns');
    expect(view.toolCalls).toHaveLength(20);
    expect(view.toolCalls[0].toolCallId).toBe('tc-20');
    expect(view.toolCalls[0].rawInput.length).toBeLessThanOrEqual(503);
    expect(view.toolCalls[0].rawOutput.length).toBeLessThanOrEqual(503);
    expect(view.permissionEvents).toHaveLength(20);

    // The view is a copy: mutating it must not touch the tracked session.
    view.state = 'active';
    view.toolCalls.length = 0;
    expect(session.state).toBe('idle');
    expect(session.toolCalls).toHaveLength(40);
  });

  it('passes plain session summaries from injected services through unchanged', () => {
    const response = handleAcpSessionGet({
      getActiveSessions: () => [{ id: 'ses-1', agentId: 'gemini', state: 'idle' }],
    });

    expect(response.body).toEqual({ sessions: [{ id: 'ses-1', agentId: 'gemini', state: 'idle' }] });
  });
});
