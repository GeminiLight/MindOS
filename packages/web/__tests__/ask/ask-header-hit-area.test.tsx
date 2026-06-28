// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import AskHeader from '@/components/ask/AskHeader';

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      ask: {
        sessionHistory: 'Session History',
        saveSession: 'Save Session',
      },
      hints: {
        sessionHistory: 'Session history',
        newSession: 'New session',
        maximizePanel: 'Focus mode',
        restorePanel: 'Restore panel',
        dockToSide: 'Dock to side panel',
        openAsPopup: 'Open as popup',
        closePanel: 'Close',
        newChat: 'New chat',
      },
    },
  }),
}));

vi.mock('@/hooks/useAskSession', () => ({
  sessionTitle: (session: { title?: string | null }) => session.title ?? 'New chat',
}));

vi.mock('@/components/ask/SaveSessionInline', () => ({
  SaveSessionButton: () => <button type="button" title="Save Session" className="save-session-stub h-9 w-9">save</button>,
}));

describe('AskHeader panel hit area', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('uses larger hit targets for panel header buttons and session switcher', () => {
    const html = renderToStaticMarkup(
      <AskHeader
        isPanel
        showHistory={false}
        onToggleHistory={vi.fn()}
        onReset={vi.fn()}
        isLoading={false}
        maximized={false}
        onMaximize={vi.fn()}
        onClose={vi.fn()}
        sessions={[
          { id: '1', title: 'First session' } as any,
          { id: '2', title: 'Second session' } as any,
        ]}
        activeSessionId="1"
        onLoadSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onRenameSession={vi.fn()}
        onTogglePinSession={vi.fn()}
        messages={[{ role: 'assistant', content: 'hello' } as any]}
      />,
    );

    expect(html).toContain('title="Session history"');
    expect(html).toContain('title="New session"');
    expect(html).toContain('title="Save Session"');
    expect(html).toContain('title="Focus mode"');
    expect(html.indexOf('title="New session"')).toBeLessThan(html.indexOf('title="Session history"'));
    expect(html.indexOf('title="New session"')).toBeLessThan(html.indexOf('title="Save Session"'));
    expect(html.indexOf('title="Session history"')).toBeLessThan(html.indexOf('title="Save Session"'));
    expect(html).not.toContain('title="Open as popup"');
    expect(html).not.toContain('title="Dock to side panel"');
    expect(html).toContain('h-9 w-9');
    expect(html).toContain('min-h-9');
    expect(html).toContain('relative z-20 isolate');
    expect(html).toContain('pointer-events-auto touch-manipulation');
    expect(html).toContain('rounded-lg');
  });

  it('shows dock and save actions together for maximized full-page sessions with content', () => {
    const html = renderToStaticMarkup(
      <AskHeader
        isPanel
        showHistory={false}
        onToggleHistory={vi.fn()}
        onReset={vi.fn()}
        isLoading={false}
        maximized
        onDockToPanel={vi.fn()}
        sessions={[
          { id: '1', title: 'Full page session' } as any,
        ]}
        activeSessionId="1"
        messages={[{ role: 'assistant', content: 'summary' } as any]}
      />,
    );

    expect(html).toContain('title="Dock to side panel"');
    expect(html).toContain('title="Save Session"');
    expect(html).toContain('data-ask-header-actions');
    expect(html).not.toContain('title="Focus mode"');
  });

  it('opens the session dropdown for a single selected Claude Code session', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <AskHeader
          isPanel
          showHistory={false}
          onToggleHistory={vi.fn()}
          onReset={vi.fn()}
          isLoading={false}
          sessions={[
            {
              id: 'claude-session',
              title: 'Claude review',
              messages: [{ role: 'user', content: 'review' }],
              defaultAgentRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
              runtimeSessionBinding: {
                kind: 'claude-session',
                runtime: 'claude',
                runtimeId: 'claude',
                externalSessionId: 'session_1234567890abcdef',
                cwd: '/tmp/mind',
                status: 'active',
                updatedAt: 1,
              },
            } as any,
          ]}
          activeSessionId="claude-session"
          onLoadSession={vi.fn()}
          onDeleteSession={vi.fn()}
          onRenameSession={vi.fn()}
          onTogglePinSession={vi.fn()}
          selectedAgentRuntime={{ id: 'claude', name: 'Claude Code', kind: 'claude' }}
          onSelectAgentRuntime={vi.fn()}
          nativeRuntimes={[{ id: 'claude', name: 'Claude Code', kind: 'claude' }]}
          messages={[]}
        />,
      );
    });

    const titleButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Claude review')) as HTMLButtonElement;
    expect(titleButton).toBeTruthy();

    await act(async () => {
      titleButton.click();
    });

    expect(document.body.textContent).toContain('MindOS-linked Claude Code chats');
    expect(document.body.textContent).toContain('Claude review');
    expect(document.body.textContent).toContain('Claude');
    expect(document.body.textContent).toContain('/mind');
    expect(document.body.textContent).toContain('session_...abcdef');
    expect(document.body.textContent).toContain('1 msgs');
    expect(document.body.textContent).not.toContain('Claude Code session session_...abcdef');
    expect(document.body.textContent).not.toContain('/tmp/mind');
    expect(document.body.querySelector('[title*="session_1234567890abcdef"]')).toBeTruthy();
    expect(document.body.querySelector('[title*="/tmp/mind"]')).toBeTruthy();
    expect(document.body.textContent).toContain('New chat');

    await act(async () => {
      root.unmount();
    });
  });

  it('labels the native Codex header dropdown as MindOS-linked chats, not full Codex threads', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <AskHeader
          isPanel
          showHistory={false}
          onToggleHistory={vi.fn()}
          onReset={vi.fn()}
          isLoading={false}
          sessions={[]}
          activeSessionId={null}
          onLoadSession={vi.fn()}
          onDeleteSession={vi.fn()}
          onRenameSession={vi.fn()}
          onTogglePinSession={vi.fn()}
          selectedAgentRuntime={{ id: 'codex', name: 'Codex', kind: 'codex' }}
          onSelectAgentRuntime={vi.fn()}
          nativeRuntimes={[{ id: 'codex', name: 'Codex', kind: 'codex' }]}
          messages={[]}
        />,
      );
    });

    const titleButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('MindOS-linked Codex chats')) as HTMLButtonElement;
    expect(titleButton).toBeTruthy();

    await act(async () => {
      titleButton.click();
    });

    expect(document.body.textContent).toContain('MindOS-linked Codex chats');
    expect(document.body.textContent).toContain('No mindos-linked codex chats.');
    expect(document.body.textContent).not.toContain('Codex threads');

    await act(async () => {
      root.unmount();
    });
  });
});
