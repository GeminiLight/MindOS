import type { LucideIcon } from 'lucide-react';
import type { RendererDefinition } from '@/lib/renderers/registry';
import type {
  PluginCatalogBucket,
  PluginCatalogCounts,
  PluginCatalogItem,
} from '@/lib/plugins/catalog';
import type {
  ObsidianCommunityCatalog,
  ObsidianCommunityCatalogItem,
  ObsidianCommunityPluginPreflight,
} from '@/lib/obsidian-compat/community-catalog';
import type { ObsidianCommunityUpdatePlan } from '@/lib/obsidian-compat/community-install';
import type { CommunityVersionState } from '@/lib/obsidian-compat/community-version';
import {
  buildObsidianCommunityPreflightSupport,
  buildObsidianCommunitySurfacePreview,
  type ObsidianCommunityPreflightSupport,
  type ObsidianCommunityPreflightSupportLevel,
  type ObsidianCommunitySurfacePreview,
  type ObsidianCommunitySurfacePreviewId,
  type ObsidianCommunitySurfacePreviewState,
} from '@/lib/obsidian-compat/community-support';
import type { SurfaceInventoryState } from './PluginSurfacesPanel';
import type { PluginPanel, PluginsTabProps } from './types';

export type PluginsCopy = PluginsTabProps['t']['settings']['plugins'];
export type CommunityPreflightSupportLevel = ObsidianCommunityPreflightSupportLevel;
export type CommunityPreflightSurfaceId = ObsidianCommunitySurfacePreviewId;
export type CommunityPreflightSurfaceState = ObsidianCommunitySurfacePreviewState;
export type CommunityPreflightSurfacePrediction = ObsidianCommunitySurfacePreview;

export interface PluginCatalogResponse {
  ok: boolean;
  plugins: PluginCatalogItem[];
  counts: PluginCatalogCounts;
}

export interface PluginSurfacesResponse {
  ok: boolean;
  surfaces: SurfaceInventoryState['surfaces'];
}

export interface ObsidianCommunityCatalogResponse {
  ok: boolean;
  catalog: ObsidianCommunityCatalog;
  skipped: Array<{ index: number; reason: string }>;
  cache?: {
    state: 'fresh' | 'refreshed' | 'stale';
    fetchedAt: string;
    ttlMs: number;
  };
}

export interface CommunityPreflightState {
  loading: boolean;
  result?: ObsidianCommunityPluginPreflight;
  error?: string;
}

export interface CommunityInstallState {
  loading: boolean;
  installedVersion?: string;
  error?: string;
}

export interface CommunityUpdatePlanState {
  loading: boolean;
  result?: ObsidianCommunityUpdatePlan;
  error?: string;
}

export interface CommunityUpdateState {
  loading: boolean;
  version?: string;
  error?: string;
}

export interface ObsidianCommunityInstallResponse {
  ok: true;
  plugin: ObsidianCommunityPluginPreflight['plugin'];
  installed: {
    pluginId: string;
    targetDir: string;
    enabled: false;
    loaded: false;
    source: 'obsidian-community';
  };
  preflight: ObsidianCommunityPluginPreflight;
}

export interface CatalogFilterOption {
  id: PluginCatalogBucket;
  label: string;
  description: string;
  count: number;
  icon: LucideIcon;
}

