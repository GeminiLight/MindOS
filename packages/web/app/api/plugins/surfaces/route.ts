export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import '@/lib/renderers/index';
import { handleRouteErrorSimple } from '@/lib/errors';
import { readSettings } from '@/lib/settings';
import { withObsidianPluginRuntime } from '@/lib/obsidian-compat/runtime-service';
import { getPluginRenderers, isRendererEnabled, toRendererPluginManifest } from '@/lib/renderers/registry';
import {
  buildObsidianPluginSurfaces,
  buildRendererPluginSurfaces,
  filterPluginSurfaces,
  type PluginSurfaceKind,
  type PluginSurfaceSource,
} from '@/lib/plugins/surfaces';

const SURFACE_KINDS = new Set<PluginSurfaceKind>([
  'command',
  'settings',
  'ribbon',
  'status',
  'view',
  'markdown',
  'style',
  'editor',
  'document-renderer',
]);

const SURFACE_SOURCES = new Set<PluginSurfaceSource>([
  'obsidian',
  'mindos-renderer',
  'mindos-native',
]);

function parseKind(value: string | null): PluginSurfaceKind | undefined {
  if (!value) return undefined;
  return SURFACE_KINDS.has(value as PluginSurfaceKind) ? value as PluginSurfaceKind : undefined;
}

function parseSource(value: string | null): PluginSurfaceSource | undefined {
  if (!value) return undefined;
  return SURFACE_SOURCES.has(value as PluginSurfaceSource) ? value as PluginSurfaceSource : undefined;
}

export async function GET(req: NextRequest) {
  try {
    const settings = readSettings();
    const loadEnabled = req.nextUrl.searchParams.get('loadEnabled') === '1';
    const kind = parseKind(req.nextUrl.searchParams.get('kind'));
    const source = parseSource(req.nextUrl.searchParams.get('source'));
    const sourcePath = req.nextUrl.searchParams.get('sourcePath')?.trim();

    return await withObsidianPluginRuntime(settings.mindRoot, async (manager) => {
      const result = loadEnabled ? await manager.loadEnabledPlugins() : undefined;
      const plugins = manager.list(sourcePath ? { editor: { sourcePath } } : undefined);
      const rendererSurfaces = buildRendererPluginSurfaces(
        getPluginRenderers().map((renderer) => ({
          id: renderer.id,
          name: renderer.name,
          description: renderer.description,
          author: renderer.author,
          icon: renderer.icon,
          tags: renderer.tags,
          builtin: renderer.builtin,
          manifest: toRendererPluginManifest(renderer),
          core: renderer.core,
          entryPath: renderer.entryPath,
          enabled: isRendererEnabled(renderer.id),
        })),
      );
      const surfaces = filterPluginSurfaces(
        [
          ...buildObsidianPluginSurfaces(plugins),
          ...rendererSurfaces,
        ],
        { kind, source },
      );

      return NextResponse.json({
        ok: true,
        result,
        surfaces,
        plugins,
        counts: {
          surfaces: surfaces.length,
          plugins: plugins.length,
          rendererPlugins: rendererSurfaces.length,
        },
      });
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
