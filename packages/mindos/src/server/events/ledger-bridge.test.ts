import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendAgentRunEvent,
  resetAgentRunsForTest,
  startAgentRun,
} from '../../agent/ledger/run-ledger.js';
import { createMindosServerEventBus, type MindosServerEventEnvelope } from './bus.js';
import { installAgentRunLedgerBridge, isAgentRunLedgerBridgeInstalled } from './ledger-bridge.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  resetAgentRunsForTest();
});

describe('agent run ledger → server event bus bridge', () => {
  it('forwards timeline ledger events as compact agent-run.event summaries', () => {
    resetAgentRunsForTest();
    const bus = createMindosServerEventBus();
    cleanups.push(installAgentRunLedgerBridge(bus));
    const seen: MindosServerEventEnvelope[] = [];
    bus.subscribe((envelope) => seen.push(envelope));

    const run = startAgentRun({
      agentKind: 'pi-subagent',
      runtimeId: 'reviewer',
      displayName: 'Reviewer',
      chatSessionId: 'chat-1',
      permissionMode: 'read',
      inputSummary: 'review this',
    });
    appendAgentRunEvent(run.id, { type: 'tool_started', category: 'tool', message: 'reading', toolName: 'read_file' });

    const types = seen.map((entry) => entry.event.type);
    expect(types.every((type) => type === 'agent-run.event')).toBe(true);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    const last = seen[seen.length - 1].event;
    expect(last).toMatchObject({
      type: 'agent-run.event',
      runId: run.id,
      chatSessionId: 'chat-1',
      event: { runId: run.id, type: 'tool_started', category: 'tool' },
    });
    if (last.type !== 'agent-run.event') throw new Error('unexpected event');
    expect(Object.keys(last.event).sort()).toEqual(['category', 'id', 'runId', 'status', 'ts', 'type']);
    expect('record' in last.event).toBe(false);
    expect('data' in last.event).toBe(false);
  });

  it('drops token-rate debug events so they never reach the ring', () => {
    resetAgentRunsForTest();
    const bus = createMindosServerEventBus();
    cleanups.push(installAgentRunLedgerBridge(bus));
    const run = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Codex',
      permissionMode: 'ask',
      inputSummary: 'go',
    });
    const before = bus.lastEventId();
    appendAgentRunEvent(run.id, { type: 'text', category: 'text', message: 'partial', visibility: 'debug' });
    expect(bus.lastEventId()).toBe(before);
    appendAgentRunEvent(run.id, { type: 'text', category: 'text', message: 'final' });
    expect(bus.lastEventId()).toBe(before + 1);
  });

  it('installs once per bus and stops forwarding after uninstall', () => {
    resetAgentRunsForTest();
    const bus = createMindosServerEventBus();
    const uninstall = installAgentRunLedgerBridge(bus);
    const again = installAgentRunLedgerBridge(bus);
    expect(isAgentRunLedgerBridgeInstalled(bus)).toBe(true);

    const run = startAgentRun({ agentKind: 'acp', runtimeId: 'acp', displayName: 'ACP', permissionMode: 'ask', inputSummary: 'x' });
    const afterStart = bus.lastEventId();
    appendAgentRunEvent(run.id, { type: 'status', category: 'status', message: 'one' });
    // Two install calls must not double-emit.
    expect(bus.lastEventId()).toBe(afterStart + 1);

    again();
    uninstall();
    expect(isAgentRunLedgerBridgeInstalled(bus)).toBe(false);
    appendAgentRunEvent(run.id, { type: 'status', category: 'status', message: 'two' });
    expect(bus.lastEventId()).toBe(afterStart + 1);
  });

  it('carries root and parent run ids for child runs', () => {
    resetAgentRunsForTest();
    const bus = createMindosServerEventBus();
    cleanups.push(installAgentRunLedgerBridge(bus));
    const seen = vi.fn<(envelope: MindosServerEventEnvelope) => void>();
    bus.subscribe(seen);
    const root = startAgentRun({ agentKind: 'mindos-main', runtimeId: 'mindos', displayName: 'Main', chatSessionId: 'c', permissionMode: 'ask', inputSummary: 'root' });
    const child = startAgentRun({
      agentKind: 'pi-subagent',
      runtimeId: 'sub',
      displayName: 'Sub',
      rootRunId: root.id,
      parentRunId: root.id,
      chatSessionId: 'c',
      permissionMode: 'read',
      inputSummary: 'child',
    });
    const childEnvelope = seen.mock.calls.map((call) => call[0]).find((entry) => entry.event.type === 'agent-run.event' && entry.event.runId === child.id);
    expect(childEnvelope?.event).toMatchObject({
      event: { rootRunId: root.id, parentRunId: root.id },
    });
  });
});
