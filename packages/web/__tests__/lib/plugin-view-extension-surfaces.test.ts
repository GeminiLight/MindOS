import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchPluginViewSurfacesForExtension,
  normalizePluginViewExtension,
  pluginViewSurfaceMatchesExtension,
} from '@/lib/plugins/client';
import type { PluginSurface } from '@/lib/plugins/surfaces';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: mocks.apiFetch,
}));

function viewSurface(overrides: Partial<PluginSurface> = {}): PluginSurface {
  return {
    id: 'obsidian:view:kanban:kanban-board',
    source: 'obsidian',
    kind: 'view',
    location: 'plugin-views',
    availability: 'available',
    pluginId: 'kanban',
    pluginName: 'Kanban',
    title: 'kanban-board',
    host: {
      state: 'mounted',
      label: 'Plugin View host',
      description: 'Openable through a stable MindOS Plugin View host.',
    },
    action: {
      type: 'obsidian-view',
      pluginId: 'kanban',
      viewType: 'kanban-board',
    },
    metadata: {
      viewType: 'kanban-board',
      fileExtensions: ['kanban'],
    },
    ...overrides,
  };
}

describe('plugin view extension surfaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes file extensions to Obsidian-compatible keys', () => {
    expect(normalizePluginViewExtension('.KANBAN')).toBe('kanban');
    expect(normalizePluginViewExtension('..Canvas')).toBe('canvas');
    expect(normalizePluginViewExtension('   ')).toBe('');
  });

  it('matches only available Obsidian view surfaces with a registered action and file extension', () => {
    expect(pluginViewSurfaceMatchesExtension(viewSurface(), '.KANBAN')).toBe(true);
    expect(pluginViewSurfaceMatchesExtension(viewSurface({ availability: 'recorded' }), 'kanban')).toBe(false);
    expect(pluginViewSurfaceMatchesExtension(viewSurface({ metadata: { fileExtensions: ['kanban'], missingViewRegistration: true } }), 'kanban')).toBe(false);
    expect(pluginViewSurfaceMatchesExtension(viewSurface({ action: undefined }), 'kanban')).toBe(false);
    expect(pluginViewSurfaceMatchesExtension(viewSurface({ metadata: { fileExtensions: ['canvas'] } }), 'kanban')).toBe(false);
  });

  it('fetches and filters plugin view surfaces for a file extension', async () => {
    const matchingSurface = viewSurface();
    mocks.apiFetch.mockResolvedValueOnce({
      ok: true,
      surfaces: [
        matchingSurface,
        viewSurface({ id: 'obsidian:view:blocked', availability: 'blocked' }),
        viewSurface({ id: 'obsidian:view:missing', metadata: { fileExtensions: ['kanban'], missingViewRegistration: true } }),
        viewSurface({ id: 'obsidian:view:other', metadata: { fileExtensions: ['canvas'] } }),
      ],
    });

    await expect(fetchPluginViewSurfacesForExtension('.Kanban')).resolves.toEqual([matchingSurface]);
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/plugins/surfaces?kind=view&source=obsidian', {
      cache: 'no-store',
    });
  });

  it('does not call the surfaces API for an empty extension', async () => {
    await expect(fetchPluginViewSurfacesForExtension('...')).resolves.toEqual([]);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });
});
