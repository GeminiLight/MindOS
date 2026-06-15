// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PluginEntriesDock from '@/components/plugins/PluginEntriesDock';
import { PLUGIN_ENTRIES_OPEN_EVENT, PLUGIN_ENTRIES_STATE_EVENT, type PluginEntriesStateDetail } from '@/lib/plugins/ui-events';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  openSettings: vi.fn(),
  openCommandCenter: vi.fn(),
  push: vi.fn(),
  pathname: '/',
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: mocks.apiFetch,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => mocks.pathname,
}));

vi.mock('@/lib/toast', () => ({
  toast: Object.assign(mocks.toastInfo, {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  }),
}));

function portalRoot() {
  return document.body;
}

const flushSmoothNavigation = () => act(async () => {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
});

const ribbonSurface = {
  id: 'obsidian:ribbon:daily:0:capture',
  source: 'obsidian',
  kind: 'ribbon',
  location: 'plugin-actions',
  availability: 'available',
  pluginId: 'daily',
  pluginName: 'Daily Notes',
  title: 'Capture from ribbon',
  icon: 'sparkles',
  host: {
    state: 'mounted',
    label: 'Plugin Entries actions',
    description: 'Executable from Plugin Entries through the Obsidian compatibility lifecycle host.',
  },
  action: { type: 'obsidian-ribbon', pluginId: 'daily', ribbonIndex: 0 },
};

const statusSurface = {
  id: 'obsidian:status:daily:0',
  source: 'obsidian',
  kind: 'status',
  location: 'status-bar',
  availability: 'recorded',
  pluginId: 'daily',
  pluginName: 'Daily Notes',
  title: 'Daily ready',
  host: {
    state: 'mounted',
    label: 'Plugin Entries status',
    description: 'Mounted as a text snapshot in the Plugin Entries status section.',
  },
};

const commandSurface = {
  id: 'obsidian:command:obsidian:daily:capture',
  source: 'obsidian',
  kind: 'command',
  location: 'command-center',
  availability: 'available',
  pluginId: 'daily',
  pluginName: 'Daily Notes',
  title: 'Capture selection',
  host: {
    state: 'mounted',
    label: 'Command Center',
    description: 'Searchable and executable from MindOS command surfaces.',
  },
  action: { type: 'obsidian-command', commandId: 'obsidian:daily:capture' },
  metadata: {
    supportKind: 'limited',
    supportLabel: 'Limited',
    supportReason: 'Limited APIs are routed through safe MindOS hosts: registerMarkdownCodeBlockProcessor',
    importable: true,
    hotkeys: [{ modifiers: ['Mod'], key: 'k' }],
    hotkeyPolicy: {
      binding: 'display-only',
      status: 'conflict',
      reason: 'Obsidian default and imported hotkeys are shown for recognition but are not globally bound.',
      conflicts: [{
        label: '⌘K',
        owner: 'mindos-reserved',
        ownerLabel: 'MindOS Search',
      }],
    },
    hotkeyConflicts: [{
      label: '⌘K',
      owner: 'mindos-reserved',
      ownerLabel: 'MindOS Search',
    }],
  },
};

const viewSurface = {
  id: 'obsidian:view:daily:calendar',
  source: 'obsidian',
  kind: 'view',
  location: 'plugin-views',
  availability: 'available',
  pluginId: 'daily',
  pluginName: 'Daily Notes',
  title: 'daily-calendar',
  host: {
    state: 'mounted',
    label: 'Plugin View host',
    description: 'Openable through a stable MindOS Plugin View host without dynamically extending the main navigation.',
  },
  action: { type: 'obsidian-view', pluginId: 'daily', viewType: 'daily-calendar' },
  metadata: { viewType: 'daily-calendar', fileExtensions: ['daily', 'calendar'] },
};

const markdownSurface = {
  id: 'obsidian:markdown-code:daily:tasks',
  source: 'obsidian',
  kind: 'markdown',
  location: 'document',
  availability: 'available',
  pluginId: 'daily',
  pluginName: 'Daily Notes',
  title: '```tasks',
  host: {
    state: 'mounted',
    label: 'Document rendering host',
    description: 'Rendered as a sanitized text snapshot next to matching fenced code blocks.',
  },
  metadata: { language: 'tasks' },
};

