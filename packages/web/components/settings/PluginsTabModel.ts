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
import type { SurfaceInventoryState } from './PluginSurfacesPanel';
import type { PluginsTabProps } from './types';

export type PluginsCopy = PluginsTabProps['t']['settings']['plugins'];

export type PluginPanel = 'installed' | 'community' | 'import' | 'surfaces';

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
