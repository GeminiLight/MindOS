import { getObsidianImportSupport } from '@/lib/obsidian-compat/import-policy';
import type { CompatibilityLevel, PluginCompatibilityReport } from '@/lib/obsidian-compat/compatibility-report';
import type { PluginCommunityOriginSummary, PluginDataFileSummary } from '@/lib/obsidian-compat/plugin-manager';
import type { PluginManifest } from '@/lib/obsidian-compat/types';
import type { RendererPluginManifest } from '@/lib/renderers/registry';
import type { PluginSurface, PluginSurfaceAvailability, PluginSurfaceKind, PluginSurfaceSource } from './surfaces';

export type PluginCatalogSource = Extract<PluginSurfaceSource, 'obsidian' | 'mindos-renderer'>;

export type PluginCatalogStatus =
  | 'core'
  | 'enabled'
  | 'disabled'
  | 'loaded'
  | 'blocked'
  | 'error';

export const PLUGIN_CATALOG_SOURCES = ['obsidian', 'mindos-renderer'] as const satisfies readonly PluginCatalogSource[];
export const PLUGIN_CATALOG_STATUSES = [
  'core',
  'enabled',
  'disabled',
  'loaded',
  'blocked',
  'error',
] as const satisfies readonly PluginCatalogStatus[];
export const PLUGIN_CATALOG_BUCKETS = ['all', 'mindos', 'obsidian', 'disabled', 'problem'] as const;

export type PluginCatalogBucket = typeof PLUGIN_CATALOG_BUCKETS[number];

export interface PluginCatalogSurfaceSummary {
  total: number;
  available: number;
  recorded: number;
  blocked: number;
  disabled: number;
  byKind: Partial<Record<PluginSurfaceKind, number>>;
}

export interface PluginCatalogCompatibility {
  level: CompatibilityLevel;
  kind: ReturnType<typeof getObsidianImportSupport>['kind'];
  label: string;
  reason: string;
  blockers: string[];
}

export interface PluginCatalogItem {
  id: string;
  source: PluginCatalogSource;
  name: string;
  description?: string;
  version?: string;
  author?: string;
  icon?: string;
  tags: string[];
  manifest?: PluginManifest;
  builtin: boolean;
  core: boolean;
  enabled: boolean;
  loaded: boolean;
  status: PluginCatalogStatus;
  compatibility?: PluginCatalogCompatibility;
  lastError?: string;
  surfaces: PluginCatalogSurfaceSummary;
  metadata?: Record<string, unknown>;
}

export interface PluginCatalogCounts {
  total: number;
  enabled: number;
  disabled: number;
  loaded: number;
  blocked: number;
  errors: number;
  bySource: Record<PluginCatalogSource, number>;
  buckets: Record<PluginCatalogBucket, number>;
  surfaces: PluginCatalogSurfaceSummary;
}

export interface ObsidianPluginForCatalog {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  loaded: boolean;
  compatibilityLevel: CompatibilityLevel;
  compatibility: PluginCompatibilityReport;
  manifest?: PluginManifest;
  runtime?: {
    dataFile?: PluginDataFileSummary;
    communityOrigin?: PluginCommunityOriginSummary;
  };
  lastError?: string;
}

export interface RendererPluginForCatalog {
  id: string;
  name: string;
  description: string;
  author: string;
  icon: string;
  tags: string[];
  builtin: boolean;
  manifest: RendererPluginManifest;
  core?: boolean;
  entryPath?: string;
  enabled?: boolean;
}

export interface BuildPluginCatalogInput {
  obsidianPlugins: ObsidianPluginForCatalog[];
  renderers: RendererPluginForCatalog[];
  surfaces: PluginSurface[];
}

export interface PluginCatalogFilter {
  source?: PluginCatalogSource;
  status?: PluginCatalogStatus;
  bucket?: PluginCatalogBucket;
}

const EMPTY_SURFACE_SUMMARY: PluginCatalogSurfaceSummary = {
  total: 0,
  available: 0,
  recorded: 0,
  blocked: 0,
  disabled: 0,
  byKind: {},
};

export function buildPluginCatalog(input: BuildPluginCatalogInput): PluginCatalogItem[] {
  const items = [
    ...input.renderers.map((renderer) => rendererCatalogItem(renderer, input.surfaces)),
    ...input.obsidianPlugins.map((plugin) => obsidianCatalogItem(plugin, input.surfaces)),
  ];

  return items.sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.name.localeCompare(b.name);
  });
}

export function summarizePluginCatalog(items: PluginCatalogItem[]): PluginCatalogCounts {
  const allSurfaces = summarizeSurfaceSummaries(items.map((item) => item.surfaces));

  return {
    total: items.length,
    enabled: items.filter((item) => item.enabled).length,
    disabled: items.filter((item) => !item.enabled).length,
    loaded: items.filter((item) => item.loaded).length,
    blocked: items.filter((item) => item.status === 'blocked').length,
    errors: items.filter((item) => item.status === 'error').length,
    bySource: {
      obsidian: items.filter((item) => item.source === 'obsidian').length,
      'mindos-renderer': items.filter((item) => item.source === 'mindos-renderer').length,
    },
    buckets: {
      all: items.length,
      mindos: items.filter((item) => pluginCatalogBucketMatches('mindos', item)).length,
      obsidian: items.filter((item) => pluginCatalogBucketMatches('obsidian', item)).length,
      disabled: items.filter((item) => pluginCatalogBucketMatches('disabled', item)).length,
      problem: items.filter((item) => pluginCatalogBucketMatches('problem', item)).length,
    },
    surfaces: allSurfaces,
  };
}

