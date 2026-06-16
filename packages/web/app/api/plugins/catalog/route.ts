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
} from '@/lib/plugins/surfaces';
import {
  PLUGIN_CATALOG_BUCKETS,
  PLUGIN_CATALOG_SOURCES,
  PLUGIN_CATALOG_STATUSES,
  buildPluginCatalog,
  filterPluginCatalog,
  summarizePluginCatalog,
  type PluginCatalogBucket,
  type PluginCatalogSource,
  type PluginCatalogStatus,
} from '@/lib/plugins/catalog';

function parseSource(value: string | null): PluginCatalogSource | undefined {
  if (!value) return undefined;
  return PLUGIN_CATALOG_SOURCES.includes(value as PluginCatalogSource) ? value as PluginCatalogSource : undefined;
}

function parseStatus(value: string | null): PluginCatalogStatus | undefined {
  if (!value) return undefined;
  return PLUGIN_CATALOG_STATUSES.includes(value as PluginCatalogStatus) ? value as PluginCatalogStatus : undefined;
}

function parseBucket(value: string | null): PluginCatalogBucket | undefined {
  if (!value) return undefined;
  return PLUGIN_CATALOG_BUCKETS.includes(value as PluginCatalogBucket) ? value as PluginCatalogBucket : undefined;
}

export async function GET(req: NextRequest) {
  try {
    const settings = readSettings();
    const loadEnabled = req.nextUrl.searchParams.get('loadEnabled') === '1';
    const source = parseSource(req.nextUrl.searchParams.get('source'));
    const status = parseStatus(req.nextUrl.searchParams.get('status'));
    const bucket = parseBucket(req.nextUrl.searchParams.get('bucket'));

    return await withObsidianPluginRuntime(settings.mindRoot, async (manager) => {
      const result = loadEnabled ? await manager.loadEnabledPlugins() : undefined;
      const obsidianPlugins = manager.list();
      const renderers = getPluginRenderers().map((renderer) => ({
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
      }));
      const rendererSurfaces = buildRendererPluginSurfaces(renderers);
      const surfaces = [
        ...buildObsidianPluginSurfaces(obsidianPlugins),
        ...rendererSurfaces,
      ];
      const allPlugins = buildPluginCatalog({
        obsidianPlugins,
        renderers,
        surfaces,
      });
      const plugins = filterPluginCatalog(allPlugins, { source, status, bucket });

      return NextResponse.json({
        ok: true,
        result,
        plugins,
        counts: summarizePluginCatalog(plugins),
      });
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
