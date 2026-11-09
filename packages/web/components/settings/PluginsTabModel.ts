import type { LucideIcon } from 'lucide-react';
import type { RendererDefinition } from '@/lib/renderers/registry';
import type {
  PluginCatalogBucket,
  PluginCatalogCounts,
  PluginCatalogItem,
} from '@/lib/plugins/catalog';
import type { SurfaceInventoryState } from './PluginSurfacesPanel';
import type { PluginsTabProps } from './types';

export type PluginsCopy = PluginsTabProps['t']['settings']['plugins'];

export interface PluginCatalogResponse {
  ok: boolean;
  plugins: PluginCatalogItem[];
  counts: PluginCatalogCounts;
}

export interface PluginSurfacesResponse {
  ok: boolean;
  surfaces: SurfaceInventoryState['surfaces'];
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
