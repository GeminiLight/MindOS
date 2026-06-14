// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PluginHotkeyHost from '@/components/plugins/PluginHotkeyHost';
import {
  OBSIDIAN_PLUGIN_HOTKEYS_CHANGED_EVENT,
  OBSIDIAN_PLUGIN_HOTKEYS_ENABLED_KEY,
} from '@/lib/plugins/client';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  openTab: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: mocks.apiFetch,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/view/notes/current.md',
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock('@/lib/toast', () => ({
  toast: Object.assign(mocks.toastInfo, {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  }),
}));

vi.mock('@/lib/workspace-tabs', () => ({
  openTab: mocks.openTab,
  resetWorkspaceTabsForTests: vi.fn(),
}));

const bindableCommandSurface = {
  id: 'obsidian:command:obsidian:quickadd:capture',
  source: 'obsidian',
  kind: 'command',
  location: 'command-center',
  availability: 'available',
  pluginId: 'quickadd',
  pluginName: 'QuickAdd',
  title: 'Capture',
  action: {
    type: 'obsidian-command',
    commandId: 'obsidian:quickadd:capture',
  },
  metadata: {
    hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'P' }],
    hotkeyPolicy: {
      binding: 'user-confirmable',
      status: 'ready',
      reason: 'User confirmed keymap required.',
      conflicts: [],
    },
    hotkeyConflicts: [],
  },
};

const conflictCommandSurface = {
  ...bindableCommandSurface,
  id: 'obsidian:command:obsidian:quickadd:search',
  title: 'Search capture',
  action: {
    type: 'obsidian-command',
    commandId: 'obsidian:quickadd:search',
  },
  metadata: {
    hotkeys: [{ modifiers: ['Mod'], key: 'K' }],
    hotkeyPolicy: {
      binding: 'display-only',
      status: 'conflict',
      reason: 'Conflicts with MindOS Search.',
      conflicts: [{
        label: 'Mod+K',
        owner: 'mindos-reserved',
        ownerLabel: 'MindOS Search',
      }],
    },
    hotkeyConflicts: [{
      label: 'Mod+K',
      owner: 'mindos-reserved',
      ownerLabel: 'MindOS Search',
    }],
  },
};

function setupApiFetch() {
  mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/plugins/surfaces?loadEnabled=1&kind=command&sourcePath=notes%2Fcurrent.md') {
      return { ok: true, surfaces: [bindableCommandSurface, conflictCommandSurface] };
    }
    if (url === '/api/obsidian-plugins' && init?.method === 'POST') {
      return {
        ok: true,
        result: {
          noticeSnapshots: [{
            id: 'quickadd:notice:1',
            pluginId: 'quickadd',
            message: 'Captured',
            timeout: 1000,
            level: 'success',
          }],
        },
      };
    }
    throw new Error(`Unexpected apiFetch call: ${url}`);
  });
}

describe('PluginHotkeyHost', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
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
    localStorage.clear();
  });

  it('does not fetch or run plugin hotkeys before the user enables them', async () => {
    await act(async () => {
      root.render(<PluginHotkeyHost />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'P',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }));
      await Promise.resolve();
    });

    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('runs a conflict-free Obsidian command hotkey after user confirmation', async () => {
    localStorage.setItem(OBSIDIAN_PLUGIN_HOTKEYS_ENABLED_KEY, '1');

    await act(async () => {
      root.render(<PluginHotkeyHost />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'P',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith(
      '/api/obsidian-plugins',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'execute-command',
          commandId: 'obsidian:quickadd:capture',
          editorContext: { sourcePath: 'notes/current.md' },
        }),
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Captured', 1000);
  });

  it('does not run hotkeys that are reported as conflicting', async () => {
    localStorage.setItem(OBSIDIAN_PLUGIN_HOTKEYS_ENABLED_KEY, '1');

    await act(async () => {
      root.render(<PluginHotkeyHost />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'K',
        metaKey: true,
        bubbles: true,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.apiFetch).not.toHaveBeenCalledWith(
      '/api/obsidian-plugins',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('refreshes the keymap when the settings toggle changes', async () => {
    await act(async () => {
      root.render(<PluginHotkeyHost />);
      await Promise.resolve();
    });

    await act(async () => {
      localStorage.setItem(OBSIDIAN_PLUGIN_HOTKEYS_ENABLED_KEY, '1');
      window.dispatchEvent(new Event(OBSIDIAN_PLUGIN_HOTKEYS_CHANGED_EVENT));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/plugins/surfaces?loadEnabled=1&kind=command&sourcePath=notes%2Fcurrent.md', {
      cache: 'no-store',
    });
  });
});