const editorSurface = {
  id: 'obsidian:editor:daily',
  source: 'obsidian',
  kind: 'editor',
  location: 'editor',
  availability: 'recorded',
  pluginId: 'daily',
  pluginName: 'Daily Notes',
  title: 'Daily Notes editor extensions',
  host: {
    state: 'catalog',
    label: 'Editor capability gate',
    description: 'CodeMirror extensions are executable browser-side editor objects and cannot be safely mounted from the server plugin runtime.',
  },
  metadata: {
    count: 1,
    mountPolicy: 'catalog-only',
    capabilityGate: {
      capability: 'browser-editor-extension-host',
      status: 'required',
      autoEnable: false,
      reason: 'CodeMirror extensions are executable browser-side editor objects and cannot be safely mounted from the server plugin runtime.',
      nextStep: 'Mount only after a per-plugin editor sandbox, explicit permission gate, and unload cleanup path exist.',
    },
    editorExtensions: [{
      id: 'daily:editor:1',
      kind: 'object',
      valueType: 'object',
      constructorName: 'StateField',
      serializable: false,
      mountStatus: 'catalog-only',
      capabilityGate: 'browser-editor-extension-host',
      mountReason: 'CodeMirror extensions are browser-side executable objects.',
      autoMount: false,
    }],
  },
};

const styleSurface = {
  id: 'obsidian:style:daily:0:styles-css',
  source: 'obsidian',
  kind: 'style',
  location: 'plugin-assets',
  availability: 'available',
  pluginId: 'daily',
  pluginName: 'Daily Notes',
  title: 'Daily Notes stylesheet',
  host: {
    state: 'mounted',
    label: 'Scoped stylesheet host',
    description: 'Mounted only inside MindOS Plugin View host containers; global CSS injection remains disabled.',
  },
  metadata: {
    path: 'styles.css',
    bytes: 42,
    injectionPolicy: 'scoped-plugin-view',
    scope: 'plugin-view-host',
    globalInjection: false,
  },
};

const rendererSurface = {
  id: 'mindos-renderer:document-renderer:backlinks',
  source: 'mindos-renderer',
  kind: 'document-renderer',
  location: 'document',
  availability: 'available',
  pluginId: 'backlinks',
  pluginName: 'Backlinks Explorer',
  title: 'Backlinks Explorer',
  host: {
    state: 'mounted',
    label: 'Document renderer',
    description: 'Mounted in the document rendering pipeline.',
  },
};

