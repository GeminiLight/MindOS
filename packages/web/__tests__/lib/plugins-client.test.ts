import { describe, expect, it } from 'vitest';
import {
  markdownSourcePathFromPathname,
  pluginEditorCommandContextForPathname,
  pluginViewSurfaceHref,
  sourcePathFromViewPathname,
} from '@/lib/plugins/client';
import type { PluginSurface } from '@/lib/plugins/surfaces';

describe('plugin client editor context helpers', () => {
  it('extracts Markdown source paths from file view routes', () => {
    expect(markdownSourcePathFromPathname('/view/notes/current.md')).toBe('notes/current.md');
    expect(markdownSourcePathFromPathname('/view/%E7%AC%94%E8%AE%B0/a%20b.md')).toBe('笔记/a b.md');
    expect(markdownSourcePathFromPathname('/view//notes/current.md')).toBe('notes/current.md');
  });

  it('extracts generic source paths from file view routes for plugin view contexts', () => {
    expect(sourcePathFromViewPathname('/view/projects/roadmap.kanban')).toBe('projects/roadmap.kanban');
    expect(sourcePathFromViewPathname('/view/%E9%A1%B9%E7%9B%AE/road%20map.canvas')).toBe('项目/road map.canvas');
    expect(sourcePathFromViewPathname('/view//projects/roadmap.kanban')).toBe('projects/roadmap.kanban');
    expect(sourcePathFromViewPathname('/settings/plugins')).toBeNull();
  });

  it('does not create editor context for non-Markdown or non-file routes', () => {
    expect(markdownSourcePathFromPathname('/view/notes/image.png')).toBeNull();
    expect(markdownSourcePathFromPathname('/settings/plugins')).toBeNull();
    expect(markdownSourcePathFromPathname(null)).toBeNull();
    expect(pluginEditorCommandContextForPathname('/view/notes/current.md')).toEqual({
      sourcePath: 'notes/current.md',
    });
  });

  it('builds plugin view hrefs with optional active file context', () => {
    const surface = {
      id: 'obsidian:view:kanban:kanban-board',
      source: 'obsidian',
      kind: 'view',
      location: 'plugin-views',
      availability: 'available',
      pluginId: 'kanban',
      pluginName: 'Kanban',
      title: 'Kanban Board',
      action: {
        type: 'obsidian-view',
        pluginId: 'kanban',
        viewType: 'kanban-board',
      },
    } as PluginSurface;

    expect(pluginViewSurfaceHref(surface)).toBe('/plugins/views?pluginId=kanban&viewType=kanban-board');
    expect(pluginViewSurfaceHref(surface, 'projects/roadmap.kanban')).toBe(
      '/plugins/views?pluginId=kanban&viewType=kanban-board&sourcePath=projects%2Froadmap.kanban',
    );
    expect(pluginViewSurfaceHref(surface, '项目/road map.kanban')).toBe(
      '/plugins/views?pluginId=kanban&viewType=kanban-board&sourcePath=%E9%A1%B9%E7%9B%AE%2Froad+map.kanban',
    );
  });
});
