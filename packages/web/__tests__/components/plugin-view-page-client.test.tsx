// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PluginViewPageClient from '@/app/plugins/views/PluginViewPageClient';
import { PLUGINS_CHANGED_EVENT } from '@/lib/plugins/events';

const mocks = vi.hoisted(() => ({
  fetchPluginSurfaces: vi.fn(),
  fetchPluginView: vi.fn(),
  fetchPluginStylesheet: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/lib/plugins/client', () => ({
  fetchPluginSurfaces: mocks.fetchPluginSurfaces,
  fetchPluginView: mocks.fetchPluginView,
  fetchPluginStylesheet: mocks.fetchPluginStylesheet,
  pluginViewSurfaceHref: (surface: any, sourcePath?: string | null) => {
    if (surface.action?.type !== 'obsidian-view') return null;
    const params = new URLSearchParams({
      pluginId: surface.action.pluginId,
      viewType: surface.action.viewType,
    });
    if (sourcePath?.trim()) params.set('sourcePath', sourcePath.trim());
    return `/plugins/views?${params.toString()}`;
  },
}));

async function flushPluginViewPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('PluginViewPageClient', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('renders an Obsidian plugin view snapshot from the stable view host', async () => {
    mocks.fetchPluginView.mockResolvedValueOnce({
      pluginId: 'daily',
      viewType: 'daily-calendar',
      resolvedViewType: 'daily-calendar',
      displayText: 'Daily Calendar',
      className: 'DailyCalendarView',
      text: 'Calendar ready',
    });
    mocks.fetchPluginStylesheet.mockResolvedValueOnce({
      pluginId: 'daily',
      path: 'styles.css',
      bytes: 52,
      css: '.daily-card { color: red; }',
      scopedCss: '[data-obsidian-plugin-view="daily"] .daily-card { color: red; }',
      scopeSelector: '[data-obsidian-plugin-view="daily"]',
    });

    await act(async () => {
      root.render(<PluginViewPageClient pluginId="daily" viewType="daily-calendar" />);
      await flushPluginViewPromises();
    });

    expect(mocks.fetchPluginView).toHaveBeenCalledWith('daily', 'daily-calendar');
    expect(mocks.fetchPluginStylesheet).toHaveBeenCalledWith('daily');
    expect(host.textContent).toContain('Daily Calendar');
    expect(host.textContent).toContain('Snapshot host');
    expect(host.textContent).toContain('Compatibility host boundary');
    expect(host.textContent).toContain('Loaded from plugin host');
    expect(host.textContent).toContain('Scoped stylesheet active');
    expect(host.textContent).toContain('daily-calendar');
    expect(host.textContent).toContain('DailyCalendarView');
    expect(host.textContent).toContain('Calendar ready');
    expect(host.querySelector('[data-obsidian-plugin-view="daily"]')).toBeTruthy();
    const style = host.querySelector('style[data-obsidian-plugin-style="daily"]');
    expect(style?.textContent).toContain('[data-obsidian-plugin-view="daily"] .daily-card');
  });

  it('passes sourcePath to the view host and shows the active file context', async () => {
    mocks.fetchPluginView.mockResolvedValueOnce({
      pluginId: 'kanban',
      viewType: 'kanban-board',
      resolvedViewType: 'kanban-board',
      displayText: 'Kanban Board',
      className: 'KanbanView',
      text: 'Board ready',
      sourcePath: 'projects/roadmap.kanban',
      file: {
        path: 'projects/roadmap.kanban',
        name: 'roadmap.kanban',
        basename: 'roadmap',
        extension: 'kanban',
      },
    });
    mocks.fetchPluginStylesheet.mockRejectedValueOnce(new Error('Plugin stylesheet not found'));

    await act(async () => {
      root.render(
        <PluginViewPageClient
          pluginId="kanban"
          viewType="kanban-board"
          sourcePath="projects/roadmap.kanban"
        />,
      );
      await flushPluginViewPromises();
    });

    expect(mocks.fetchPluginView).toHaveBeenCalledWith('kanban', 'kanban-board', 'projects/roadmap.kanban');
    expect(mocks.fetchPluginStylesheet).toHaveBeenCalledWith('kanban');
    expect(host.textContent).toContain('Kanban Board');
    expect(host.textContent).toContain('Active file');
    expect(host.textContent).toContain('projects/roadmap.kanban');
    expect(host.textContent).toContain('No scoped stylesheet');
    expect(host.textContent).not.toContain('Could not open plugin view');
  });

  it('refreshes the snapshot when installed plugins change', async () => {
    mocks.fetchPluginView
      .mockResolvedValueOnce({
        pluginId: 'daily',
        viewType: 'daily-calendar',
        resolvedViewType: 'daily-calendar',
        displayText: 'Daily Calendar',
        className: 'DailyCalendarView',
        text: 'First snapshot',
      })
      .mockResolvedValueOnce({
        pluginId: 'daily',
        viewType: 'daily-calendar',
        resolvedViewType: 'daily-calendar',
        displayText: 'Daily Calendar',
        className: 'DailyCalendarView',
        text: 'Updated snapshot',
      });
    mocks.fetchPluginStylesheet.mockRejectedValue(new Error('Plugin stylesheet not found'));

    await act(async () => {
      root.render(<PluginViewPageClient pluginId="daily" viewType="daily-calendar" />);
      await flushPluginViewPromises();
    });

    expect(host.textContent).toContain('First snapshot');
    expect(mocks.fetchPluginView).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event(PLUGINS_CHANGED_EVENT));
      await flushPluginViewPromises();
    });

    expect(mocks.fetchPluginView).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('Updated snapshot');
    expect(host.textContent).toContain('Refreshed after plugin change');
  });

  it('lists available plugin views when opened without view parameters', async () => {
    mocks.fetchPluginSurfaces.mockResolvedValueOnce([
      {
        id: 'obsidian:view:daily:daily-calendar',
        source: 'obsidian',
        kind: 'view',
        location: 'plugin-views',
        availability: 'available',
        pluginId: 'daily',
        pluginName: 'Daily',
        title: 'Daily Calendar',
        host: { state: 'mounted', label: 'Plugin Views', description: 'Mounted view' },
        action: { type: 'obsidian-view', pluginId: 'daily', viewType: 'daily-calendar' },
      },
    ]);

    await act(async () => {
      root.render(<PluginViewPageClient pluginId="" viewType="" />);
      await flushPluginViewPromises();
    });

    expect(mocks.fetchPluginSurfaces).toHaveBeenCalledWith('kind=view&source=obsidian', { loadEnabled: true });
    expect(mocks.fetchPluginView).not.toHaveBeenCalled();
    expect(mocks.fetchPluginStylesheet).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Plugin views');
    expect(host.textContent).toContain('Available plugin views');
    expect(host.textContent).toContain('Daily Calendar');
    expect(host.textContent).toContain('Showing available plugin views');
    expect(Array.from(host.querySelectorAll('a')).some((link) => (
      link.getAttribute('href') === '/explore/plugins'
    ))).toBe(false);
    expect(Array.from(host.querySelectorAll('a')).some((link) => (
      link.getAttribute('href') === '/plugins/views?pluginId=daily&viewType=daily-calendar'
    ))).toBe(true);
  });

  it('links empty plugin views to the plugin market instead of the settings manager', async () => {
    mocks.fetchPluginSurfaces.mockResolvedValueOnce([]);

    await act(async () => {
      root.render(<PluginViewPageClient pluginId="" viewType="" />);
      await flushPluginViewPromises();
    });

    expect(host.textContent).toContain('No plugin views are available yet.');
    const links = Array.from(host.querySelectorAll('a')).map((link) => link.getAttribute('href'));
    expect(links).toContain('/explore/plugins');
    expect(links).not.toContain('/settings?tab=plugins&panel=community');
    expect(host.textContent).toContain('Open plugin market');
  });
});
