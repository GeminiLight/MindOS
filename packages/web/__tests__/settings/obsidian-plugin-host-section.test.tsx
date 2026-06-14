// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ObsidianPluginHostSection } from '@/components/settings/ObsidianPluginHostSection';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: mocks.apiFetch,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
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

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function plugin(overrides: Record<string, unknown> = {}) {
  return {
    id: 'quickadd-like',
    name: 'QuickAdd Like',
    version: '1.0.0',
    enabled: false,
    loaded: false,
    compatibilityLevel: 'compatible',
    compatibility: {
      supportedApis: ['Plugin', 'addCommand'],
      partialApis: [],
      unsupportedApis: [],
      blockers: [],
    },
    runtime: {
      commands: 0,
      commandList: [],
      settingTabs: 0,
      markdownPostProcessors: 0,
      markdownCodeBlockProcessors: 0,
      views: 0,
      viewExtensions: 0,
      viewExtensionList: [],
      ribbonIcons: 0,
      statusBarItems: 0,
      styleSheets: 0,
      styleSheetList: [],
      editorExtensions: 0,
      warnings: [],
    },
    ...overrides,
  };
}

function runtime(overrides: Record<string, unknown> = {}) {
  return {
    commands: 0,
    commandList: [],
    settingTabs: 0,
    markdownPostProcessors: 0,
    markdownCodeBlockProcessors: 0,
    views: 0,
    viewExtensions: 0,
    viewExtensionList: [],
    ribbonIcons: 0,
    statusBarItems: 0,
    styleSheets: 0,
    styleSheetList: [],
    editorExtensions: 0,
    editorExtensionList: [],
    warnings: [],
    ...overrides,
  };
}

type SectionProps = React.ComponentProps<typeof ObsidianPluginHostSection>;

async function renderSection(props: SectionProps = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(<ObsidianPluginHostSection {...props} />);
    await Promise.resolve();
    await Promise.resolve();
  });

  return { host, root };
}

async function cleanup(root: Root, host: HTMLElement) {
  await act(async () => {
    root.unmount();
  });
  host.remove();
}