export function filterPluginCatalog(items: PluginCatalogItem[], filter: PluginCatalogFilter): PluginCatalogItem[] {
  return items.filter((item) => (
    (!filter.source || item.source === filter.source)
    && (!filter.status || item.status === filter.status)
    && (!filter.bucket || pluginCatalogBucketMatches(filter.bucket, item))
  ));
}

export function pluginCatalogBucketMatches(bucket: PluginCatalogBucket, item: PluginCatalogItem): boolean {
  if (bucket === 'mindos') return item.source === 'mindos-renderer';
  if (bucket === 'obsidian') return item.source === 'obsidian';
  if (bucket === 'disabled') return item.status === 'disabled';
  if (bucket === 'problem') return item.status === 'blocked' || item.status === 'error';
  return true;
}

function rendererCatalogItem(renderer: RendererPluginForCatalog, surfaces: PluginSurface[]): PluginCatalogItem {
  const enabled = renderer.core === true || renderer.enabled !== false;

  return {
    id: renderer.id,
    source: 'mindos-renderer',
    name: renderer.name,
    description: renderer.description,
    version: renderer.manifest.version,
    author: renderer.manifest.author,
    icon: renderer.icon,
    tags: renderer.tags,
    manifest: renderer.manifest,
    builtin: renderer.builtin,
    core: renderer.core === true,
    enabled,
    loaded: enabled,
    status: renderer.core === true ? 'core' : enabled ? 'enabled' : 'disabled',
    surfaces: summarizePluginSurfaces(surfaces, 'mindos-renderer', renderer.id),
    metadata: {
      entryPath: renderer.entryPath,
      manifest: renderer.manifest,
    },
  };
}

function obsidianCatalogItem(plugin: ObsidianPluginForCatalog, surfaces: PluginSurface[]): PluginCatalogItem {
  const support = getObsidianImportSupport(plugin);
  const blocked = plugin.compatibilityLevel === 'blocked';
  const hasError = Boolean(plugin.lastError);

  return {
    id: plugin.id,
    source: 'obsidian',
    name: plugin.name,
    description: plugin.manifest?.description,
    version: plugin.manifest?.version ?? plugin.version,
    author: plugin.manifest?.author,
    tags: [],
    manifest: plugin.manifest,
    builtin: false,
    core: false,
    enabled: plugin.enabled,
    loaded: plugin.loaded,
    status: blocked ? 'blocked' : hasError ? 'error' : plugin.loaded ? 'loaded' : plugin.enabled ? 'enabled' : 'disabled',
    compatibility: {
      level: plugin.compatibilityLevel,
      kind: support.kind,
      label: support.label,
      reason: support.reason,
      blockers: plugin.compatibility.blockers,
    },
    lastError: plugin.lastError,
    surfaces: summarizePluginSurfaces(surfaces, 'obsidian', plugin.id),
    metadata: {
      supportedApis: plugin.compatibility.supportedApis,
      partialApis: plugin.compatibility.partialApis,
      unsupportedApis: plugin.compatibility.unsupportedApis,
      moduleImports: plugin.compatibility.moduleImports,
      nodeModules: plugin.compatibility.nodeModules,
      unsupportedModules: plugin.compatibility.unsupportedModules,
      ...(plugin.manifest ? { manifest: plugin.manifest } : {}),
      dataFile: plugin.runtime?.dataFile ?? { exists: false, bytes: 0 },
      ...(plugin.runtime?.communityOrigin ? { communityOrigin: plugin.runtime.communityOrigin } : {}),
    },
  };
}

function summarizePluginSurfaces(
  surfaces: PluginSurface[],
  source: PluginCatalogSource,
  pluginId: string,
): PluginCatalogSurfaceSummary {
  return summarizeSurfaces(surfaces.filter((surface) => surface.source === source && surface.pluginId === pluginId));
}

function summarizeSurfaces(surfaces: PluginSurface[]): PluginCatalogSurfaceSummary {
  const summary: PluginCatalogSurfaceSummary = { ...EMPTY_SURFACE_SUMMARY, byKind: {} };
  for (const surface of surfaces) {
    summary.total += 1;
    incrementAvailability(summary, surface.availability);
    summary.byKind[surface.kind] = (summary.byKind[surface.kind] ?? 0) + 1;
  }
  return summary;
}

function summarizeSurfaceSummaries(summaries: PluginCatalogSurfaceSummary[]): PluginCatalogSurfaceSummary {
  const result: PluginCatalogSurfaceSummary = { ...EMPTY_SURFACE_SUMMARY, byKind: {} };
  for (const summary of summaries) {
    result.total += summary.total;
    result.available += summary.available;
    result.recorded += summary.recorded;
    result.blocked += summary.blocked;
    result.disabled += summary.disabled;
    for (const [kind, count] of Object.entries(summary.byKind) as Array<[PluginSurfaceKind, number]>) {
      result.byKind[kind] = (result.byKind[kind] ?? 0) + count;
    }
  }
  return result;
}

function incrementAvailability(summary: PluginCatalogSurfaceSummary, availability: PluginSurfaceAvailability): void {
  if (availability === 'available') {
    summary.available += 1;
  } else if (availability === 'recorded') {
    summary.recorded += 1;
  } else if (availability === 'blocked') {
    summary.blocked += 1;
  } else {
    summary.disabled += 1;
  }
}
