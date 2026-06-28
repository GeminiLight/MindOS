// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionContextDock from '@/components/ask/SessionContextDock';
import type { ChatSession, SessionContextSelection, SessionWorkDir } from '@/lib/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const labels = {
  title: 'Context',
  workDir: 'Root',
  spaces: 'Spaces',
  assistants: 'Assistants',
  mindRoot: 'Mind',
  none: 'None',
  locked: 'Locked after first message',
  editWorkDir: 'Set root',
  workDirPlaceholder: '/path/to/root',
  workDirBrowse: 'Choose root',
  workDirBrowseUnavailable: 'Folder picker is available in the desktop app',
  addSpace: 'Add Space',
  addAssistant: 'Add Assistant',
  searchSpaces: 'Search spaces',
  searchAssistants: 'Search assistants',
  noMatches: 'No matches',
  removeItem: (label: string) => `Remove ${label}`,
  spacePlaceholder: 'Space path',
  assistantPlaceholder: 'assistant-id',
  applyNextTurn: 'Changes apply to the next message.',
  spacesCount: (n: number) => `${n} space${n === 1 ? '' : 's'}`,
  assistantsCount: (n: number) => `${n} assistant${n === 1 ? '' : 's'}`,
};

function sessionWithSelection(selection: Partial<SessionContextSelection> = {}): ChatSession {
  return {
    id: 'session-1',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    workDir: { source: 'mind-root', label: 'Mind root' },
    contextSelection: {
      version: 1,
      spaces: [],
      assistants: [],
      ...selection,
    },
  };
}

function mountDock({
  session = sessionWithSelection({
    spaces: [{ path: 'MIND_DAO', label: '道', icon: '道', source: 'manual' }],
    assistants: [{ id: 'daily-signal', name: 'Daily Signal', kind: 'assistant', source: 'manual' }],
  }),
  workDirEditable = true,
  onSetWorkDir = vi.fn(() => true),
  onSetContextSelection = vi.fn(() => true),
}: {
  session?: ChatSession;
  workDirEditable?: boolean;
  onSetWorkDir?: (workDir: SessionWorkDir) => boolean;
  onSetContextSelection?: (selection: SessionContextSelection) => boolean;
} = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  act(() => {
    root.render(
      <SessionContextDock
        session={session}
        labels={labels}
        workDirEditable={workDirEditable}
        onSetWorkDir={onSetWorkDir}
        onSetContextSelection={onSetContextSelection}
      />,
    );
  });

  return { host, root, onSetWorkDir, onSetContextSelection };
}

