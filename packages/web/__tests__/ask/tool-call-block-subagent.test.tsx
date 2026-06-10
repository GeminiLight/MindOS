// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ToolCallBlock from '@/components/ask/ToolCallBlock';
import type { ToolCallPart } from '@/lib/types';

function renderToolCall(part: ToolCallPart) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  act(() => {
    root.render(<ToolCallBlock part={part} />);
  });

  return {
    host,
    expand: () => {
      const trigger = host.querySelector('button') as HTMLButtonElement;
      act(() => {
        trigger.click();
      });
    },
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe('ToolCallBlock subagent rendering', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('summarizes a single subagent run and keeps raw input available', () => {
    const view = renderToolCall({
      type: 'tool-call',
      toolCallId: 'tool-1',
      toolName: 'subagent',
      state: 'done',
      input: {
        agent: 'reviewer',
        task: 'Review packages/web/components/ask/ToolCallBlock.tsx for regressions.',
        cwd: '/tmp/mindos',
        context: 'fresh',
      },
      output: 'No blocking issues found.',
    });

    expect(view.host.textContent).toContain('subagent');
    expect(view.host.textContent).toContain('reviewer');
    expect(view.host.textContent).toContain('Review packages/web/components/ask/ToolCallBlock.tsx');

    view.expand();

    expect(view.host.textContent).toContain('Mode');
    expect(view.host.textContent).toContain('Single');
    expect(view.host.textContent).toContain('/tmp/mindos');
    expect(view.host.textContent).toContain('No blocking issues found.');
    expect(view.host.textContent).toContain('Raw input');

    view.cleanup();
  });

  it('summarizes parallel subagent work with the requested run count', () => {
    const view = renderToolCall({
      type: 'tool-call',
      toolCallId: 'tool-2',
      toolName: 'subagent',
      state: 'running',
      input: {
        tasks: [
          { agent: 'reviewer', task: 'Review UI state transitions.' },
          { agent: 'tester', task: 'Run focused tests.', count: 2 },
        ],
        concurrency: 2,
        worktree: true,
      },
    });

    expect(view.host.textContent).toContain('Parallel · 3 runs');
    expect(view.host.textContent).toContain('reviewer, tester');

    view.expand();

    expect(view.host.textContent).toContain('Parallel tasks');
    expect(view.host.textContent).toContain('Review UI state transitions.');
    expect(view.host.textContent).toContain('Run focused tests.');
    expect(view.host.textContent).toContain('Concurrency');
    expect(view.host.textContent).toContain('2');
    expect(view.host.textContent).toContain('Worktree');
    expect(view.host.textContent).toContain('true');

    view.cleanup();
  });

  it('renders subagent control actions without treating them as ACP or A2A sessions', () => {
    const view = renderToolCall({
      type: 'tool-call',
      toolCallId: 'tool-3',
      toolName: 'subagent',
      state: 'done',
      input: {
        action: 'status',
        id: 'run_abc123',
      },
      output: JSON.stringify({ status: 'running', runId: 'run_abc123' }),
    });

    expect(view.host.textContent).toContain('Check subagent status');
    expect(view.host.textContent).toContain('run_abc123');

    view.expand();

    expect(view.host.textContent).toContain('Control');
    expect(view.host.textContent).toContain('running · run_abc123');
    expect(view.host.textContent).not.toContain('ACP');
    expect(view.host.textContent).not.toContain('A2A');

    view.cleanup();
  });

  it('redacts secrets from subagent summaries, details, raw input, and output', () => {
    const view = renderToolCall({
      type: 'tool-call',
      toolCallId: 'tool-secret',
      toolName: 'subagent',
      state: 'done',
      input: {
        agent: 'reviewer',
        task: 'Review Authorization: Bearer sk-subagent-secret-1234567890',
        cwd: '/tmp/mindos',
        context: 'token=abc123secret',
        headers: { Authorization: 'Bearer ghp_abcdefghijklmnopqrstuvwxyz123456' },
      },
      output: 'token=abc123secret',
    });

    expect(view.host.textContent).toContain('[redacted]');
    expect(view.host.textContent).not.toContain('sk-subagent-secret');

    view.expand();

    expect(view.host.textContent).toContain('Raw input');
    expect(view.host.textContent).toContain('[redacted]');
    expect(view.host.textContent).not.toContain('sk-subagent-secret');
    expect(view.host.textContent).not.toContain('abc123secret');
    expect(view.host.textContent).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456');

    view.cleanup();
  });
});
