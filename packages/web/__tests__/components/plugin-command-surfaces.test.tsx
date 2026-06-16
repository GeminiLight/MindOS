// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import SearchModal from '@/components/SearchModal';
import SearchPanel from '@/components/panels/SearchPanel';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  push: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: mocks.apiFetch,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/wiki',
  useRouter: () => ({ push: mocks.push, refresh: vi.fn() }),
}));

vi.mock('@/lib/toast', () => ({
  toast: Object.assign(mocks.toastInfo, {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  }),
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      search: {
        placeholder: 'Search files...',
        emptyTitle: 'Find your notes fast',
        emptyHint: 'Type a file name or keyword to begin',
        noResults: 'No results found',
        noResultsHint: 'Try different keywords',
        preparing: 'Preparing search...',
        fallbackWarmHint: 'Search will prepare on first query.',
        navigate: 'navigate',
        open: 'open',
        dragToChat: 'drag to chat',
        tabSearch: 'Search',
        tabActions: 'Actions',
        close: 'close',
        clear: 'Clear search',
        openSettings: 'Settings',
        restartWalkthrough: 'Restart',
        toggleDarkMode: 'Dark mode',
        goToAgents: 'Agents',
        goToDiscover: 'Discover',
        goToHelp: 'Help',
        walkthroughRestarted: 'Walkthrough restarted',
      },
    },
  }),
}));

const commandSurface = {
  id: 'obsidian:command:obsidian:quickadd-like:capture',
  source: 'obsidian',
  kind: 'command',
  location: 'command-center',
  availability: 'available',
  pluginId: 'quickadd-like',
  pluginName: 'QuickAdd Like',
  title: 'Quick Capture',
  action: {
    type: 'obsidian-command',
    commandId: 'obsidian:quickadd-like:capture',
  },
  metadata: {
    hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'c' }],
    hotkeyPolicy: {
      binding: 'display-only',
      status: 'conflict',
      reason: 'Obsidian default and imported hotkeys are shown for recognition but are not globally bound.',
      conflicts: [{
        label: '⌘⇧C',
        owner: 'plugin-command',
        ownerLabel: 'Capture Mate: Quick Capture',
        pluginId: 'capture-mate',
        commandId: 'obsidian:capture-mate:capture',
      }],
    },
    hotkeyConflicts: [{
      label: '⌘⇧C',
      owner: 'plugin-command',
      ownerLabel: 'Capture Mate: Quick Capture',
      pluginId: 'capture-mate',
      commandId: 'obsidian:capture-mate:capture',
    }],
  },
};

function setInputValue(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!nativeSetter) throw new Error('Missing native input setter');
  nativeSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function portalRoot() {
  return document.body;
}

const flushSmoothNavigation = () => act(async () => {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
});

function setupApiFetch() {
  mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/plugins/surfaces?loadEnabled=1&kind=command') {
      return { ok: true, surfaces: [commandSurface] };
    }
    if (url.startsWith('/api/search')) {
      return [];
    }
    if (url === '/api/obsidian-plugins' && init?.method === 'POST') {
      expect(JSON.parse(String(init.body))).toEqual({
        action: 'execute-command',
        commandId: 'obsidian:quickadd-like:capture',
      });
      return { ok: true, plugins: [] };
    }
    throw new Error(`Unexpected apiFetch call: ${url}`);
  });
}

