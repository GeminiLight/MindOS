// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AgentRunTimeline from '@/components/ask/AgentRunTimeline';
import type { AgentRunTimelinePart } from '@/lib/types';

function timelinePart(): AgentRunTimelinePart {
  return {
    type: 'agent-run-timeline',
    chatSessionId: 'chat-1',
    rootRunId: 'root-1',
    updatedAt: 4,
    runs: [
      {
        id: 'parent-1',
        rootRunId: 'root-1',
        agentKind: 'pi-subagent',
        runtimeId: 'reviewer',
        displayName: 'Reviewer',
        status: 'completed',
        permissionMode: 'read',
        inputSummary: 'Review implementation',
        outputSummary: 'Parent result',
        startedAt: 1,
        completedAt: 3,
        durationMs: 2,
      },
      {
        id: 'child-1',
        rootRunId: 'root-1',
        parentRunId: 'parent-1',
        agentKind: 'acp',
        runtimeId: 'gemini',
        displayName: 'Gemini ACP',
        status: 'failed',
        permissionMode: 'ask',
        inputSummary: 'Check external context',
        error: 'agent crashed',
        startedAt: 2,
        completedAt: 3,
        durationMs: 1,
      },
      {
        id: 'orphan-1',
        rootRunId: 'root-1',
        parentRunId: 'missing-parent',
        agentKind: 'native-runtime',
        runtimeId: 'codex',
        displayName: 'Codex',
        status: 'completed',
        permissionMode: 'read',
        outputSummary: 'Orphan parent fallback',
        startedAt: 4,
        completedAt: 5,
        durationMs: 1,
        metadata: { runtimeKind: 'codex' },
      },
    ],
  };
}

