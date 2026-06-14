'use client';

import { useMemo } from 'react';
import {
  ExternalLink,
  ListChecks,
  PanelRightOpen,
  RefreshCw,
  Search,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import {
  pluginCommandHotkeyBindableCount,
  pluginCommandHotkeyCount,
} from '@/lib/plugins/client';
import type {
  PluginSurface,
  PluginSurfaceAvailability,
  PluginSurfaceHostState,
  PluginSurfaceKind,
} from '@/lib/plugins/surfaces';
import { Toggle } from './Primitives';
import type { PluginsTabProps } from './types';

type PluginsCopy = PluginsTabProps['t']['settings']['plugins'];

export interface SurfaceInventoryState {
  loading: boolean;
  loaded: boolean;
  surfaces: PluginSurface[];
  error?: string;
}

interface SurfaceAction {
  title: string;
  description: string;
  icon: LucideIcon;
  onClick?: () => void;
  disabled?: boolean;
}

interface PluginSurfacesPanelProps {
  copy: PluginsCopy;
  surfaceInventory: SurfaceInventoryState;
  onRefreshSurfaceInventory: () => void | Promise<void>;
  obsidianHotkeysEnabled: boolean;
  onObsidianHotkeysEnabledChange: (enabled: boolean) => void;
  onOpenPluginEntries?: () => void;
  onOpenCommandCenter?: () => void;
  onOpenPluginViews?: () => void;
}

const SURFACE_KIND_ORDER: PluginSurfaceKind[] = [
  'command',
  'ribbon',
  'status',
  'view',
  'markdown',
  'style',
  'editor',
  'settings',
  'document-renderer',
];

function surfaceStateClass(state: PluginSurfaceHostState | PluginSurfaceAvailability): string {
  if (state === 'mounted' || state === 'available') return 'border-success/25 bg-success/10 text-success';
  if (state === 'catalog' || state === 'recorded') return 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
  if (state === 'blocked') return 'border-error/25 bg-error/10 text-error';
  return 'border-border bg-muted text-muted-foreground';
}

function useSurfaceInventorySummary(surfaces: PluginSurface[]) {
  return useMemo(() => {
    const initialByKind = new Map<PluginSurfaceKind, {
      kind: PluginSurfaceKind;
      total: number;
      mounted: number;
      catalog: number;
      diagnostic: number;
      available: number;
      recorded: number;
      blocked: number;
      disabled: number;
    }>();
    const ensureKind = (kind: PluginSurfaceKind) => {
      const existing = initialByKind.get(kind);
      if (existing) return existing;
      const created = {
        kind,
        total: 0,
        mounted: 0,
        catalog: 0,
        diagnostic: 0,
        available: 0,
        recorded: 0,
        blocked: 0,
        disabled: 0,
      };
      initialByKind.set(kind, created);
      return created;
    };
    const summary = {
      total: surfaces.length,
      mounted: 0,
      catalog: 0,
      diagnostic: 0,
      available: 0,
      recorded: 0,
      blocked: 0,
      disabled: 0,
      byKind: [] as Array<ReturnType<typeof ensureKind>>,
    };

    for (const surface of surfaces) {
      if (surface.host.state === 'mounted') summary.mounted += 1;
      if (surface.host.state === 'catalog') summary.catalog += 1;
      if (surface.host.state === 'diagnostic') summary.diagnostic += 1;
      if (surface.availability === 'available') summary.available += 1;
      if (surface.availability === 'recorded') summary.recorded += 1;
      if (surface.availability === 'blocked') summary.blocked += 1;
      if (surface.availability === 'disabled') summary.disabled += 1;

      const byKind = ensureKind(surface.kind);
      byKind.total += 1;
      if (surface.host.state === 'mounted') byKind.mounted += 1;
      if (surface.host.state === 'catalog') byKind.catalog += 1;
      if (surface.host.state === 'diagnostic') byKind.diagnostic += 1;
      if (surface.availability === 'available') byKind.available += 1;
      if (surface.availability === 'recorded') byKind.recorded += 1;
      if (surface.availability === 'blocked') byKind.blocked += 1;
      if (surface.availability === 'disabled') byKind.disabled += 1;
    }

    summary.byKind = Array.from(initialByKind.values()).sort((a, b) => {
      const orderA = SURFACE_KIND_ORDER.indexOf(a.kind);
      const orderB = SURFACE_KIND_ORDER.indexOf(b.kind);
      return (orderA === -1 ? 999 : orderA) - (orderB === -1 ? 999 : orderB);
    });
    return summary;
  }, [surfaces]);
}

function useSurfaceHotkeySummary(surfaces: PluginSurface[]) {
  return useMemo(() => {
    let total = 0;
    let bindable = 0;
    for (const surface of surfaces) {
      if (surface.kind !== 'command') continue;
      total += pluginCommandHotkeyCount(surface);
      bindable += pluginCommandHotkeyBindableCount(surface);
    }
    return {
      total,
      bindable,
      blocked: Math.max(0, total - bindable),
    };
  }, [surfaces]);
}

function useEditorGateSummary(surfaces: PluginSurface[]) {
  return useMemo(() => {
    const pluginIds = new Set<string>();
    let extensions = 0;
    let catalogOnly = 0;
    let serializable = 0;

    for (const surface of surfaces) {
      if (surface.kind !== 'editor') continue;
      pluginIds.add(surface.pluginId);
      const editorExtensions = Array.isArray(surface.metadata?.editorExtensions)
        ? surface.metadata.editorExtensions.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
        : [];
      const surfaceCount = typeof surface.metadata?.count === 'number'
        ? surface.metadata.count
        : Math.max(editorExtensions.length, 1);
      extensions += surfaceCount;

      if (editorExtensions.length > 0) {
        catalogOnly += editorExtensions.filter((extension) => extension.mountStatus === 'catalog-only').length;
        serializable += editorExtensions.filter((extension) => extension.serializable === true).length;
      } else if (surface.metadata?.mountPolicy === 'catalog-only' || surface.host.state === 'catalog') {
        catalogOnly += surfaceCount;
      }
    }

    return {
      plugins: pluginIds.size,
      extensions,
      catalogOnly,
      serializable,
    };
  }, [surfaces]);
}

export function PluginSurfacesPanel({
  copy,
  surfaceInventory,
  onRefreshSurfaceInventory,
  obsidianHotkeysEnabled,
  onObsidianHotkeysEnabledChange,
  onOpenPluginEntries,
  onOpenCommandCenter,
  onOpenPluginViews,
}: PluginSurfacesPanelProps) {
  const surfaceInventorySummary = useSurfaceInventorySummary(surfaceInventory.surfaces);
  const surfaceHotkeySummary = useSurfaceHotkeySummary(surfaceInventory.surfaces);
  const editorGateSummary = useEditorGateSummary(surfaceInventory.surfaces);
  const surfaceActions: SurfaceAction[] = [
    {
      title: copy.commandCenterTitle,
      description: copy.commandCenterDesc,
      icon: Search,
      onClick: onOpenCommandCenter,
    },
    {
      title: copy.pluginEntriesTitle,
      description: copy.pluginEntriesDesc,
      icon: ListChecks,
      onClick: onOpenPluginEntries,
    },
    {
      title: copy.pluginViewsTitle,
      description: copy.pluginViewsDesc,
      icon: PanelRightOpen,
      onClick: onOpenPluginViews,
    },
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{copy.surfacesTitle}</h3>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-muted-foreground">{copy.surfacesDesc}</p>
        </div>
        <button
          type="button"
          onClick={() => void onRefreshSurfaceInventory()}
          disabled={surfaceInventory.loading}
          className="inline-flex h-8 w-fit shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RefreshCw size={12} className={surfaceInventory.loading ? 'animate-spin' : ''} />
          {copy.surfaceInventoryRefresh}
        </button>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card/55 p-4">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-background/60 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
              obsidianHotkeysEnabled
                ? 'border-success/25 bg-success/10 text-success'
                : 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]'
            }`}>
              <ShieldCheck size={15} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{copy.hotkeyBindingTitle}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{copy.hotkeyBindingDesc}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded border border-success/25 bg-success/10 px-1.5 py-0.5 font-mono text-2xs text-success">
                  {copy.hotkeyBindingBindableMetric} {surfaceHotkeySummary.bindable}
                </span>
                <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                  {copy.hotkeyBindingTotalMetric} {surfaceHotkeySummary.total}
                </span>
                <span className="rounded border border-[var(--amber)]/25 bg-[var(--amber-subtle)] px-1.5 py-0.5 font-mono text-2xs text-[var(--amber-text)]">
                  {copy.hotkeyBindingBlockedMetric} {surfaceHotkeySummary.blocked}
                </span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
            <span className={`text-xs font-medium ${obsidianHotkeysEnabled ? 'text-success' : 'text-muted-foreground'}`}>
              {obsidianHotkeysEnabled ? copy.hotkeyBindingEnabled : copy.hotkeyBindingDisabled}
            </span>
            <Toggle checked={obsidianHotkeysEnabled} onChange={onObsidianHotkeysEnabledChange} />
          </div>
        </div>

        {editorGateSummary.extensions > 0 && (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-background/60 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]">
                <ShieldCheck size={15} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{copy.editorGateTitle}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{copy.editorGateDesc}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded border border-[var(--amber)]/25 bg-[var(--amber-subtle)] px-1.5 py-0.5 font-mono text-2xs text-[var(--amber-text)]">
                    {copy.editorGateCatalogMetric} {editorGateSummary.catalogOnly}
                  </span>
                  <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                    {copy.editorGateExtensionsMetric} {editorGateSummary.extensions}
                  </span>
                  <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                    {copy.editorGatePluginsMetric} {editorGateSummary.plugins}
                  </span>
                  <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                    {copy.editorGateSerializableMetric} {editorGateSummary.serializable}
                  </span>
                </div>
              </div>
            </div>
            <span className="w-fit shrink-0 rounded-md border border-[var(--amber)]/25 bg-[var(--amber-subtle)] px-2 py-1 text-xs font-medium text-[var(--amber-text)]">
              {copy.editorGateStatus}
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-foreground">{copy.surfaceInventoryTitle}</p>
            <p className="mt-0.5 text-2xs text-muted-foreground">{copy.surfaceInventoryDesc}</p>
          </div>
          {surfaceInventory.loading && (
            <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
              <RefreshCw size={11} className="animate-spin" />
              {copy.surfaceInventoryLoading}
            </span>
          )}
        </div>

        {surfaceInventory.error && (
          <div className="rounded-lg border border-error/25 bg-error/10 px-3 py-2 text-xs text-error">
            {copy.surfaceInventoryLoadFailed}: {surfaceInventory.error}
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-5">
          {[
            { label: copy.surfaceInventoryTotalMetric, value: surfaceInventorySummary.total, state: 'catalog' as const },
            { label: copy.surfaceInventoryMountedMetric, value: surfaceInventorySummary.mounted, state: 'mounted' as const },
            { label: copy.surfaceInventoryCatalogMetric, value: surfaceInventorySummary.catalog, state: 'catalog' as const },
            { label: copy.surfaceInventoryRecordedMetric, value: surfaceInventorySummary.recorded, state: 'recorded' as const },
            { label: copy.surfaceInventoryBlockedMetric, value: surfaceInventorySummary.blocked + surfaceInventorySummary.disabled, state: 'blocked' as const },
          ].map((metric) => (
            <div key={metric.label} className={`rounded-lg border px-3 py-2 ${surfaceStateClass(metric.state)}`}>
              <p className="text-2xs font-medium uppercase opacity-80">{metric.label}</p>
              <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{metric.value}</p>
            </div>
          ))}
        </div>

        {surfaceInventory.loaded && surfaceInventorySummary.total === 0 && !surfaceInventory.error ? (
          <div className="rounded-lg border border-border bg-background/60 px-3 py-4 text-center text-xs text-muted-foreground">
            {copy.surfaceInventoryEmpty}
          </div>
        ) : (
          surfaceInventorySummary.byKind.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border bg-background/60">
              <div className="border-b border-border/70 px-3 py-2">
                <p className="text-2xs font-medium uppercase text-muted-foreground">{copy.surfaceInventoryByKindTitle}</p>
              </div>
              <div>
                {surfaceInventorySummary.byKind.map((item, index) => (
                  <div
                    key={item.kind}
                    className={`flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between ${
                      index === 0 ? '' : 'border-t border-border/70'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{copy.surfaceKindLabel(item.kind)}</p>
                      <p className="mt-0.5 text-2xs text-muted-foreground">
                        {copy.surfaceInventoryKindSummary(item.total, item.mounted, item.catalog, item.recorded)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${surfaceStateClass('mounted')}`}>
                        {copy.surfaceInventoryMountedMetric} {item.mounted}
                      </span>
                      <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${surfaceStateClass('catalog')}`}>
                        {copy.surfaceInventoryCatalogMetric} {item.catalog}
                      </span>
                      <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${surfaceStateClass('recorded')}`}>
                        {copy.surfaceInventoryRecordedMetric} {item.recorded}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card/55">
        {surfaceActions.map((action, index) => {
          const Icon = action.icon;
          return (
            <div
              key={action.title}
              className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                index === 0 ? '' : 'border-t border-border/70'
              } ${action.disabled ? 'opacity-60' : ''}`}
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
                  <Icon size={14} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{action.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{action.description}</p>
                </div>
              </div>
              <button
                type="button"
                disabled={action.disabled || !action.onClick}
                onClick={action.onClick}
                className="inline-flex h-8 w-fit shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ExternalLink size={12} />
                {action.disabled ? copy.unavailableAction : copy.openAction}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