describe('SessionContextDock', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('fetch unused in this test'))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('renders a quiet collapsed summary without the legacy Context/None table copy', () => {
    const { host, root } = mountDock();

    expect(host.textContent).toContain('Mind');
    expect(host.textContent).toContain('Spaces');
    expect(host.textContent).toContain('Assistants');
    expect(host.textContent).toContain('1');
    expect(host.textContent).not.toContain('Context');
    expect(host.textContent).not.toContain('None');

    act(() => root.unmount());
  });

  it('adds and removes Spaces returned by the list_spaces API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        spaces: [
          { name: 'Research', path: 'Research', fileCount: 3, description: 'Papers and notes' },
        ],
      }),
    }));

    const onSetContextSelection = vi.fn(() => true);
    const { host, root } = mountDock({ onSetContextSelection });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const toggle = host.querySelector('button[aria-label="Context"]') as HTMLButtonElement;
    act(() => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const addSpace = document.body.querySelector('button[aria-label="Add Space"]') as HTMLButtonElement;
    act(() => {
      addSpace.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.body.querySelector('[data-session-context-picker="spaces"]')?.textContent).not.toContain('术');

    const search = document.body.querySelector('input[aria-label="Search spaces"]') as HTMLInputElement;
    act(() => {
      search.value = 'Research';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const research = Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.includes('Research')) as HTMLButtonElement;
    act(() => {
      research.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSetContextSelection).toHaveBeenCalledWith(expect.objectContaining({
      spaces: expect.arrayContaining([
        expect.objectContaining({ path: 'Research', label: 'Research', source: 'filesystem' }),
      ]),
    }));

    const removeDao = document.body.querySelector('button[aria-label="Remove 道"]') as HTMLButtonElement;
    act(() => {
      removeDao.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSetContextSelection).toHaveBeenLastCalledWith(expect.objectContaining({
      spaces: [],
    }));

    act(() => root.unmount());
  });

  it('loads filesystem Spaces into the searchable picker', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        spaces: [
          { name: 'Research', path: 'Research', fileCount: 3, description: 'Papers and notes' },
          { name: 'Projects', path: 'Projects/', fileCount: 5, description: '' },
        ],
      }),
    }));

    const onSetContextSelection = vi.fn(() => true);
    const { host, root } = mountDock({
      session: sessionWithSelection(),
      onSetContextSelection,
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const toggle = host.querySelector('button[aria-label="Context"]') as HTMLButtonElement;
    act(() => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const addSpace = document.body.querySelector('button[aria-label="Add Space"]') as HTMLButtonElement;
    act(() => {
      addSpace.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const pickerText = document.body.querySelector('[data-session-context-picker="spaces"]')?.textContent ?? '';
    expect(pickerText).toContain('Research');
    expect(pickerText).toContain('Projects');
    expect(pickerText).not.toContain('道');
    expect(pickerText).not.toContain('术');

    const search = document.body.querySelector('input[aria-label="Search spaces"]') as HTMLInputElement;
    act(() => {
      search.value = 'Research';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const research = Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.includes('Research')) as HTMLButtonElement;
    act(() => {
      research.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSetContextSelection).toHaveBeenCalledWith(expect.objectContaining({
      spaces: [
        expect.objectContaining({
          path: 'Research',
          label: 'Research',
          source: 'filesystem',
        }),
      ],
    }));

    act(() => root.unmount());
  });

  it('adds Assistants through the searchable chip picker', () => {
    const onSetContextSelection = vi.fn(() => true);
    const { host, root } = mountDock({
      session: sessionWithSelection(),
      onSetContextSelection,
    });

    const toggle = host.querySelector('button[aria-label="Context"]') as HTMLButtonElement;
    act(() => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const addAssistant = document.body.querySelector('button[aria-label="Add Assistant"]') as HTMLButtonElement;
    act(() => {
      addAssistant.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const search = document.body.querySelector('input[aria-label="Search assistants"]') as HTMLInputElement;
    act(() => {
      search.value = 'Inbox';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const inboxOrganizer = Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.includes('Inbox Organizer')) as HTMLButtonElement;
    act(() => {
      inboxOrganizer.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSetContextSelection).toHaveBeenCalledWith(expect.objectContaining({
      assistants: expect.arrayContaining([
        expect.objectContaining({ id: 'inbox-organizer', name: 'Inbox Organizer' }),
      ]),
    }));

    act(() => root.unmount());
  });

  it('uses icon-only hints for locked WorkDir and next-message apply details', () => {
    const { host, root } = mountDock({ workDirEditable: false });

    const toggle = host.querySelector('button[aria-label="Context"]') as HTMLButtonElement;
    act(() => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.body.textContent).not.toContain('Locked after first message');
    expect(document.body.textContent).not.toContain('Changes apply to the next message.');
    expect(document.body.querySelector('[aria-label="Locked after first message"]')).not.toBeNull();
    expect(document.body.querySelector('[aria-label="Changes apply to the next message."]')).not.toBeNull();

    act(() => root.unmount());
  });

  it('collapses the expanded tray when the user clicks outside the context controls', () => {
    const { host, root } = mountDock();
    const outside = document.createElement('button');
    outside.textContent = 'Composer input';
    document.body.appendChild(outside);

    const toggle = host.querySelector('button[aria-label="Context"]') as HTMLButtonElement;
    act(() => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.body.querySelector('button[aria-label="Add Space"]')).not.toBeNull();

    act(() => {
      outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });

    expect(document.body.querySelector('button[aria-label="Add Space"]')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    act(() => root.unmount());
  });
});
