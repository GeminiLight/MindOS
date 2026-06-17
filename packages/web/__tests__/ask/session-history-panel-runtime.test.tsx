// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SessionHistoryPanel from '@/components/ask/SessionHistoryPanel';
import type { AgentRuntimeIdentity, ChatSession, CodexThreadSummary } from '@/lib/types';

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      ask: {
        historySearch: 'Search conversations...',
        historyStats: (n: number) => `${n} conversations`,
        historyPinned: 'Pinned',
        historyToday: 'Today',
        historyYesterday: 'Yesterday',
        historyThisWeek: 'This week',
        historyOlder: 'Older',
        historyMsgs: (n: number) => `${n} msgs`,
        clearAll: 'Clear all',
        confirmClear: 'Confirm clear?',
        historyCapacity: (n: number) => `${n} of 30`,
        renameSession: 'Rename',
      },
      hints: {
        newChat: 'New chat',
      },
    },
  }),
}));

function renderPanel(
  sessions: ChatSession[],
  options: {
    selectedAgentRuntime?: AgentRuntimeIdentity | null;
    codexThreads?: CodexThreadSummary[];
    codexThreadsLoading?: boolean;
    codexThreadsError?: string | null;
    onAttachCodexThread?: (thread: CodexThreadSummary) => void;
    onForkCodexThread?: (thread: CodexThreadSummary) => void;
    onArchiveCodexThread?: (thread: CodexThreadSummary) => void;
  } = {},
) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <SessionHistoryPanel
        sessions={sessions}
        activeSessionId={sessions[0]?.id ?? null}
        selectedAgentRuntime={options.selectedAgentRuntime}
        codexThreads={options.codexThreads}
        codexThreadsLoading={options.codexThreadsLoading}
        codexThreadsError={options.codexThreadsError}
        onLoad={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onTogglePin={vi.fn()}
        onClearAll={vi.fn()}
        onClose={vi.fn()}
        onNewChat={vi.fn()}
        onRefreshCodexThreads={vi.fn()}
        onAttachCodexThread={options.onAttachCodexThread}
        onForkCodexThread={options.onForkCodexThread}
        onArchiveCodexThread={options.onArchiveCodexThread}
      />,
    );
  });
  return {
    host,
    cleanup: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

describe('SessionHistoryPanel runtime session metadata', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('keeps session message body search working through the cached search index', async () => {
    const now = Date.now();
    const sessions: ChatSession[] = [
      {
        id: 'deep-context',
        title: 'Design review',
        createdAt: now,
        updatedAt: now,
        messages: [
          { role: 'user', content: 'Please inspect the quiet navigation latency regression.' },
          { role: 'assistant', content: 'The likely cause is synchronous filtering.' },
        ],
      },
      {
        id: 'unrelated',
        title: 'Release notes',
        createdAt: now - 1000,
        updatedAt: now - 1000,
        messages: [{ role: 'user', content: 'Summarize the changelog.' }],
      },
    ];

    const view = renderPanel(sessions);
    const search = view.host.querySelector('input') as HTMLInputElement;

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(search, 'latency regression');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(view.host.textContent).toContain('Design review');
    expect(view.host.textContent).toContain('quiet navigation latency regression');
    expect(view.host.textContent).not.toContain('Release notes');

    view.cleanup();
  });

  it('shows linked native runtime session metadata and can search by external session id', async () => {
    const sessions: ChatSession[] = [
      {
        id: 'claude-linked',
        title: 'Claude review',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [{ role: 'user', content: 'review the diff' }],
        defaultAgentRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
        runtimeSessionBinding: {
          kind: 'claude-session',
          runtime: 'claude',
          runtimeId: 'claude',
          externalSessionId: 'session_1234567890abcdef',
          cwd: '/tmp/mind',
          status: 'active',
          updatedAt: Date.now(),
        },
      },
      {
        id: 'mindos',
        title: 'MindOS planning',
        createdAt: Date.now() - 1000,
        updatedAt: Date.now() - 1000,
        messages: [{ role: 'user', content: 'plan the release' }],
      },
    ];

    const view = renderPanel(sessions);

    expect(view.host.textContent).toContain('Claude Code session session_...abcdef');
    expect(view.host.textContent).toContain('/tmp/mind');
    expect(view.host.textContent).toContain('MindOS planning');

    const search = view.host.querySelector('input') as HTMLInputElement;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(search, '1234567890');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(view.host.textContent).toContain('Claude review');
    expect(view.host.textContent).toContain('Claude Code session session_...abcdef');
    expect(view.host.textContent).not.toContain('MindOS planning');

    view.cleanup();
  });

  it('shows external Codex local threads only in the Codex runtime lane', async () => {
    const codexRuntime: AgentRuntimeIdentity = { id: 'codex', name: 'Codex', kind: 'codex' };
    const threads: CodexThreadSummary[] = [{
      id: '019eb06e-a24b-7221-b47d-c2c99cf07b14',
      name: 'Fix runtime switcher',
      preview: 'Continue the native Codex thread manager work',
      cwd: '/Users/moonshot/projects/product/mindos-dev',
      updatedAt: Date.now(),
      status: 'idle',
    }];
    const onAttach = vi.fn();
    const onFork = vi.fn();
    const onArchive = vi.fn();

    const view = renderPanel([], {
      selectedAgentRuntime: codexRuntime,
      codexThreads: threads,
      onAttachCodexThread: onAttach,
      onForkCodexThread: onFork,
      onArchiveCodexThread: onArchive,
    });

    expect(view.host.textContent).toContain('Codex local threads');
    expect(view.host.textContent).toContain('Fix runtime switcher');
    expect(view.host.textContent).toContain('/Users/moonshot/projects/product/mindos-dev');
    expect(view.host.textContent).toContain('019eb06e...f07b14');

    const search = view.host.querySelector('input') as HTMLInputElement;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(search, 'native codex');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(view.host.textContent).toContain('Fix runtime switcher');

    const buttons = Array.from(view.host.querySelectorAll('button'));
    await act(async () => {
      buttons.find((button) => button.title === 'Open this Codex thread')?.click();
    });
    expect(onAttach).toHaveBeenCalledWith(threads[0]);

    await act(async () => {
      buttons.find((button) => button.title === 'Fork Codex thread')?.click();
    });
    expect(onFork).toHaveBeenCalledWith(threads[0]);

    await act(async () => {
      buttons.find((button) => button.title === 'Archive Codex thread')?.click();
    });
    expect(onArchive).toHaveBeenCalledWith(threads[0]);

    view.cleanup();

    const hidden = renderPanel([], {
      selectedAgentRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
      codexThreads: threads,
    });
    expect(hidden.host.textContent).not.toContain('Codex local threads');
    expect(hidden.host.textContent).not.toContain('Fix runtime switcher');
    hidden.cleanup();
  });

  it('labels native runtime clearing as saved chats instead of all local runtime threads', async () => {
    const codexRuntime: AgentRuntimeIdentity = { id: 'codex', name: 'Codex', kind: 'codex' };
    const sessions: ChatSession[] = [{
      id: 'saved-codex',
      title: 'Saved Codex chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [{ role: 'user', content: 'saved codex' }],
      defaultAgentRuntime: codexRuntime,
    }];
    const threads: CodexThreadSummary[] = [{
      id: '019eb06e-a24b-7221-b47d-c2c99cf07b14',
      preview: 'Native thread',
      updatedAt: Date.now(),
    }];

    const view = renderPanel(sessions, {
      selectedAgentRuntime: codexRuntime,
      codexThreads: threads,
    });

    expect(view.host.textContent).toContain('Clear saved chats');
    expect(view.host.textContent).not.toContain('Clear all');

    const clearButton = Array.from(view.host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Clear saved chats'));
    expect(clearButton).toBeTruthy();
    await act(async () => {
      clearButton?.click();
    });

    expect(view.host.textContent).toContain('Confirm clear saved chats?');

    view.cleanup();
  });
});
