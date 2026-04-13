// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
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
        askMode="panel"
        onModeSwitch={vi.fn()}
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
    expect(html).toContain('title="Focus mode"');
    expect(html).toContain('h-9 w-9');
    expect(html).toContain('min-h-9');
    expect(html).toContain('rounded-lg');
  });
});
