// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    rerender: (nextPart: ToolCallPart) => {
      act(() => {
        root.render(<ToolCallBlock part={nextPart} />);
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

describe('ToolCallBlock native runtime rendering', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('renders Claude Code Bash calls as native runtime execution until an approval request arrives', () => {
    const view = renderToolCall({
      type: 'tool-call',
      toolCallId: 'tool-claude-bash',
      toolName: 'Bash',
      runtime: 'claude',
      state: 'running',
      input: {
        command: 'mindos file delete "Profile.md"',
        description: 'Delete the profile note',
      },
    });

    expect(view.host.textContent).toContain('Claude Code');
    expect(view.host.textContent).toContain('Bash');
    expect(view.host.textContent).toContain('mindos file delete "Profile.md"');
    expect(view.host.textContent).toContain('Running in Claude Code');
    expect(view.host.textContent).not.toContain('Local approval may be required');
    expect(view.host.textContent).not.toContain('permission pipeline');

    view.cleanup();
  });

  it('renders actionable runtime permission controls', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    const view = renderToolCall({
      type: 'tool-call',
      toolCallId: 'cmd-1',
      toolName: 'Bash',
      runtime: 'codex',
      state: 'running',
      input: {
        command: 'mindos file delete "Profile.md"',
      },
      runtimePermission: {
        runId: 'run-1',
        requestId: 'perm-1',
        runtime: 'codex',
        status: 'waiting',
        options: [
          { id: 'accept', label: 'Allow once', intent: 'allow' },
          { id: 'decline', label: 'Deny', intent: 'deny' },
        ],
      },
    });

    expect(view.host.textContent).toContain('Codex permission request');
    expect(view.host.textContent).toContain('Allow once');
    expect(view.host.textContent).toContain('Deny');

    const allowButton = Array.from(view.host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Allow once'));
    expect(allowButton).toBeTruthy();

    await act(async () => {
      allowButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/ask/runtime-permission', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        runId: 'run-1',
        requestId: 'perm-1',
        decision: 'accept',
      }),
    }));

    view.cleanup();
    vi.unstubAllGlobals();
  });

  it('clears local permission button loading state once the runtime resolves the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    const waitingPart: ToolCallPart = {
      type: 'tool-call',
      toolCallId: 'cmd-spinner',
      toolName: 'Bash',
      runtime: 'claude',
      state: 'running',
      input: { command: 'touch /tmp/example' },
      runtimePermission: {
        runId: 'run-spinner',
        requestId: 'perm-spinner',
        runtime: 'claude',
        status: 'waiting',
        options: [
          { id: 'accept', label: 'Allow once', intent: 'allow' },
          { id: 'decline', label: 'Deny', intent: 'deny' },
        ],
      },
    };
    const view = renderToolCall(waitingPart);
    const allowButton = Array.from(view.host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Allow once'));

    await act(async () => {
      allowButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(allowButton?.querySelector('.animate-spin')).toBeTruthy();

    view.rerender({
      ...waitingPart,
      runtimePermission: {
        ...waitingPart.runtimePermission!,
        status: 'approved',
        decision: 'accept',
      },
    });

    expect(view.host.textContent).toContain('Approved');
    const resolvedAllowButton = Array.from(view.host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Allow once'));
    expect(resolvedAllowButton?.querySelector('.animate-spin')).toBeNull();

    view.cleanup();
    vi.unstubAllGlobals();
  });

  it('renders Codex command output in a native runtime card', () => {
    const view = renderToolCall({
      type: 'tool-call',
      toolCallId: 'tool-codex-bash',
      toolName: 'Bash',
      runtime: 'codex',
      state: 'done',
      input: 'mindos search "permission"',
      output: 'Found 3 notes.',
    });

    expect(view.host.textContent).toContain('Codex');
    expect(view.host.textContent).toContain('mindos search "permission"');
    expect(view.host.textContent).toContain('Found 3 notes.');
    expect(view.host.textContent).not.toContain('only mirrors');

    view.cleanup();
  });

  it('redacts secrets from native runtime command and output rendering', () => {
    const view = renderToolCall({
      type: 'tool-call',
      toolCallId: 'tool-codex-secret',
      toolName: 'Bash',
      runtime: 'codex',
      state: 'done',
      input: {
        command: 'curl -H "Authorization: Bearer sk-ui-secret-1234567890" https://example.test?token=abc123secret',
        env: { API_KEY: 'sk-ui-secret-abcdefghijkl' },
      },
      output: 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456',
    });

    expect(view.host.textContent).toContain('[redacted]');
    expect(view.host.textContent).not.toContain('sk-ui-secret');
    expect(view.host.textContent).not.toContain('abc123secret');
    expect(view.host.textContent).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456');

    view.cleanup();
  });

  it('renders native Claude AskUserQuestion input as a structured question card', () => {
    const view = renderToolCall({
      type: 'tool-call',
      toolCallId: 'toolu-question',
      toolName: 'AskUserQuestion',
      runtime: 'claude',
      state: 'running',
      input: {
        questions: [{
          question: 'Delete the CV review note?',
          header: 'Delete confirmation',
          options: [
            { label: 'Delete', description: 'Remove the note.' },
            { label: 'Keep', description: 'Leave it unchanged.' },
          ],
        }],
      },
    });

    expect(view.host.textContent).toContain('Claude Code question');
    expect(view.host.textContent).toContain('Delete the CV review note?');
    expect(view.host.textContent).toContain('Delete confirmation');
    expect(view.host.textContent).toContain('Delete');
    expect(view.host.textContent).toContain('Keep');
    expect(view.host.textContent).toContain('no longer waiting for an answer');
    expect(view.host.textContent).not.toContain('opens its own prompt');
    expect(view.host.textContent).not.toContain('"questions"');

    view.cleanup();
  });
});
