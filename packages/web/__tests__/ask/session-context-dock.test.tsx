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
  openRootInFileManager: 'Open root in file manager',
  openRootInFileManagerFailed: 'Could not open root folder',
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

async function mountDock({
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

  await act(async () => {
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

describe('SessionContextDock', async () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('fetch unused in this test'))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('names the collapsed context and shows selected counts without an empty table', async () => {
    const { host, root } = await mountDock();

    expect(host.textContent).toContain('Mind');
    expect(host.textContent).toContain('1 space');
    expect(host.textContent).toContain('1 assistant');
    expect(host.textContent).toContain('1');
    expect(host.textContent).toContain('Context');
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
    const { host, root } = await mountDock({ onSetContextSelection });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const toggle = host.querySelector('button[aria-label="Context"]') as HTMLButtonElement;
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const addSpace = document.body.querySelector('button[aria-label="Add Space"]') as HTMLButtonElement;
    await act(async () => {
      addSpace.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.body.querySelector('[data-session-context-picker="spaces"]')?.textContent).not.toContain('术');

    const search = document.body.querySelector('input[aria-label="Search spaces"]') as HTMLInputElement;
    await act(async () => {
      search.value = 'Research';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const research = Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.includes('Research')) as HTMLButtonElement;
    await act(async () => {
      research.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSetContextSelection).toHaveBeenCalledWith(expect.objectContaining({
      spaces: expect.arrayContaining([
        expect.objectContaining({ path: 'Research', label: 'Research', source: 'filesystem' }),
      ]),
    }));

    const removeDao = document.body.querySelector('button[aria-label="Remove 道"]') as HTMLButtonElement;
    await act(async () => {
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
    const { host, root } = await mountDock({
      session: sessionWithSelection(),
      onSetContextSelection,
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const toggle = host.querySelector('button[aria-label="Context"]') as HTMLButtonElement;
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const addSpace = document.body.querySelector('button[aria-label="Add Space"]') as HTMLButtonElement;
    await act(async () => {
      addSpace.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const pickerText = document.body.querySelector('[data-session-context-picker="spaces"]')?.textContent ?? '';
    expect(pickerText).toContain('Research');
    expect(pickerText).toContain('Projects');
    expect(pickerText).not.toContain('道');
    expect(pickerText).not.toContain('术');

    const search = document.body.querySelector('input[aria-label="Search spaces"]') as HTMLInputElement;
    await act(async () => {
      search.value = 'Research';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const research = Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.includes('Research')) as HTMLButtonElement;
    await act(async () => {
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

  it('adds Assistants through the searchable chip picker', async () => {
    const onSetContextSelection = vi.fn(() => true);
    const { host, root } = await mountDock({
      session: sessionWithSelection(),
      onSetContextSelection,
    });

    const toggle = host.querySelector('button[aria-label="Context"]') as HTMLButtonElement;
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const addAssistant = document.body.querySelector('button[aria-label="Add Assistant"]') as HTMLButtonElement;
    await act(async () => {
      addAssistant.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const search = document.body.querySelector('input[aria-label="Search assistants"]') as HTMLInputElement;
    await act(async () => {
      search.value = 'Inbox';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const inboxOrganizer = Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.includes('Inbox Organizer')) as HTMLButtonElement;
    await act(async () => {
      inboxOrganizer.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSetContextSelection).toHaveBeenCalledWith(expect.objectContaining({
      assistants: expect.arrayContaining([
        expect.objectContaining({ id: 'inbox-organizer', name: 'Inbox Organizer' }),
      ]),
    }));

    act(() => root.unmount());
  });

  it('explains next-message scope and keeps the locked folder action available', async () => {
    const { host, root } = await mountDock({ workDirEditable: false });

    const toggle = host.querySelector('button[aria-label="Context"]') as HTMLButtonElement;
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.body.textContent).not.toContain('Locked after first message');
    expect(document.body.textContent).not.toContain('Open root in file manager');
    expect(document.body.textContent).toContain('Changes apply to the next message.');
    expect(document.body.querySelector('[aria-label="Locked after first message"]')).toBeNull();
    expect(document.body.querySelector('[aria-label="Open root in file manager"]')).not.toBeNull();
    expect(document.body.querySelector('[role="dialog"]')?.getAttribute('aria-describedby')).toBeTruthy();

    act(() => root.unmount());
  });

  it('opens the locked WorkDir in the native file manager from the tray action', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/file?op=list_spaces') {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ spaces: [] }),
        };
      }
      return {
        ok: true,
        json: vi.fn().mockResolvedValue({ ok: true }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { host, root } = await mountDock({ workDirEditable: false });

    await act(async () => {
      await Promise.resolve();
    });

    const toggle = host.querySelector('button[aria-label="Context"]') as HTMLButtonElement;
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const openRoot = document.body.querySelector('button[aria-label="Open root in file manager"]') as HTMLButtonElement;
    await act(async () => {
      openRoot.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/file?op=open_in_file_manager',
      expect.objectContaining({ method: 'GET', cache: 'no-store', signal: expect.any(AbortSignal) }),
    );

    act(() => root.unmount());
  });

  it('collapses the expanded tray when the user clicks outside the context controls', async () => {
    const { host, root } = await mountDock();
    const outside = document.createElement('button');
    outside.textContent = 'Composer input';
    document.body.appendChild(outside);

    const toggle = host.querySelector('button[aria-label="Context"]') as HTMLButtonElement;
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.body.querySelector('button[aria-label="Add Space"]')).not.toBeNull();

    await act(async () => {
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      outside.click();
    });

    expect(document.body.querySelector('button[aria-label="Add Space"]')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    act(() => root.unmount());
  });
});