describe('PluginEntriesDock', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = '/';
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('stays hidden when there are no Obsidian host surfaces', async () => {
    mocks.apiFetch.mockResolvedValueOnce({
      ok: true,
      surfaces: [
        rendererSurface,
        { ...commandSurface, source: 'obsidian', kind: 'settings', id: 'obsidian:settings:daily' },
      ],
    });

    await act(async () => {
      root.render(<PluginEntriesDock onOpenPluginsSettings={mocks.openSettings} onOpenCommandCenter={mocks.openCommandCenter} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="plugin-entries-dock"]')).toBeNull();
  });

  it('groups Obsidian plugin entry surfaces and routes commands to Command Center', async () => {
    const surfacesResponse = {
      ok: true,
      surfaces: [
        commandSurface,
        ribbonSurface,
        statusSurface,
        viewSurface,
        markdownSurface,
        styleSurface,
        editorSurface,
      ],
    };
    mocks.apiFetch
      .mockResolvedValueOnce(surfacesResponse)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(surfacesResponse);

    await act(async () => {
      root.render(<PluginEntriesDock onOpenPluginsSettings={mocks.openSettings} onOpenCommandCenter={mocks.openCommandCenter} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const statusButton = host.querySelector('[data-testid="plugin-entries-dock"]') as HTMLButtonElement;
    expect(statusButton).toBeTruthy();
    expect(host.textContent).toContain('Plugin Entries');
    expect(host.textContent).toContain('Daily Notes: Daily ready');
    expect(host.textContent).toContain('1 action');
    expect(host.textContent).toContain('1 command');
    expect(host.textContent).toContain('1 view');

    await act(async () => {
      statusButton.click();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="plugin-entries-popover"]')).toBeTruthy();
    expect(host.textContent).toContain('Use entries here; manage separately.');
    expect(host.textContent).toContain('6 mounted');
    expect(host.textContent).toContain('1 catalog');
    expect(host.textContent).toContain('Capture from ribbon');
    expect(host.textContent).toContain('Capture selection');
    expect(host.textContent).toContain('daily-calendar');
    expect(host.textContent).toContain('```tasks');
    expect(host.textContent).toContain('Daily Notes stylesheet');
    expect(host.textContent).toContain('Daily Notes editor extensions');
    expect(host.textContent).toContain('Mounted');
    expect(host.textContent).toContain('Catalog');
    expect(host.querySelector('[data-testid="plugin-surface-section-command"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="plugin-surface-section-view"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="plugin-surface-section-markdown"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="plugin-surface-section-style"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="plugin-surface-section-editor"]')).toBeTruthy();

    const commandButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Open Command Center for Capture selection') as HTMLButtonElement;

    await act(async () => {
      commandButton.click();
      await Promise.resolve();
    });

    expect(mocks.openCommandCenter).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Hotkey');
    expect(host.textContent).toContain('⌘K');
    expect(host.textContent).toContain('Hotkey binding');
    expect(host.textContent).toContain('Display only, conflict');
    expect(host.textContent).toContain('Hotkey conflicts');
    expect(host.textContent).toContain('MindOS Search');
    expect(host.textContent).toContain('Limited');
    expect(host.textContent).toContain('Support note');
    expect(host.textContent).toContain('Limited APIs are routed through safe MindOS hosts: registerMarkdownCodeBlockProcessor');

    const ribbonButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Inspect plugin entry Capture from ribbon') as HTMLButtonElement;

    await act(async () => {
      ribbonButton.click();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="plugin-surface-detail"]')).toBeTruthy();
    expect(host.textContent).toContain('Plugin Entries actions');

    const runActionButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Run action')) as HTMLButtonElement;

    await act(async () => {
      runActionButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/obsidian-plugins', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'execute-ribbon-action',
        pluginId: 'daily',
        ribbonIndex: 0,
      }),
    }));

    const viewButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Inspect plugin entry daily-calendar') as HTMLButtonElement;

    await act(async () => {
      viewButton.click();
      await Promise.resolve();
    });

    const openViewLink = Array.from(host.querySelectorAll('a'))
      .find((link) => link.textContent?.includes('Open view')) as HTMLAnchorElement;
    expect(openViewLink?.getAttribute('href')).toBe('/plugins/views?pluginId=daily&viewType=daily-calendar');
    expect(host.textContent).toContain('Plugin View host');
    expect(host.textContent).toContain('File extensions');
    expect(host.textContent).toContain('.daily, .calendar');

    const markdownButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Inspect plugin entry ```tasks') as HTMLButtonElement;

    await act(async () => {
      markdownButton.click();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="plugin-surface-detail"]')).toBeTruthy();
    expect(host.textContent).toContain('Document rendering host');
    expect(host.textContent).toContain('Code block');
    expect(host.textContent).toContain('tasks');

    const styleButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Inspect plugin entry Daily Notes stylesheet') as HTMLButtonElement;

    await act(async () => {
      styleButton.click();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="plugin-surface-detail"]')).toBeTruthy();
    expect(host.textContent).toContain('Scoped stylesheet host');
    expect(host.textContent).toContain('Stylesheet');
    expect(host.textContent).toContain('styles.css');
    expect(host.textContent).toContain('Injection');
    expect(host.textContent).toContain('Scoped to plugin view');

    const editorButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Inspect plugin entry Daily Notes editor extensions') as HTMLButtonElement;

    await act(async () => {
      editorButton.click();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="plugin-surface-detail"]')).toBeTruthy();
    expect(host.textContent).toContain('Editor capability gate');
    expect(host.textContent).toContain('Mount policy');
    expect(host.textContent).toContain('Catalog only');
    expect(host.textContent).toContain('Capability gate');
    expect(host.textContent).toContain('browser-editor-extension-host');
    expect(host.textContent).toContain('Auto mount');
    expect(host.textContent).toContain('Disabled');
    expect(host.textContent).toContain('Extension types');
    expect(host.textContent).toContain('StateField');
    expect(host.textContent).toContain('Serializable');
    expect(host.textContent).toContain('0/1');
    expect(host.textContent).toContain('Gate status');
    expect(host.textContent).toContain('1/1 catalog-only');

    const settingsButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Manage plugins in settings') as HTMLButtonElement;

    await act(async () => {
      settingsButton.click();
      await Promise.resolve();
    });

    expect(mocks.openSettings).toHaveBeenCalledTimes(1);
  });

  it('opens the same Plugin Entries surface from the mobile launcher', async () => {
    const surfacesResponse = {
      ok: true,
      surfaces: [
        ribbonSurface,
        statusSurface,
      ],
    };
    mocks.apiFetch.mockResolvedValueOnce(surfacesResponse);

    await act(async () => {
      root.render(<PluginEntriesDock onOpenPluginsSettings={mocks.openSettings} onOpenCommandCenter={mocks.openCommandCenter} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const mobileButton = host.querySelector('[data-testid="plugin-entries-mobile-button"]') as HTMLButtonElement;
    expect(mobileButton).toBeTruthy();
    expect(mobileButton.getAttribute('aria-label')).toBe('Open Plugin Entries');
    expect(mobileButton.textContent).toContain('2');

    await act(async () => {
      mobileButton.click();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="plugin-entries-mobile-sheet"]')).toBeTruthy();
    expect(host.textContent).toContain('Plugin Entries');
    expect(host.textContent).toContain('Capture from ribbon');
    expect(host.textContent).toContain('Daily ready');
  });

  it('preserves the active file context when opening a plugin view from a file route', async () => {
    mocks.pathname = '/view/projects/roadmap.kanban';
    const surfacesResponse = {
      ok: true,
      surfaces: [
        viewSurface,
        statusSurface,
      ],
    };
    mocks.apiFetch.mockResolvedValueOnce(surfacesResponse);

    await act(async () => {
      root.render(<PluginEntriesDock onOpenPluginsSettings={mocks.openSettings} onOpenCommandCenter={mocks.openCommandCenter} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const statusButton = host.querySelector('[data-testid="plugin-entries-dock"]') as HTMLButtonElement;
    await act(async () => {
      statusButton.click();
      await Promise.resolve();
    });

    const viewButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Inspect plugin entry daily-calendar') as HTMLButtonElement;

    await act(async () => {
      viewButton.click();
      await Promise.resolve();
    });

    const openViewLink = Array.from(host.querySelectorAll('a'))
      .find((link) => link.textContent?.includes('Open view')) as HTMLAnchorElement;
    expect(openViewLink?.getAttribute('href')).toBe(
      '/plugins/views?pluginId=daily&viewType=daily-calendar&sourcePath=projects%2Froadmap.kanban',
    );
  });

  it('opens the desktop entry tray when another surface requests Plugin Entries', async () => {
    const surfacesResponse = {
      ok: true,
      surfaces: [
        ribbonSurface,
        statusSurface,
      ],
    };
    mocks.apiFetch
      .mockResolvedValueOnce(surfacesResponse)
      .mockResolvedValueOnce(surfacesResponse);

    await act(async () => {
      root.render(<PluginEntriesDock onOpenPluginsSettings={mocks.openSettings} onOpenCommandCenter={mocks.openCommandCenter} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="plugin-entries-popover"]')).toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event(PLUGIN_ENTRIES_OPEN_EVENT));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="plugin-entries-popover"]')).toBeTruthy();
    expect(host.textContent).toContain('Capture from ribbon');
    expect(host.textContent).toContain('Daily ready');
  });

  it('publishes Plugin Entries availability for the rail action', async () => {
    const states: PluginEntriesStateDetail[] = [];
    const onState = (event: Event) => {
      states.push((event as CustomEvent<PluginEntriesStateDetail>).detail);
    };
    window.addEventListener(PLUGIN_ENTRIES_STATE_EVENT, onState);
    const surfacesResponse = {
      ok: true,
      surfaces: [
        ribbonSurface,
        statusSurface,
        styleSurface,
      ],
    };
    mocks.apiFetch.mockResolvedValueOnce(surfacesResponse);

    await act(async () => {
      root.render(<PluginEntriesDock onOpenPluginsSettings={mocks.openSettings} onOpenCommandCenter={mocks.openCommandCenter} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    window.removeEventListener(PLUGIN_ENTRIES_STATE_EVENT, onState);

    expect(states.at(-1)).toEqual({
      count: 3,
      mounted: 3,
      catalog: 0,
    });
  });

  it('keeps the Settings page clear until Plugin Entries is explicitly requested', async () => {
    mocks.pathname = '/settings';
    const surfacesResponse = {
      ok: true,
      surfaces: [
        ribbonSurface,
        statusSurface,
      ],
    };
    mocks.apiFetch
      .mockResolvedValueOnce(surfacesResponse)
      .mockResolvedValueOnce(surfacesResponse);

    await act(async () => {
      root.render(<PluginEntriesDock onOpenPluginsSettings={mocks.openSettings} onOpenCommandCenter={mocks.openCommandCenter} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="plugin-entries-dock"]')).toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event(PLUGIN_ENTRIES_OPEN_EVENT));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="plugin-entries-popover"]')).toBeTruthy();
    expect(host.textContent).toContain('Capture from ribbon');
  });

  it('navigates when a ribbon action requests a workspace file open', async () => {
    const surfacesResponse = {
      ok: true,
      surfaces: [
        ribbonSurface,
        statusSurface,
      ],
    };
    mocks.apiFetch
      .mockResolvedValueOnce(surfacesResponse)
      .mockResolvedValueOnce({
        ok: true,
        result: {
          workspaceOpenRequests: [{
            linktext: 'notes/from-ribbon.md',
            sourcePath: '',
            targetPath: 'notes/from-ribbon.md',
          }],
        },
      })
      .mockResolvedValueOnce(surfacesResponse);

    await act(async () => {
      root.render(<PluginEntriesDock onOpenPluginsSettings={mocks.openSettings} onOpenCommandCenter={mocks.openCommandCenter} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const statusButton = host.querySelector('[data-testid="plugin-entries-dock"]') as HTMLButtonElement;
    await act(async () => {
      statusButton.click();
      await Promise.resolve();
    });

    const ribbonButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Inspect plugin entry Capture from ribbon') as HTMLButtonElement;

    await act(async () => {
      ribbonButton.click();
      await Promise.resolve();
    });

    const runActionButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Run action')) as HTMLButtonElement;

    await act(async () => {
      runActionButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushSmoothNavigation();
    expect(mocks.push).toHaveBeenCalledWith('/view/notes/from-ribbon.md');
  });

  it('shows a safe modal snapshot when a ribbon action opens an Obsidian modal', async () => {
    const surfacesResponse = {
      ok: true,
      surfaces: [
        ribbonSurface,
        statusSurface,
      ],
    };
    mocks.apiFetch
      .mockResolvedValueOnce(surfacesResponse)
      .mockResolvedValueOnce({
        ok: true,
        result: {
          workspaceOpenRequests: [],
          modalSnapshots: [{
            id: 'daily:modal:1',
            pluginId: 'daily',
            kind: 'suggest',
            title: 'Daily capture',
            text: 'Choose where the captured text should go.',
            placeholder: 'Capture destination',
            interactionId: 'daily-modal-interaction-1',
            suggestions: [
              { index: 0, label: 'Today' },
              { index: 1, label: 'Inbox' },
            ],
          }],
        },
      })
      .mockResolvedValueOnce(surfacesResponse)
      .mockResolvedValueOnce({
        ok: true,
        result: {
          workspaceOpenRequests: [],
          modalSnapshots: [],
          menuSnapshots: [],
          noticeSnapshots: [{
            id: 'daily:notice:1',
            pluginId: 'daily',
            message: 'Saved to inbox',
            timeout: 1200,
            level: 'success',
          }],
        },
      })
      .mockResolvedValueOnce(surfacesResponse);

    await act(async () => {
      root.render(<PluginEntriesDock onOpenPluginsSettings={mocks.openSettings} onOpenCommandCenter={mocks.openCommandCenter} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const statusButton = host.querySelector('[data-testid="plugin-entries-dock"]') as HTMLButtonElement;
    await act(async () => {
      statusButton.click();
      await Promise.resolve();
    });

    const ribbonButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Inspect plugin entry Capture from ribbon') as HTMLButtonElement;

    await act(async () => {
      ribbonButton.click();
      await Promise.resolve();
    });

    const runActionButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Run action')) as HTMLButtonElement;

    await act(async () => {
      runActionButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="plugin-entries-popover"]')).toBeNull();
    expect(portalRoot().textContent).toContain('Daily capture');
    expect(portalRoot().textContent).toContain('Choose where the captured text should go.');
    expect(portalRoot().textContent).toContain('Capture destination');
    expect(portalRoot().textContent).toContain('Today');
    expect(portalRoot().textContent).toContain('Inbox');

    const inboxButton = Array.from(portalRoot().querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Inbox')) as HTMLButtonElement;

    await act(async () => {
      inboxButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/obsidian-plugins', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        action: 'choose-modal-suggestion',
        modalId: 'daily:modal:1',
        suggestionIndex: 1,
        interactionId: 'daily-modal-interaction-1',
      }),
    }));
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Saved to inbox', 1200);
  });

  it('shows a safe menu snapshot when a ribbon action opens an Obsidian menu', async () => {
    const surfacesResponse = {
      ok: true,
      surfaces: [
        ribbonSurface,
        statusSurface,
      ],
    };
    mocks.apiFetch
      .mockResolvedValueOnce(surfacesResponse)
      .mockResolvedValueOnce({
        ok: true,
        result: {
          workspaceOpenRequests: [],
          modalSnapshots: [],
          menuSnapshots: [{
            id: 'daily:menu:1',
            pluginId: 'daily',
            source: 'mouse',
            items: [
              { index: 0, title: 'Capture to today', icon: 'calendar', checked: false, disabled: false, separator: false },
              { index: 1, title: 'Pin to inbox', checked: true, disabled: false, separator: false },
              { index: 2, title: 'Archive capture', checked: false, disabled: true, separator: false },
            ],
          }],
        },
      })
      .mockResolvedValueOnce(surfacesResponse);

    await act(async () => {
      root.render(<PluginEntriesDock onOpenPluginsSettings={mocks.openSettings} onOpenCommandCenter={mocks.openCommandCenter} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const statusButton = host.querySelector('[data-testid="plugin-entries-dock"]') as HTMLButtonElement;
    await act(async () => {
      statusButton.click();
      await Promise.resolve();
    });

    const ribbonButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Inspect plugin entry Capture from ribbon') as HTMLButtonElement;

    await act(async () => {
      ribbonButton.click();
      await Promise.resolve();
    });

    const runActionButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Run action')) as HTMLButtonElement;

    await act(async () => {
      runActionButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="plugin-entries-popover"]')).toBeNull();
    expect(portalRoot().textContent).toContain('Plugin menu');
    expect(portalRoot().textContent).toContain('Capture to today');
    expect(portalRoot().textContent).toContain('calendar');
    expect(portalRoot().textContent).toContain('Pin to inbox');
    expect(portalRoot().textContent).toContain('Archive capture');
    expect(portalRoot().textContent).toContain('Disabled');
  });

  it('shows Notice feedback returned from a ribbon action', async () => {
    const surfacesResponse = {
      ok: true,
      surfaces: [
        ribbonSurface,
        statusSurface,
      ],
    };
    mocks.apiFetch
      .mockResolvedValueOnce(surfacesResponse)
      .mockResolvedValueOnce({
        ok: true,
        result: {
          workspaceOpenRequests: [],
          modalSnapshots: [],
          menuSnapshots: [],
          noticeSnapshots: [{
            id: 'daily:notice:1',
            pluginId: 'daily',
            message: 'Saved from plugin action',
            timeout: 1200,
            level: 'success',
          }],
        },
      })
      .mockResolvedValueOnce(surfacesResponse);

    await act(async () => {
      root.render(<PluginEntriesDock onOpenPluginsSettings={mocks.openSettings} onOpenCommandCenter={mocks.openCommandCenter} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const statusButton = host.querySelector('[data-testid="plugin-entries-dock"]') as HTMLButtonElement;
    await act(async () => {
      statusButton.click();
      await Promise.resolve();
    });

    const ribbonButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Inspect plugin entry Capture from ribbon') as HTMLButtonElement;

    await act(async () => {
      ribbonButton.click();
      await Promise.resolve();
    });

    const runActionButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Run action')) as HTMLButtonElement;

    await act(async () => {
      runActionButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.toastSuccess).toHaveBeenCalledWith('Saved from plugin action', 1200);
  });
});