describe('AgentRunTimeline', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('collapses and expands child runs while keeping orphan children visible as roots', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AgentRunTimeline part={timelinePart()} />);
    });

    expect(host.textContent).toContain('Reviewer');
    expect(host.textContent).toContain('1 child run');
    expect(host.textContent).toContain('1 failed');
    expect(host.textContent).toContain('Gemini ACP');
    expect(host.textContent).toContain('agent crashed');
    expect(host.textContent).toContain('Codex');
    expect(host.textContent).toContain('Orphan parent fallback');

    const collapse = host.querySelector('button[aria-label="Collapse Reviewer child runs"]') as HTMLButtonElement;
    expect(collapse).toBeTruthy();

    await act(async () => {
      collapse.click();
    });

    expect(host.textContent).toContain('Reviewer');
    expect(host.textContent).toContain('1 child run');
    expect(host.textContent).toContain('1 failed');
    expect(host.textContent).not.toContain('Gemini ACP');
    expect(host.textContent).toContain('Codex');

    const expand = host.querySelector('button[aria-label="Expand Reviewer child runs"]') as HTMLButtonElement;
    expect(expand).toBeTruthy();

    await act(async () => {
      expand.click();
    });

    expect(host.textContent).toContain('Gemini ACP');

    await act(async () => {
      root.unmount();
    });
  });

  it('auto-expands late-arriving deep child runs unless the user collapsed that node', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const initialPart: AgentRunTimelinePart = {
      type: 'agent-run-timeline',
      chatSessionId: 'chat-1',
      rootRunId: 'root-1',
      updatedAt: 1,
      runs: [
        {
          id: 'parent-1',
          rootRunId: 'root-1',
          agentKind: 'native-runtime',
          runtimeId: 'codex',
          displayName: 'Codex',
          status: 'completed',
          permissionMode: 'ask',
          startedAt: 1,
          metadata: { runtimeKind: 'codex' },
        },
        {
          id: 'child-1',
          rootRunId: 'root-1',
          parentRunId: 'parent-1',
          agentKind: 'pi-subagent',
          runtimeId: 'worker',
          displayName: 'Child Worker',
          status: 'completed',
          permissionMode: 'read',
          startedAt: 2,
        },
      ],
    };

    await act(async () => {
      root.render(<AgentRunTimeline part={initialPart} />);
    });

    expect(host.textContent).toContain('Child Worker');
    expect(host.textContent).not.toContain('Grandchild Worker');

    const withGrandchild: AgentRunTimelinePart = {
      ...initialPart,
      updatedAt: 2,
      runs: [
        ...initialPart.runs,
        {
          id: 'grandchild-1',
          rootRunId: 'root-1',
          parentRunId: 'child-1',
          agentKind: 'acp',
          runtimeId: 'gemini',
          displayName: 'Grandchild Worker',
          status: 'running',
          permissionMode: 'ask',
          startedAt: 3,
        },
      ],
    };

    await act(async () => {
      root.render(<AgentRunTimeline part={withGrandchild} />);
    });

    expect(host.textContent).toContain('Grandchild Worker');
    expect(host.textContent).toContain('1 active');

    const collapseChild = host.querySelector('button[aria-label="Collapse Child Worker child runs"]') as HTMLButtonElement;
    expect(collapseChild).toBeTruthy();

    await act(async () => {
      collapseChild.click();
    });

    expect(host.textContent).toContain('Child Worker');
    expect(host.textContent).toContain('1 active');
    expect(host.textContent).not.toContain('Grandchild Worker');

    await act(async () => {
      root.render(<AgentRunTimeline part={{
        ...withGrandchild,
        updatedAt: 3,
        runs: [
          ...withGrandchild.runs,
          {
            id: 'grandchild-2',
            rootRunId: 'root-1',
            parentRunId: 'child-1',
            agentKind: 'acp',
            runtimeId: 'gemini',
            displayName: 'Second Grandchild',
            status: 'failed',
            permissionMode: 'ask',
            error: 'child failed',
            startedAt: 4,
          },
        ],
      }} />);
    });

    expect(host.textContent).toContain('Child Worker');
    expect(host.textContent).toContain('1 failed');
    expect(host.textContent).toContain('1 active');
    expect(host.textContent).not.toContain('Grandchild Worker');
    expect(host.textContent).not.toContain('Second Grandchild');

    await act(async () => {
      root.unmount();
    });
  });

  it('summarizes running child runs on a collapsed completed parent', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const part = timelinePart();
    part.runs = part.runs.map((run) => (
      run.id === 'child-1'
        ? { ...run, displayName: 'Running Child', status: 'running', error: undefined, completedAt: undefined, durationMs: undefined }
        : run
    ));

    await act(async () => {
      root.render(<AgentRunTimeline part={part} />);
    });

    const collapse = host.querySelector('button[aria-label="Collapse Reviewer child runs"]') as HTMLButtonElement;
    expect(collapse).toBeTruthy();

    await act(async () => {
      collapse.click();
    });

    expect(host.textContent).toContain('Reviewer');
    expect(host.textContent).toContain('1 child run');
    expect(host.textContent).toContain('1 active');
    expect(host.textContent).not.toContain('Running Child');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders fine-grained events under their owning run', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const part = timelinePart();
    const run = part.runs[0]!;
    part.events = [
      {
        id: 'event-status',
        runId: run.id,
        type: 'run_started',
        category: 'status',
        status: 'running',
        ts: 1,
        record: run,
        data: { kind: 'status', nextStatus: 'running', summary: 'started' },
      },
      {
        id: 'event-text',
        runId: run.id,
        type: 'text',
        category: 'text',
        status: 'running',
        ts: 2,
        record: run,
        data: { kind: 'text', channel: 'assistant', text: 'Inspecting project files' },
      },
      {
        id: 'event-tool',
        runId: run.id,
        type: 'tool_started',
        category: 'tool',
        status: 'running',
        ts: 3,
        record: run,
        data: { kind: 'tool', name: 'Bash', status: 'started', inputSummary: 'npm test' },
      },
      {
        id: 'event-file',
        runId: run.id,
        type: 'file_changed',
        category: 'file',
        status: 'running',
        ts: 4,
        record: run,
        data: { kind: 'file', action: 'updated', path: 'wiki/specs/runtime.md', summary: 'Spec refreshed' },
      },
      {
        id: 'event-permission',
        runId: run.id,
        type: 'permission_requested',
        category: 'permission',
        status: 'running',
        ts: 5,
        record: run,
        data: { kind: 'permission', action: 'Bash', status: 'requested', prompt: 'Allow command?' },
      },
      {
        id: 'event-error',
        runId: run.id,
        type: 'error',
        category: 'error',
        status: 'failed',
        ts: 6,
        record: run,
        data: { kind: 'error', message: 'Command failed' },
      },
      {
        id: 'event-debug',
        runId: run.id,
        type: 'text',
        category: 'text',
        status: 'running',
        ts: 7,
        record: run,
        visibility: 'debug',
        data: { kind: 'text', text: 'hidden debug payload' },
      },
    ];

    await act(async () => {
      root.render(<AgentRunTimeline part={part} />);
    });

    expect(host.textContent).toContain('Command failed');
    expect(host.textContent).toContain('Bash requested');
    expect(host.textContent).toContain('Allow command?');
    expect(host.textContent).toContain('updated wiki/specs/runtime.md');
    expect(host.textContent).toContain('Spec refreshed');
    expect(host.textContent).toContain('Bash started');
    expect(host.textContent).toContain('npm test');
    expect(host.textContent).not.toContain('hidden debug payload');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders plan artifacts and goal evaluations as first-class timeline events', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const part = timelinePart();
    const run = part.runs[0]!;
    part.events = [
      {
        id: 'event-plan',
        runId: run.id,
        type: 'plan_artifact',
        category: 'plan',
        status: 'completed',
        ts: 8,
        record: run,
        data: {
          kind: 'plan',
          schemaVersion: 1,
          mode: 'plan',
          objective: 'Integrate Plan mode',
          summary: 'Read-only implementation plan is ready.',
          steps: [
            { title: 'Inspect the runtime path', status: 'completed' },
            { title: 'Add ledger artifact', status: 'pending' },
          ],
          risks: ['Permission policy drift'],
          source: 'assistant',
          generatedAt: 8,
        },
      },
      {
        id: 'event-goal',
        runId: run.id,
        type: 'goal_evaluation',
        category: 'goal',
        status: 'failed',
        ts: 9,
        record: run,
        data: {
          kind: 'goal',
          schemaVersion: 1,
          mode: 'goal',
          objective: 'Ship Goal mode',
          status: 'blocked',
          confidence: 'high',
          summary: 'Goal stopped on a missing approval.',
          evidence: ['Approval was required for a write action.'],
          nextAction: 'Switch to Build mode after approval.',
          evaluatedAt: 9,
        },
      },
    ];

    await act(async () => {
      root.render(<AgentRunTimeline part={part} />);
    });

    expect(host.textContent).toContain('plan artifact · 2 steps');
    expect(host.textContent).toContain('Read-only implementation plan is ready.');
    expect(host.textContent).toContain('goal blocked');
    expect(host.textContent).toContain('Goal stopped on a missing approval.');

    await act(async () => {
      root.unmount();
    });
  });
});
