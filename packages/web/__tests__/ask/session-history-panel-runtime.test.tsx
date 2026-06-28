// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SessionHistoryPanel from '@/components/ask/SessionHistoryPanel';
import type { AgentRuntimeIdentity, ChatSession, CodexThreadSummary } from '@/lib/types';
import { codexThreadToRuntimeSessionEntry } from '@/lib/codex-thread-import';
import type { RuntimeSessionEntry } from '@/lib/runtime-session-entry';

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
    runtimeSessions?: RuntimeSessionEntry[];
    runtimeSessionsLoading?: boolean;
    runtimeSessionsError?: string | null;
    runtimeSessionsSupported?: boolean;
    onAttachRuntimeSession?: (entry: RuntimeSessionEntry) => void;
    onForkRuntimeSession?: (entry: RuntimeSessionEntry) => void;
    onArchiveRuntimeSession?: (entry: RuntimeSessionEntry) => void;
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
        runtimeSessions={options.runtimeSessions}
        runtimeSessionsLoading={options.runtimeSessionsLoading}
        runtimeSessionsError={options.runtimeSessionsError}
        runtimeSessionsSupported={options.runtimeSessionsSupported ?? false}
        onLoad={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onTogglePin={vi.fn()}
        onClearAll={vi.fn()}
        onClose={vi.fn()}
        onNewChat={vi.fn()}
        onRefreshRuntimeSessions={vi.fn()}
        onAttachRuntimeSession={options.onAttachRuntimeSession}
        onForkRuntimeSession={options.onForkRuntimeSession}
        onArchiveRuntimeSession={options.onArchiveRuntimeSession}
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
    expect(view.host.textContent).not.toContain('Release notes');

    view.cleanup();
  });

  it('keeps compact rows from repeating the title as a duplicate preview', async () => {
    const sessions: ChatSession[] = [
      {
        id: 'tiny',
        title: 'tiny hello',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [{ role: 'user', content: 'tiny hello' }],
      },
    ];

    const view = renderPanel(sessions);

    const visibleText = view.host.textContent ?? '';
    expect(visibleText.match(/tiny hello/g) ?? []).toHaveLength(1);
    expect(visibleText).toContain('1 msgs');

    view.cleanup();
  });

  it('keeps row time at the trailing edge and swaps actions in only on hover/focus', async () => {
    const sessions: ChatSession[] = [
      {
        id: 'overlay-row',
        title: 'A long saved conversation title that should keep room for content',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [{ role: 'user', content: 'overlay behavior' }],
      },
    ];

    const view = renderPanel(sessions);
    const row = view.host.querySelector('[data-session-history-row]') as HTMLElement;
    const timeSlot = row.querySelector('[data-session-row-time]') as HTMLElement;
    const actionsSlot = row.querySelector('[data-session-row-actions]') as HTMLElement;

    expect(row).toBeTruthy();
    expect(timeSlot?.textContent).toContain('just now');
    expect(timeSlot?.className).toContain('group-hover:opacity-0');
    expect(actionsSlot).toBeTruthy();
    expect(actionsSlot.className).toContain('opacity-0');
    expect(actionsSlot.className).toContain('group-hover:pointer-events-auto');
    expect(row.querySelector('[data-stable-row-trailing]')).toBeNull();

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

    expect(view.host.textContent).toContain('Claude');
    expect(view.host.textContent).toContain('/mind');
    expect(view.host.textContent).toContain('session_...abcdef');
    expect(view.host.textContent).not.toContain('Claude Code session session_...abcdef');
    expect(view.host.textContent).not.toContain('/tmp/mind');
    expect(view.host.querySelector('[title*="session_1234567890abcdef"]')).toBeTruthy();
    expect(view.host.querySelector('[title*="/tmp/mind"]')).toBeTruthy();
    expect(view.host.textContent).toContain('MindOS planning');

    const search = view.host.querySelector('input') as HTMLInputElement;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(search, '1234567890');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(view.host.textContent).toContain('Claude review');
    expect(view.host.textContent).toContain('/mind');
    expect(view.host.querySelector('[title*="session_1234567890abcdef"]')).toBeTruthy();
    expect(view.host.textContent).not.toContain('MindOS planning');

    view.cleanup();
  });

  it('shows concrete ACP agent metadata with local session id and message count', async () => {
    const sessions: ChatSession[] = [
      {
        id: 'acp-local-session-123456789',
        title: 'Kimi ACP chat',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [
          { role: 'user', content: 'ask kimi' },
          { role: 'assistant', content: 'kimi answer' },
        ],
        defaultAcpAgent: { id: 'kimi', name: 'Kimi' },
        defaultAgentRuntime: { id: 'kimi', name: 'Kimi', kind: 'acp' },
      },
    ];

    const view = renderPanel(sessions, {
      selectedAgentRuntime: { id: 'kimi', name: 'Kimi', kind: 'acp' },
    });

    expect(view.host.textContent).toContain('Kimi');
    expect(view.host.textContent).toContain('acp-loca...456789');
    expect(view.host.textContent).toContain('2 msgs');
    expect(view.host.querySelector('[title*="acp-local-session-123456789"]')).toBeTruthy();

    view.cleanup();
  });

  it('renders runtime session rows from a non-Codex adapter shape when supplied', async () => {
    const claudeRuntime: AgentRuntimeIdentity = { id: 'claude', name: 'Claude Code', kind: 'claude' };
    const entries: RuntimeSessionEntry[] = [{
      id: 'session_abcdef1234567890',
      runtime: claudeRuntime,
      title: 'Claude architecture review',
      preview: 'Inspect the shared runtime session surface',
      cwd: '/tmp/mindos-dev',
      updatedAt: Date.now(),
      status: 'active',
      messageCount: 6,
    }];
    const onAttach = vi.fn();
    const onFork = vi.fn();
    const onArchive = vi.fn();

    const view = renderPanel([], {
      selectedAgentRuntime: claudeRuntime,
      runtimeSessions: entries,
      runtimeSessionsSupported: true,
      onAttachRuntimeSession: onAttach,
      onForkRuntimeSession: onFork,
      onArchiveRuntimeSession: onArchive,
    });

    expect(view.host.textContent).toContain('Claude architecture review');
    expect(view.host.textContent).toContain('Claude Code');
    expect(view.host.textContent).toContain('/mindos-dev');
    expect(view.host.textContent).toContain('session_...567890');
    expect(view.host.textContent).toContain('6 msgs');
    const runtimeRow = view.host.querySelector('[data-runtime-session-row]') as HTMLElement;
    expect(runtimeRow?.querySelector('[data-session-row-time]')?.textContent).toContain('just now');
    expect(runtimeRow?.querySelector('[data-session-row-actions]')).toBeTruthy();
    expect(runtimeRow?.querySelector('[data-stable-row-trailing]')).toBeNull();

    const openRow = view.host.querySelector('[role="button"][title="Open this Claude Code session"]') as HTMLElement;
    await act(async () => {
      openRow.click();
    });
    expect(onAttach).toHaveBeenCalledWith(entries[0]);

    const buttons = Array.from(view.host.querySelectorAll('button'));
    await act(async () => {
      buttons.find((button) => button.title === 'Fork Claude Code session')?.click();
    });
    expect(onFork).toHaveBeenCalledWith(entries[0]);

    await act(async () => {
      buttons.find((button) => button.title === 'Archive Claude Code session')?.click();
    });
    expect(onArchive).toHaveBeenCalledWith(entries[0]);

    view.cleanup();
  });

  it('shows external Codex runtime sessions as flat rows only in the Codex runtime lane', async () => {
    const codexRuntime: AgentRuntimeIdentity = { id: 'codex', name: 'Codex', kind: 'codex' };
    const threads: CodexThreadSummary[] = [{
      id: '019eb06e-a24b-7221-b47d-c2c99cf07b14',
      name: 'Fix runtime switcher',
      preview: 'Continue the native Codex thread manager work',
      cwd: '/Users/moonshot/projects/product/mindos-dev',
      updatedAt: Date.now(),
      status: 'idle',
      messageCount: 4,
    }];
    const onAttach = vi.fn();
    const onFork = vi.fn();
    const onArchive = vi.fn();
    const entries = threads.map((thread) => codexThreadToRuntimeSessionEntry(thread, codexRuntime));

    const view = renderPanel([], {
      selectedAgentRuntime: codexRuntime,
      runtimeSessions: entries,
      runtimeSessionsSupported: true,
      onAttachRuntimeSession: onAttach,
      onForkRuntimeSession: onFork,
      onArchiveRuntimeSession: onArchive,
    });

    expect(view.host.textContent).not.toContain('Codex local threads');
    expect(view.host.textContent).toContain('Fix runtime switcher');
    expect(view.host.textContent).toContain('/mindos-dev');
    expect(view.host.textContent).toContain('019eb06e...f07b14');
    expect(view.host.textContent).toContain('4 msgs');
    expect(view.host.textContent).not.toContain('/Users/moonshot/projects/product/mindos-dev');
    expect(view.host.querySelector('[title*="/Users/moonshot/projects/product/mindos-dev"]')).toBeTruthy();

    const search = view.host.querySelector('input') as HTMLInputElement;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(search, 'native codex');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(view.host.textContent).toContain('Fix runtime switcher');

    const openThreadRow = view.host.querySelector('[role="button"][title="Open this Codex thread"]') as HTMLElement;
    expect(openThreadRow?.textContent).toContain('Fix runtime switcher');
    expect(openThreadRow?.textContent).toContain('Codex');
    expect(openThreadRow?.textContent).toContain('/mindos-dev');
    expect(openThreadRow?.querySelector('.h-7.w-7')).toBeNull();

    await act(async () => {
      openThreadRow?.click();
    });
    expect(onAttach).toHaveBeenCalledWith(entries[0]);

    const buttons = Array.from(view.host.querySelectorAll('button'));
    await act(async () => {
      buttons.find((button) => button.title === 'Fork Codex thread')?.click();
    });
    expect(onFork).toHaveBeenCalledWith(entries[0]);

    await act(async () => {
      buttons.find((button) => button.title === 'Archive Codex thread')?.click();
    });
    expect(onArchive).toHaveBeenCalledWith(entries[0]);

    view.cleanup();

    const hidden = renderPanel([], {
      selectedAgentRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
      runtimeSessions: entries,
      runtimeSessionsSupported: false,
    });
    expect(hidden.host.textContent).not.toContain('Codex local threads');
    expect(hidden.host.textContent).not.toContain('Fix runtime switcher');
    hidden.cleanup();
  });

  it('renders session history as one flat list without time group headings', async () => {
    const codexRuntime: AgentRuntimeIdentity = { id: 'codex', name: 'Codex', kind: 'codex' };
    const now = Date.now();
    const sessions: ChatSession[] = [
      {
        id: 'pinned-session',
        title: 'Pinned design note',
        createdAt: now - 1_000,
        updatedAt: now - 1_000,
        pinned: true,
        messages: [{ role: 'user', content: 'Pinned design note' }],
      },
      {
        id: 'older-session',
        title: 'Archive planning note',
        createdAt: now - 12 * 86400000,
        updatedAt: now - 12 * 86400000,
        messages: [{ role: 'user', content: 'Archive planning note' }],
      },
    ];
    const threads: CodexThreadSummary[] = [{
      id: '019eb06e-a24b-7221-b47d-c2c99cf07b14',
      name: 'Runtime thread note',
      updatedAt: now,
    }];

    const view = renderPanel(sessions, {
      selectedAgentRuntime: codexRuntime,
      runtimeSessions: threads.map((thread) => codexThreadToRuntimeSessionEntry(thread, codexRuntime)),
      runtimeSessionsSupported: true,
    });

    const visibleText = view.host.textContent ?? '';
    expect(visibleText).toContain('Pinned design note');
    expect(visibleText).toContain('Archive planning note');
    expect(visibleText).toContain('Runtime thread note');
    expect(visibleText).not.toContain('Codex local threads');
    expect(visibleText).not.toContain('Today');
    expect(visibleText).not.toContain('This week');
    expect(visibleText).not.toContain('Older');
    expect(visibleText.indexOf('Pinned design note')).toBeLessThan(visibleText.indexOf('Runtime thread note'));

    view.cleanup();
  });

  it('does not render a bulk clear action in session history', async () => {
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
      runtimeSessions: threads.map((thread) => codexThreadToRuntimeSessionEntry(thread, codexRuntime)),
      runtimeSessionsSupported: true,
    });

    expect(view.host.textContent).not.toContain('Clear saved chats');
    expect(view.host.textContent).not.toContain('Clear all');
    expect(view.host.textContent).not.toContain('Confirm clear saved chats?');

    view.cleanup();
  });
});
