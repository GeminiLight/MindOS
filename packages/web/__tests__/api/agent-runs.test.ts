import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/agent-runs/route';
import {
  appendAgentRunEvent,
  completeAgentRun,
  resetAgentRunsForTest,
  startAgentRun,
} from '@/lib/agent/run-ledger';

describe('/api/agent-runs', () => {
  beforeEach(() => {
    resetAgentRunsForTest();
  });

  it('returns recent agent run records with filters', async () => {
    startAgentRun({
      agentKind: 'acp',
      runtimeId: 'gemini',
      displayName: 'Gemini',
      permissionMode: 'agent',
      inputSummary: 'Ask Gemini',
    });
    const subagentRun = startAgentRun({
      agentKind: 'pi-subagent',
      runtimeId: 'reviewer',
      displayName: 'Reviewer',
      permissionMode: 'readonly',
      inputSummary: 'Review this',
    });
    completeAgentRun(subagentRun.id, { outputSummary: 'Looks good.' });

    const response = await GET(new Request(`http://localhost/api/agent-runs?kind=pi-subagent&status=completed&runId=${subagentRun.id}&includeEvents=1`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.runs).toEqual([
      expect.objectContaining({
        id: subagentRun.id,
        agentKind: 'pi-subagent',
        runtimeId: 'reviewer',
        status: 'completed',
        outputSummary: 'Looks good.',
      }),
    ]);
    expect(body.events.map((event: { type: string }) => event.type)).toEqual([
      'run_completed',
      'run_started',
    ]);
  });

  it('filters runs by chat session, start time, and native runtime kind', async () => {
    startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Codex',
      chatSessionId: 'chat-a',
      permissionMode: 'agent',
      inputSummary: 'Use Codex',
    });
    const target = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'claude',
      displayName: 'Claude Code',
      chatSessionId: 'chat-b',
      permissionMode: 'readonly',
      inputSummary: 'Use Claude',
    });

    const response = await GET(new Request(`http://localhost/api/agent-runs?kind=native-runtime&chatSessionId=chat-b&startedAfter=${target.startedAt}&includeEvents=1`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.runs).toEqual([
      expect.objectContaining({
        id: target.id,
        agentKind: 'native-runtime',
        runtimeId: 'claude',
        chatSessionId: 'chat-b',
      }),
    ]);
    expect(body.events.map((event: { runId: string }) => event.runId)).toContain(target.id);
  });

  it('filters runs and events by root run id', async () => {
    const root = startAgentRun({
      agentKind: 'mindos-main',
      runtimeId: 'mindos',
      displayName: 'MindOS Agent',
      chatSessionId: 'chat-root',
      permissionMode: 'agent',
      inputSummary: 'Root task',
    });
    const child = startAgentRun({
      agentKind: 'pi-subagent',
      runtimeId: 'reviewer',
      displayName: 'Reviewer',
      rootRunId: root.id,
      parentRunId: root.id,
      chatSessionId: 'chat-root',
      permissionMode: 'readonly',
      inputSummary: 'Review',
    });
    startAgentRun({
      agentKind: 'acp',
      runtimeId: 'gemini',
      displayName: 'Gemini ACP',
      chatSessionId: 'chat-other',
      permissionMode: 'agent',
      inputSummary: 'Other task',
    });
    completeAgentRun(child.id, { outputSummary: 'Reviewed.' });

    const response = await GET(new Request(`http://localhost/api/agent-runs?chatSessionId=chat-root&rootRunId=${root.id}&includeEvents=1`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.runs.map((run: { id: string }) => run.id)).toEqual([
      child.id,
      root.id,
    ]);
    expect(body.events.map((event: { runId: string }) => event.runId)).toEqual([
      child.id,
      child.id,
      root.id,
    ]);
  });

  it('returns scoped fine-grained events and filters by event category', async () => {
    const oldRun = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Codex',
      chatSessionId: 'chat-events',
      permissionMode: 'agent',
      inputSummary: 'Old turn',
    });
    appendAgentRunEvent(oldRun.id, {
      type: 'text',
      category: 'text',
      data: { kind: 'text', text: 'old event' },
    });

    const target = startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'claude',
      displayName: 'Claude Code',
      chatSessionId: 'chat-events',
      permissionMode: 'agent',
      inputSummary: 'Current turn',
    });
    appendAgentRunEvent(target.id, {
      type: 'tool_completed',
      category: 'tool',
      data: { kind: 'tool', name: 'Bash', status: 'completed', outputSummary: 'done' },
    });
    appendAgentRunEvent(target.id, {
      type: 'file_changed',
      category: 'file',
      data: { kind: 'file', action: 'updated', path: 'notes/demo.md' },
    });

    const response = await GET(new Request(`http://localhost/api/agent-runs?chatSessionId=chat-events&startedAfter=${target.startedAt}&includeEvents=1&eventCategory=tool`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.runs.map((run: { id: string }) => run.id)).toEqual([target.id]);
    expect(body.events).toEqual([
      expect.objectContaining({
        runId: target.id,
        category: 'tool',
        data: expect.objectContaining({ kind: 'tool', name: 'Bash', status: 'completed' }),
      }),
    ]);
  });
});