describe('ObsidianPluginHostSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads imported plugin status and enables a plugin through the lifecycle API', async () => {
    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/obsidian-plugins' && !init?.method) {
        return { ok: true, plugins: [plugin()] };
      }
      if (url === '/api/obsidian-plugins' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ action: 'enable', pluginId: 'quickadd-like' });
        return { ok: true, plugins: [plugin({ enabled: true })] };
      }
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    const { host, root } = await renderSection();

    expect(host.textContent).toContain('Obsidian plugin host');
    expect(host.textContent).toContain('QuickAdd Like');
    expect(host.textContent).toContain('1 imported');

    const toggle = host.querySelector('button[role="switch"]') as HTMLButtonElement;
    await act(async () => {
      toggle.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('1 enabled');
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);

    await cleanup(root, host);
  });

  it('shows loaded plugin commands and executes them from the expanded row', async () => {
    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/obsidian-plugins' && !init?.method) {
        return {
          ok: true,
          plugins: [
            plugin({
              enabled: true,
              loaded: true,
              runtime: runtime({
                commands: 1,
                commandList: [{ id: 'capture', fullId: 'obsidian:quickadd-like:capture', name: 'Quick Capture' }],
                settingTabs: 1,
                dataFile: { exists: true, bytes: 88, validJson: true },
                communityOrigin: {
                  source: 'obsidian-community',
                  repo: 'chhoumann/quickadd',
                  githubUrl: 'https://github.com/chhoumann/quickadd',
                  installedAt: '2026-06-14T00:00:00.000Z',
                  compatibilityLevel: 'compatible',
                  validJson: true,
                },
              }),
            }),
          ],
        };
      }
      if (url === '/api/obsidian-plugins' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({
          action: 'execute-command',
          commandId: 'obsidian:quickadd-like:capture',
        });
        return {
          ok: true,
          plugins: [
            plugin({
              enabled: true,
              loaded: true,
              runtime: runtime({
                commands: 1,
                commandList: [{ id: 'capture', fullId: 'obsidian:quickadd-like:capture', name: 'Quick Capture' }],
                settingTabs: 1,
              }),
            }),
          ],
        };
      }
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    const { host, root } = await renderSection();
    const row = host.querySelector('[data-obsidian-plugin-row="quickadd-like"]') as HTMLElement;
    const expandButton = row.querySelector('button') as HTMLButtonElement;

    await act(async () => {
      expandButton.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('1 command');
    expect(host.textContent).toContain('community source');
    expect(host.textContent).toContain('Source');
    expect(host.textContent).toContain('chhoumann/quickadd');
    expect(host.textContent).toContain('Storage');
    expect(host.textContent).toContain('data.json');
    expect(host.textContent).toContain('Quick Capture');

    const commandButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Quick Capture')) as HTMLButtonElement;

    await act(async () => {
      commandButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);

    await cleanup(root, host);
  });

  it('expands and marks a plugin row when the catalog focuses an imported plugin', async () => {
    const onFocusedPlugin = vi.fn();
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      plugins: [
        plugin({
          enabled: true,
          loaded: true,
          runtime: runtime({
            commands: 1,
            commandList: [{ id: 'capture', fullId: 'obsidian:quickadd-like:capture', name: 'Quick Capture' }],
          }),
        }),
      ],
    });

    const { host, root } = await renderSection({
      focusPluginId: 'quickadd-like',
      onFocusedPlugin,
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const row = host.querySelector('[data-obsidian-plugin-row="quickadd-like"]') as HTMLElement;
    expect(row?.dataset.obsidianPluginFocused).toBe('true');
    expect(host.textContent).toContain('Quick Capture');
    expect(onFocusedPlugin).toHaveBeenCalledWith('quickadd-like');

    await cleanup(root, host);
  });

  it('refreshes discovered plugins when the local plugin package set changes', async () => {
    let calls = 0;
    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/obsidian-plugins' && !init?.method) {
        calls += 1;
        return {
          ok: true,
          plugins: calls === 1 ? [] : [plugin({ id: 'quickadd', name: 'QuickAdd' })],
        };
      }
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    const { host, root } = await renderSection();

    expect(host.textContent).toContain('No imported Obsidian plugins found.');

    await act(async () => {
      window.dispatchEvent(new Event('mindos:obsidian-plugin-packages-changed'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('QuickAdd');
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);

    await cleanup(root, host);
  });

  it('uses import support language for limited and review imported plugins', async () => {
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      plugins: [
        plugin({
          id: 'kanban-like',
          name: 'Kanban Like',
          compatibilityLevel: 'partial',
          compatibility: {
            supportedApis: ['Plugin'],
            partialApis: ['registerMarkdownCodeBlockProcessor'],
            unsupportedApis: [],
            blockers: [],
          },
        }),
        plugin({
          id: 'review-like',
          name: 'Review Like',
          compatibilityLevel: 'partial',
          compatibility: {
            supportedApis: ['Plugin'],
            partialApis: ['registerView'],
            unsupportedApis: ['FileSystemAdapter'],
            blockers: [],
          },
        }),
      ],
    });

    const { host, root } = await renderSection();

    expect(host.textContent).toContain('Kanban Like');
    expect(host.textContent).toContain('Limited');
    expect(host.textContent).toContain('Limited APIs are routed through safe MindOS hosts: registerMarkdownCodeBlockProcessor');
    expect(host.textContent).toContain('Review Like');
    expect(host.textContent).toContain('Review');
    expect(host.textContent).toContain('Unsupported APIs need manual review: FileSystemAdapter');

    await cleanup(root, host);
  });

  it('handles command action results without replacing the load summary', async () => {
    const loadedPlugin = plugin({
      enabled: true,
      loaded: true,
      runtime: runtime({
        commands: 1,
        commandList: [{ id: 'capture', fullId: 'obsidian:quickadd-like:capture', name: 'Quick Capture' }],
      }),
    });

    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/obsidian-plugins' && !init?.method) {
        return { ok: true, plugins: [loadedPlugin] };
      }
      if (url === '/api/obsidian-plugins' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({
          action: 'execute-command',
          commandId: 'obsidian:quickadd-like:capture',
        });
        return {
          ok: true,
          result: {
            workspaceOpenRequests: [],
            modalSnapshots: [{
              id: 'quickadd-like:modal:1',
              pluginId: 'quickadd-like',
              kind: 'modal',
              title: 'Capture details',
              text: 'Confirm capture destination.',
            }],
            menuSnapshots: [],
            noticeSnapshots: [{
              id: 'quickadd-like:notice:1',
              pluginId: 'quickadd-like',
              message: 'Saved from settings command',
              timeout: 1300,
              level: 'success',
            }],
          },
          plugins: [loadedPlugin],
        };
      }
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    const { host, root } = await renderSection();
    const row = host.querySelector('[data-obsidian-plugin-row="quickadd-like"]') as HTMLElement;
    const expandButton = row.querySelector('button') as HTMLButtonElement;

    await act(async () => {
      expandButton.click();
      await Promise.resolve();
    });

    const commandButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Quick Capture')) as HTMLButtonElement;

    await act(async () => {
      commandButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.toastSuccess).toHaveBeenCalledWith('Saved from settings command', 1300);
    expect(portalRoot().textContent).toContain('Capture details');
    expect(portalRoot().textContent).toContain('Confirm capture destination.');
    expect(host.textContent).not.toContain('last load');

    await cleanup(root, host);
  });

  it('shows Obsidian view registrations as available Plugin View host routes', async () => {
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      plugins: [
        plugin({
          enabled: true,
          loaded: true,
          runtime: runtime({
            views: 1,
            viewList: [{ type: 'daily-calendar' }],
            viewExtensions: 1,
            viewExtensionList: [{ viewType: 'daily-calendar', extensions: ['daily', '.calendar'] }],
          }),
        }),
      ],
    });

    const { host, root } = await renderSection();
    const row = host.querySelector('[data-obsidian-plugin-row="quickadd-like"]') as HTMLElement;
    const expandButton = row.querySelector('button') as HTMLButtonElement;

    await act(async () => {
      expandButton.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('1 view');
    expect(host.textContent).toContain('1 view extension mapping');
    expect(host.textContent).toContain('Where it appears');
    expect(host.textContent).toContain('Mounted');
    expect(host.textContent).toContain('Views');
    expect(host.textContent).toContain('Plugin View host: daily-calendar (.calendar, .daily)');
    expect(host.textContent).toContain('Open view host');

    await cleanup(root, host);
  });

  it('routes usage cards to the mounted Plugin Entries, Command Center, and View hosts', async () => {
    const openPluginEntries = vi.fn();
    const openCommandCenter = vi.fn();
    const openPluginViews = vi.fn();

    mocks.apiFetch.mockResolvedValue({
      ok: true,
      plugins: [
        plugin({
          enabled: true,
          loaded: true,
          runtime: runtime({
            commands: 1,
            commandList: [{ id: 'capture', fullId: 'obsidian:quickadd-like:capture', name: 'Quick Capture' }],
            views: 1,
            viewList: [{ type: 'daily-calendar' }],
            ribbonIcons: 1,
            ribbonIconList: [{ icon: 'sparkles', title: 'Capture' }],
          }),
        }),
      ],
    });

    const { host, root } = await renderSection({
      onOpenPluginEntries: openPluginEntries,
      onOpenCommandCenter: openCommandCenter,
      onOpenPluginViews: openPluginViews,
    });
    const row = host.querySelector('[data-obsidian-plugin-row="quickadd-like"]') as HTMLElement;
    const expandButton = row.querySelector('button') as HTMLButtonElement;

    await act(async () => {
      expandButton.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Where it appears');
    expect(host.textContent).toContain('Open Command Center');
    expect(host.textContent).toContain('Open entries');
    expect(host.textContent).toContain('Open view host');

    const openCommandCenterButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Open Command Center')) as HTMLButtonElement;
    const openEntriesButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Open entries')) as HTMLButtonElement;
    const openViewHostButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Open view host')) as HTMLButtonElement;

    await act(async () => {
      openCommandCenterButton.click();
      openEntriesButton.click();
      openViewHostButton.click();
      await Promise.resolve();
    });

    expect(openCommandCenter).toHaveBeenCalledTimes(1);
    expect(openPluginEntries).toHaveBeenCalledTimes(1);
    expect(openPluginViews).toHaveBeenCalledTimes(1);

    await cleanup(root, host);
  });

  it('shows file extension mappings without a registered view as recorded routing diagnostics', async () => {
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      plugins: [
        plugin({
          enabled: true,
          loaded: true,
          runtime: runtime({
            viewExtensions: 1,
            viewExtensionList: [{ viewType: 'kanban-view', extensions: ['kanban', '.board'] }],
          }),
        }),
      ],
    });

    const { host, root } = await renderSection();
    const row = host.querySelector('[data-obsidian-plugin-row="quickadd-like"]') as HTMLElement;
    const expandButton = row.querySelector('button') as HTMLButtonElement;

    await act(async () => {
      expandButton.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('1 view extension mapping');
    expect(host.textContent).toContain('Where it appears');
    expect(host.textContent).toContain('View files');
    expect(host.textContent).toContain('Recorded mapping: .kanban, .board -> kanban-view');

    await cleanup(root, host);
  });

  it('shows markdown post processors as available document post-process snapshots', async () => {
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      plugins: [
        plugin({
          enabled: true,
          loaded: true,
          runtime: runtime({
            markdownPostProcessors: 1,
          }),
        }),
      ],
    });

    const { host, root } = await renderSection();
    const row = host.querySelector('[data-obsidian-plugin-row="quickadd-like"]') as HTMLElement;
    const expandButton = row.querySelector('button') as HTMLButtonElement;

    await act(async () => {
      expandButton.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Where it appears');
    expect(host.textContent).toContain('Markdown post');
    expect(host.textContent).toContain('Document post-process snapshots');

    await cleanup(root, host);
  });

  it('shows editor extension registrations as a catalog that requires an editor gate', async () => {
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      plugins: [
        plugin({
          enabled: true,
          loaded: true,
          runtime: runtime({
            editorExtensions: 1,
            editorExtensionList: [{
              id: 'quickadd-like:editor:1',
              kind: 'object',
              valueType: 'object',
              constructorName: 'StateField',
              serializable: false,
              mountStatus: 'catalog-only',
              capabilityGate: 'browser-editor-extension-host',
              mountReason: 'CodeMirror extensions are browser-side executable objects.',
              autoMount: false,
            }],
          }),
        }),
      ],
    });

    const { host, root } = await renderSection();
    const row = host.querySelector('[data-obsidian-plugin-row="quickadd-like"]') as HTMLElement;
    const expandButton = row.querySelector('button') as HTMLButtonElement;

    await act(async () => {
      expandButton.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('1 editor extension');
    expect(host.textContent).toContain('Where it appears');
    expect(host.textContent).toContain('Editor');
    expect(host.textContent).toContain('Extension catalog: StateField');
    expect(host.textContent).toContain('browser editor gate required');
    expect(host.textContent).toContain('1/1 catalog-only');

    await cleanup(root, host);
  });

  it('shows imported stylesheets as scoped plugin view assets', async () => {
    mocks.apiFetch.mockResolvedValue({
      ok: true,
      plugins: [
        plugin({
          enabled: true,
          loaded: true,
          runtime: runtime({
            styleSheets: 1,
            styleSheetList: [{ path: 'styles.css', bytes: 42 }],
          }),
        }),
      ],
    });

    const { host, root } = await renderSection();
    const row = host.querySelector('[data-obsidian-plugin-row="quickadd-like"]') as HTMLElement;
    const expandButton = row.querySelector('button') as HTMLButtonElement;

    await act(async () => {
      expandButton.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('1 stylesheet');
    expect(host.textContent).toContain('Where it appears');
    expect(host.textContent).toContain('Styles');
    expect(host.textContent).toContain('Scoped stylesheet host: styles.css');

    await cleanup(root, host);
  });

  it('loads settings and applies a setting value through the settings API', async () => {
    const loadedPlugin = plugin({
      enabled: true,
      loaded: true,
      runtime: runtime({ settingTabs: 1 }),
    });

    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/obsidian-plugins' && !init?.method) {
        return { ok: true, plugins: [loadedPlugin] };
      }
      if (url === '/api/obsidian-plugins/settings' && !init?.method) {
        return {
          ok: true,
          loadResult: { loaded: ['quickadd-like'], failed: [], skipped: [] },
          status: [loadedPlugin],
          plugins: [{
            id: 'quickadd-like',
            name: 'QuickAdd Like',
            version: '1.0.0',
            settingTabs: [{
              items: [{
                name: 'Capture enabled',
                desc: 'Allow quick capture commands',
                kind: 'toggle',
                value: true,
                disabled: false,
                canChange: true,
                canClick: false,
              }],
            }],
          }],
        };
      }
      if (url === '/api/obsidian-plugins/settings' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({
          action: 'set-value',
          pluginId: 'quickadd-like',
          tabIndex: 0,
          itemIndex: 0,
          value: false,
        });
        return {
          ok: true,
          loadResult: { loaded: ['quickadd-like'], failed: [], skipped: [] },
          status: [loadedPlugin],
          plugins: [{
            id: 'quickadd-like',
            name: 'QuickAdd Like',
            version: '1.0.0',
            settingTabs: [{
              items: [{
                name: 'Capture enabled',
                kind: 'toggle',
                value: false,
                disabled: false,
                canChange: true,
                canClick: false,
              }],
            }],
          }],
        };
      }
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    const { host, root } = await renderSection();
    const row = host.querySelector('[data-obsidian-plugin-row="quickadd-like"]') as HTMLElement;
    const expandButton = row.querySelector('button') as HTMLButtonElement;

    await act(async () => {
      expandButton.click();
      await Promise.resolve();
    });

    const loadSettingsButton = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Load settings')) as HTMLButtonElement;

    await act(async () => {
      loadSettingsButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Capture enabled');

    const switches = host.querySelectorAll('button[role="switch"]');
    const settingToggle = switches[1] as HTMLButtonElement;

    await act(async () => {
      settingToggle.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.apiFetch).toHaveBeenCalledTimes(3);

    await cleanup(root, host);
  });

  it('confirms before removing an imported plugin from the MindOS plugin host', async () => {
    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/obsidian-plugins' && !init?.method) {
        return { ok: true, plugins: [plugin({ enabled: true, loaded: true })] };
      }
      if (url === '/api/obsidian-plugins' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ action: 'uninstall', pluginId: 'quickadd-like' });
        return { ok: true, result: null, plugins: [] };
      }
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    const { host, root } = await renderSection();
    const removeButton = host.querySelector('button[aria-label="Remove imported plugin QuickAdd Like"]') as HTMLButtonElement;

    await act(async () => {
      removeButton.click();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Remove QuickAdd Like?');
    expect(host.textContent).toContain('The source Obsidian vault and its plugin files are not changed.');
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);

    const confirmButton = Array.from(host.querySelectorAll('button'))
      .filter((button) => button.textContent?.trim() === 'Remove')
      .at(-1) as HTMLButtonElement;

    await act(async () => {
      confirmButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain('QuickAdd Like');
    expect(host.textContent).toContain('No imported Obsidian plugins found.');

    await cleanup(root, host);
  });

  it('does not show the empty state when loading plugin status fails', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('Request timed out after 30s'));

    const { host, root } = await renderSection();

    expect(host.textContent).toContain('Request timed out after 30s');
    expect(host.textContent).toContain('Could not load imported Obsidian plugins.');
    expect(host.textContent).not.toContain('No imported Obsidian plugins found.');

    await cleanup(root, host);
  });
});