describe('plugin command surfaces', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    setupApiFetch();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('shows Obsidian commands in mobile command palette actions and executes them', async () => {
    await act(async () => {
      root.render(<SearchModal open onClose={() => {}} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const actionsTab = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Actions')) as HTMLButtonElement;

    await act(async () => {
      actionsTab.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('QuickAdd Like: Quick Capture');
    expect(host.textContent).toContain('⌘⇧C');
    expect(host.textContent).toContain('Conflict');

    const commandButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('QuickAdd Like: Quick Capture')) as HTMLButtonElement;

    await act(async () => {
      commandButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.toastSuccess).toHaveBeenCalledWith('Ran Quick Capture');
  });

  it('shows a safe modal snapshot when a mobile plugin command opens an Obsidian modal', async () => {
    const onClose = vi.fn();
    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/plugins/surfaces?loadEnabled=1&kind=command') {
        return { ok: true, surfaces: [commandSurface] };
      }
      if (url.startsWith('/api/search')) {
        return [];
      }
      if (url === '/api/obsidian-plugins' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        if (body.action === 'choose-modal-suggestion') {
          expect(body).toEqual({
            action: 'choose-modal-suggestion',
            modalId: 'quickadd-like:modal:1',
            suggestionIndex: 1,
            interactionId: 'quickadd-modal-interaction-1',
          });
          return {
            ok: true,
            result: {
              workspaceOpenRequests: [{
                linktext: 'notes/from-suggestion.md',
                sourcePath: '',
                targetPath: 'notes/from-suggestion.md',
              }],
              modalSnapshots: [],
              menuSnapshots: [],
            },
          };
        }
        return {
          ok: true,
          result: {
            workspaceOpenRequests: [],
            modalSnapshots: [{
              id: 'quickadd-like:modal:1',
              pluginId: 'quickadd-like',
              kind: 'suggest',
              title: 'Quick capture modal',
              text: 'Choose a template',
              placeholder: 'Template name',
              interactionId: 'quickadd-modal-interaction-1',
              suggestions: [
                { index: 0, label: 'Inbox note' },
                { index: 1, label: 'Daily note' },
              ],
            }],
          },
        };
      }
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    await act(async () => {
      root.render(<SearchModal open onClose={onClose} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const actionsTab = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Actions')) as HTMLButtonElement;

    await act(async () => {
      actionsTab.click();
      await Promise.resolve();
    });

    const commandButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('QuickAdd Like: Quick Capture')) as HTMLButtonElement;

    await act(async () => {
      commandButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith('Ran Quick Capture');
    expect(portalRoot().textContent).toContain('Quick capture modal');
    expect(portalRoot().textContent).toContain('Choose a template');
    expect(portalRoot().textContent).toContain('Template name');
    expect(portalRoot().textContent).toContain('Inbox note');
    expect(portalRoot().textContent).toContain('Daily note');

    const dailyButton = Array.from(portalRoot().querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Daily note')) as HTMLButtonElement;

    await act(async () => {
      dailyButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushSmoothNavigation();
    expect(mocks.push).toHaveBeenCalledWith('/view/notes/from-suggestion.md');
  });

  it('shows a safe menu snapshot when a mobile plugin command opens an Obsidian menu', async () => {
    const onClose = vi.fn();
    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/plugins/surfaces?loadEnabled=1&kind=command') {
        return { ok: true, surfaces: [commandSurface] };
      }
      if (url.startsWith('/api/search')) {
        return [];
      }
      if (url === '/api/obsidian-plugins' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        if (body.action === 'choose-menu-item') {
          expect(body).toEqual({
            action: 'choose-menu-item',
            menuId: 'quickadd-like:menu:1',
            itemIndex: 0,
            interactionId: 'quickadd-menu-interaction-1',
          });
          return {
            ok: true,
            result: {
              workspaceOpenRequests: [],
              modalSnapshots: [],
              menuSnapshots: [],
              noticeSnapshots: [{
                id: 'quickadd-like:notice:1',
                pluginId: 'quickadd-like',
                message: 'Captured to inbox',
                timeout: 1200,
                level: 'success',
              }],
            },
          };
        }
        return {
          ok: true,
          result: {
            workspaceOpenRequests: [],
            modalSnapshots: [],
            menuSnapshots: [{
              id: 'quickadd-like:menu:1',
              pluginId: 'quickadd-like',
              source: 'mouse',
              interactionId: 'quickadd-menu-interaction-1',
              items: [
                { index: 0, title: 'Capture to inbox', icon: 'inbox', checked: false, disabled: false, separator: false, canRun: true },
                { index: 1, title: 'Pinned template', checked: true, disabled: false, separator: false, canRun: false },
                { index: 2, title: '', checked: false, disabled: true, separator: true, canRun: false },
                { index: 3, title: 'Disabled action', checked: false, disabled: true, separator: false, canRun: false },
              ],
            }],
          },
        };
      }
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    await act(async () => {
      root.render(<SearchModal open onClose={onClose} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const actionsTab = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Actions')) as HTMLButtonElement;

    await act(async () => {
      actionsTab.click();
      await Promise.resolve();
    });

    const commandButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('QuickAdd Like: Quick Capture')) as HTMLButtonElement;

    await act(async () => {
      commandButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith('Ran Quick Capture');
    expect(portalRoot().textContent).toContain('Plugin menu');
    expect(portalRoot().textContent).toContain('Capture to inbox');
    expect(portalRoot().textContent).toContain('inbox');
    expect(portalRoot().textContent).toContain('Pinned template');
    expect(portalRoot().textContent).toContain('Disabled action');
    expect(portalRoot().textContent).toContain('Disabled');
    const disabledActionButton = Array.from(portalRoot().querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Disabled action')) as HTMLButtonElement;
    expect(disabledActionButton.disabled).toBe(true);

    const captureButton = Array.from(portalRoot().querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Capture to inbox')) as HTMLButtonElement;

    await act(async () => {
      captureButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.toastSuccess).toHaveBeenCalledWith('Captured to inbox', 1200);
  });

  it('shows Obsidian commands in the desktop search panel when using command query', async () => {
    await act(async () => {
      root.render(<SearchPanel active />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, '>');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Plugin commands');
    expect(host.textContent).toContain('Quick Capture');
    expect(host.textContent).toContain('QuickAdd Like');
    expect(host.textContent).toContain('⌘⇧C');
    expect(host.textContent).toContain('Conflict');

    const commandButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Quick Capture')) as HTMLButtonElement;

    await act(async () => {
      commandButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.toastSuccess).toHaveBeenCalledWith('Ran Quick Capture');
  });

  it('does not mix plugin commands into normal desktop search queries', async () => {
    await act(async () => {
      root.render(<SearchPanel active />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, 'Quick Capture');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).not.toContain('Plugin commands');
    expect(host.textContent).not.toContain('QuickAdd Like');
  });

  it('shows plugin Notice feedback instead of a generic desktop command toast', async () => {
    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/plugins/surfaces?loadEnabled=1&kind=command') {
        return { ok: true, surfaces: [commandSurface] };
      }
      if (url.startsWith('/api/search')) {
        return [];
      }
      if (url === '/api/obsidian-plugins' && init?.method === 'POST') {
        return {
          ok: true,
          result: {
            workspaceOpenRequests: [],
            modalSnapshots: [],
            menuSnapshots: [],
            noticeSnapshots: [{
              id: 'quickadd-like:notice:1',
              pluginId: 'quickadd-like',
              message: 'Saved quick capture',
              timeout: 1500,
              level: 'success',
            }],
          },
        };
      }
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    await act(async () => {
      root.render(<SearchPanel active />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, '>');
      await Promise.resolve();
      await Promise.resolve();
    });

    const commandButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Quick Capture')) as HTMLButtonElement;

    await act(async () => {
      commandButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.toastSuccess).toHaveBeenCalledWith('Saved quick capture', 1500);
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith('Ran Quick Capture');
  });

  it('navigates when an Obsidian command requests a workspace file open', async () => {
    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/plugins/surfaces?loadEnabled=1&kind=command') {
        return { ok: true, surfaces: [commandSurface] };
      }
      if (url.startsWith('/api/search')) {
        return [];
      }
      if (url === '/api/obsidian-plugins' && init?.method === 'POST') {
        return {
          ok: true,
          result: {
            workspaceOpenRequests: [{
              linktext: 'notes/opened-from-command.md',
              sourcePath: '',
              targetPath: 'notes/opened-from-command.md',
            }],
          },
          plugins: [],
        };
      }
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    await act(async () => {
      root.render(<SearchPanel active />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, '>');
      await Promise.resolve();
      await Promise.resolve();
    });

    const commandButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Quick Capture')) as HTMLButtonElement;

    await act(async () => {
      commandButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushSmoothNavigation();
    expect(mocks.push).toHaveBeenCalledWith('/view/notes/opened-from-command.md');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Opened notes/opened-from-command.md');
  });

  it('shows a safe modal snapshot when a desktop plugin command opens an Obsidian modal', async () => {
    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/plugins/surfaces?loadEnabled=1&kind=command') {
        return { ok: true, surfaces: [commandSurface] };
      }
      if (url.startsWith('/api/search')) {
        return [];
      }
      if (url === '/api/obsidian-plugins' && init?.method === 'POST') {
        return {
          ok: true,
          result: {
            workspaceOpenRequests: [],
            modalSnapshots: [{
              id: 'quickadd-like:modal:2',
              pluginId: 'quickadd-like',
              kind: 'modal',
              title: 'Capture details',
              text: 'Write the note title before capture.',
            }],
          },
        };
      }
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    await act(async () => {
      root.render(<SearchPanel active />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, '>');
      await Promise.resolve();
      await Promise.resolve();
    });

    const commandButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Quick Capture')) as HTMLButtonElement;

    await act(async () => {
      commandButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.toastSuccess).not.toHaveBeenCalledWith('Ran Quick Capture');
    expect(portalRoot().textContent).toContain('Capture details');
    expect(portalRoot().textContent).toContain('Write the note title before capture.');
  });

  it('shows a safe menu snapshot when a desktop plugin command opens an Obsidian menu', async () => {
    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/plugins/surfaces?loadEnabled=1&kind=command') {
        return { ok: true, surfaces: [commandSurface] };
      }
      if (url.startsWith('/api/search')) {
        return [];
      }
      if (url === '/api/obsidian-plugins' && init?.method === 'POST') {
        return {
          ok: true,
          result: {
            workspaceOpenRequests: [],
            modalSnapshots: [],
            menuSnapshots: [{
              id: 'quickadd-like:menu:2',
              pluginId: 'quickadd-like',
              source: 'position',
              items: [
                { index: 0, title: 'Open capture menu', icon: 'sparkles', checked: false, disabled: false, separator: false },
                { index: 1, title: 'Use current note', checked: true, disabled: false, separator: false },
              ],
            }],
          },
        };
      }
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    await act(async () => {
      root.render(<SearchPanel active />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, '>');
      await Promise.resolve();
      await Promise.resolve();
    });

    const commandButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Quick Capture')) as HTMLButtonElement;

    await act(async () => {
      commandButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.toastSuccess).not.toHaveBeenCalledWith('Ran Quick Capture');
    expect(portalRoot().textContent).toContain('Plugin menu');
    expect(portalRoot().textContent).toContain('Position menu');
    expect(portalRoot().textContent).toContain('Open capture menu');
    expect(portalRoot().textContent).toContain('sparkles');
    expect(portalRoot().textContent).toContain('Use current note');
  });
});