export function rendererMatchLabel(match: RendererDefinition['match']): string {
  return match.toString().match(/\/(.+)\//)?.[1] ?? '-';
}

export function catalogStatusClass(status: PluginCatalogItem['status']): string {
  if (status === 'blocked' || status === 'error') return 'border-error/25 bg-error/10 text-error';
  if (status === 'core' || status === 'loaded') return 'border-success/25 bg-success/10 text-success';
  if (status === 'enabled') return 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
  return 'border-border bg-muted text-muted-foreground';
}

export function communityStatusClass(status: ObsidianCommunityCatalogItem['installStatus']): string {
  if (status === 'blocked' || status === 'error') return 'border-error/25 bg-error/10 text-error';
  if (status === 'loaded') return 'border-success/25 bg-success/10 text-success';
  if (status === 'enabled') return 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
  if (status === 'disabled') return 'border-border bg-muted text-muted-foreground';
  return 'border-border bg-background text-muted-foreground';
}

export function communityPreflightClass(result: ObsidianCommunityPluginPreflight): string {
  if (!result.installable || result.compatibility.level === 'blocked') return 'border-error/25 bg-error/10 text-error';
  if (result.compatibility.level === 'partial') return 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
  return 'border-success/25 bg-success/10 text-success';
}

export function communityUpdateClass(
  result: ObsidianCommunityPluginPreflight,
  versionState: CommunityVersionState,
): string {
  if (!result.installable || result.compatibility.level === 'blocked') return 'border-error/25 bg-error/10 text-error';
  if (versionState === 'up-to-date') return 'border-success/25 bg-success/10 text-success';
  if (versionState === 'update-available' || versionState === 'local-newer') {
    return 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
  }
  return 'border-border bg-muted text-muted-foreground';
}

export function communityPreflightSupportClass(level: CommunityPreflightSupportLevel): string {
  if (level === 'blocked') return 'border-error/25 bg-error/10 text-error';
  if (level === 'ready') return 'border-success/25 bg-success/10 text-success';
  if (level === 'limited' || level === 'review') {
    return 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
  }
  return 'border-border bg-muted text-muted-foreground';
}

export function communityPreflightSurfaceClass(state: CommunityPreflightSurfaceState): string {
  if (state === 'mounted') return 'border-success/25 bg-success/10 text-success';
  if (state === 'limited') return 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
  if (state === 'catalog') return 'border-border bg-muted text-muted-foreground';
  return 'border-error/25 bg-error/10 text-error';
}

export function communityPreflightSupport(
  result: ObsidianCommunityPluginPreflight,
): ObsidianCommunityPreflightSupport {
  return result.support ?? buildObsidianCommunityPreflightSupport({
    compatibility: result.compatibility,
    installable: result.installable,
    installBlockedReasons: result.installBlockedReasons,
    stylesCss: result.package.assets.stylesCss,
  });
}

export function communityPreflightSupportLevel(
  result: ObsidianCommunityPluginPreflight,
): CommunityPreflightSupportLevel {
  return communityPreflightSupport(result).kind;
}

export function communityPreflightSurfaces(
  result: ObsidianCommunityPluginPreflight,
): CommunityPreflightSurfacePrediction[] {
  return result.surfacePreview ?? buildObsidianCommunitySurfacePreview({
    compatibility: result.compatibility,
    installable: result.installable,
    installBlockedReasons: result.installBlockedReasons,
    stylesCss: result.package.assets.stylesCss,
  });
}

export function applyCommunityInstallToCatalog(
  catalog: ObsidianCommunityCatalog | null,
  pluginId: string,
  preflight: ObsidianCommunityPluginPreflight,
): ObsidianCommunityCatalog | null {
  if (!catalog) return catalog;

  let changed = false;
  let installedDelta = 0;
  let blockedDelta = 0;
  let errorsDelta = 0;

  const plugins = catalog.plugins.map((plugin) => {
    if (plugin.id !== pluginId) return plugin;

    changed = true;
    if (!plugin.installed) installedDelta += 1;
    blockedDelta += communityProblemDelta(plugin.installStatus, 'disabled', 'blocked');
    errorsDelta += communityProblemDelta(plugin.installStatus, 'disabled', 'error');

    return {
      ...plugin,
      installed: true,
      installStatus: 'disabled' as const,
      installedVersion: preflight.package.manifest.version,
      installedEnabled: false,
      installedLoaded: false,
      installedLastError: undefined,
    };
  });

  if (!changed) return catalog;
  return {
    ...catalog,
    plugins,
    counts: {
      ...catalog.counts,
      installed: Math.max(0, catalog.counts.installed + installedDelta),
      blocked: Math.max(0, catalog.counts.blocked + blockedDelta),
      errors: Math.max(0, catalog.counts.errors + errorsDelta),
    },
  };
}

export function applyCommunityUpdateToCatalog(
  catalog: ObsidianCommunityCatalog | null,
  pluginId: string,
  version: string,
): ObsidianCommunityCatalog | null {
  if (!catalog) return catalog;

  let changed = false;
  let blockedDelta = 0;
  let errorsDelta = 0;

  const plugins = catalog.plugins.map((plugin) => {
    if (plugin.id !== pluginId) return plugin;

    changed = true;
    const nextStatus: ObsidianCommunityCatalogItem['installStatus'] = plugin.installedEnabled ? 'enabled' : 'disabled';
    blockedDelta += communityProblemDelta(plugin.installStatus, nextStatus, 'blocked');
    errorsDelta += communityProblemDelta(plugin.installStatus, nextStatus, 'error');

    return {
      ...plugin,
      installed: true,
      installedVersion: version,
      installedLoaded: false,
      installStatus: nextStatus,
      installedLastError: undefined,
    };
  });

  if (!changed) return catalog;
  return {
    ...catalog,
    plugins,
    counts: {
      ...catalog.counts,
      blocked: Math.max(0, catalog.counts.blocked + blockedDelta),
      errors: Math.max(0, catalog.counts.errors + errorsDelta),
    },
  };
}

function communityProblemDelta(
  previous: ObsidianCommunityCatalogItem['installStatus'],
  next: ObsidianCommunityCatalogItem['installStatus'],
  problemStatus: 'blocked' | 'error',
): number {
  const before = previous === problemStatus ? 1 : 0;
  const after = next === problemStatus ? 1 : 0;
  return after - before;
}
