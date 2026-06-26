'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  ChevronUp,
  FileText,
  Info,
  Loader2,
  MousePointer2,
  Palette,
  PanelRightOpen,
  Pencil,
  Puzzle,
  Settings,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import {
  choosePluginMenuItem,
  choosePluginModalSuggestion,
  executePluginRibbonSurface,
  fetchPluginHostSurfaces,
  firstPluginActionMenuSnapshot,
  firstPluginActionModalSnapshot,
  firstPluginActionTargetPath,
  pluginCommandHotkeyCount,
  pluginCommandHotkeyConflictSummary,
  pluginCommandHotkeyLabel,
  pluginCommandHotkeyPolicyLabel,
  pluginViewSurfaceHref,
  sourcePathFromViewPathname,
  submitPluginModalText,
  toastPluginActionNotices,
  type PluginMenuSnapshot,
  type PluginModalSnapshot,
  type PluginModalSuggestionChoice,
} from '@/lib/plugins/client';
import { PLUGINS_CHANGED_EVENT } from '@/lib/plugins/events';
import type { PluginSurface } from '@/lib/plugins/surfaces';
import { notifyPluginEntriesState, PLUGIN_ENTRIES_OPEN_EVENT } from '@/lib/plugins/ui-events';
import { encodePath } from '@/lib/utils';
import { openTab } from '@/lib/workspace-tabs';
import { notifyFilesChanged } from '@/lib/files-changed';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import PluginActionModalDialog from './PluginActionModalDialog';
import PluginActionMenuDialog from './PluginActionMenuDialog';

interface PluginEntriesDockProps {
  onOpenPluginsSettings: () => void;
  onOpenCommandCenter?: () => void;
}

type HostSurfaceKind = 'command' | 'ribbon' | 'status' | 'view' | 'markdown' | 'style' | 'editor';

const HOST_SURFACE_ORDER: HostSurfaceKind[] = ['status', 'ribbon', 'command', 'view', 'markdown', 'style', 'editor'];

const HOST_SURFACE_META: Record<HostSurfaceKind, {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  tone: string;
}> = {
  status: {
    title: 'Status',
    subtitle: 'Live snapshots',
    icon: Activity,
    tone: 'text-success',
  },
  ribbon: {
    title: 'Actions',
    subtitle: 'Ribbon actions',
    icon: MousePointer2,
    tone: 'text-[var(--amber)]',
  },
  command: {
    title: 'Commands',
    subtitle: 'Command Center',
    icon: Terminal,
    tone: 'text-foreground',
  },
  view: {
    title: 'Views',
    subtitle: 'View host',
    icon: PanelRightOpen,
    tone: 'text-muted-foreground',
  },
  markdown: {
    title: 'Documents',
    subtitle: 'Markdown hooks',
    icon: FileText,
    tone: 'text-muted-foreground',
  },
  style: {
    title: 'Assets',
    subtitle: 'Stylesheets',
    icon: Palette,
    tone: 'text-muted-foreground',
  },
  editor: {
    title: 'Editor',
    subtitle: 'Extension catalog',
    icon: Pencil,
    tone: 'text-muted-foreground',
  },
};

type EditorExtensionMetadata = {
  id?: string;
  kind?: string;
  valueType?: string;
  serializable?: boolean;
  count?: number;
  constructorName?: string;
  keys?: string[];
  mountStatus?: string;
  capabilityGate?: string;
  mountReason?: string;
  autoMount?: boolean;
  sandbox?: {
    phase?: string;
    host?: string;
    status?: string;
    transferable?: boolean;
    cleanupRequired?: boolean;
    requirements?: string[];
    reasons?: string[];
  };
};

type CapabilityGateMetadata = {
  capability?: string;
  status?: string;
  autoEnable?: boolean;
  reason?: string;
  nextStep?: string;
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function isHostSurfaceKind(kind: PluginSurface['kind']): kind is HostSurfaceKind {
  return kind === 'command'
    || kind === 'ribbon'
    || kind === 'status'
    || kind === 'view'
    || kind === 'markdown'
    || kind === 'style'
    || kind === 'editor';
}

function metadataString(surface: PluginSurface, key: string): string {
  const value = surface.metadata?.[key];
  return typeof value === 'string' ? value : '';
}

function metadataStringArray(surface: PluginSurface, key: string): string[] {
  const value = surface.metadata?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function capabilityGateMetadata(surface: PluginSurface): CapabilityGateMetadata | null {
  const value = surface.metadata?.capabilityGate;
  return value !== null && typeof value === 'object' ? value as CapabilityGateMetadata : null;
}

function supportClass(kind: string): string {
  if (kind === 'ready') return 'border-success/30 bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success';
  if (kind === 'blocked') return 'border-error/25 bg-error/10 text-error';
  return 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
}

function surfaceSubtitle(surface: PluginSurface): string {
  if (surface.kind === 'command') return `${surface.pluginName} · Command Center`;
  if (surface.kind === 'ribbon') return `${surface.pluginName} · Plugin Entries actions`;
  if (surface.kind === 'status') return surface.pluginName;
  if (surface.kind === 'view') {
    const viewType = metadataString(surface, 'viewType') || surface.title;
    return `${surface.pluginName} · ${viewType}`;
  }
  if (surface.kind === 'markdown') {
    const language = metadataString(surface, 'language');
    return language ? `${surface.pluginName} · code block: ${language}` : `${surface.pluginName} · post processor`;
  }
  if (surface.kind === 'style') return `${surface.pluginName} · scoped stylesheet`;
  if (surface.kind === 'editor') return `${surface.pluginName} · editor extension catalog`;
  return surface.pluginName;
}

function hostStateLabel(state: PluginSurface['host']['state']): string {
  if (state === 'mounted') return 'Mounted';
  if (state === 'catalog') return 'Catalog';
  return 'Recorded';
}

function hostStateClass(state: PluginSurface['host']['state']): string {
  if (state === 'mounted') {
    return 'border-success/30 bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-success';
  }
  if (state === 'catalog') {
    return 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
  }
  return 'border-border bg-muted/60 text-muted-foreground';
}

function surfaceMetadataRows(surface: PluginSurface): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Location', value: surface.location },
    { label: 'Availability', value: surface.availability },
  ];
  const language = metadataString(surface, 'language');
  const viewType = metadataString(surface, 'viewType');
  const fileExtensions = metadataStringArray(surface, 'fileExtensions');
  const stylePath = metadataString(surface, 'path');
  const injectionPolicy = metadataString(surface, 'injectionPolicy');
  const mountPolicy = metadataString(surface, 'mountPolicy');
  const capabilityGate = capabilityGateMetadata(surface);
  const commandId = metadataString(surface, 'fullCommandId') || metadataString(surface, 'commandId');
  const callbackType = metadataString(surface, 'callbackType');
  const availabilityReason = metadataString(surface, 'availabilityReason');
  const supportLabel = metadataString(surface, 'supportLabel');
  const supportReason = metadataString(surface, 'supportReason');
  const commandHotkey = surface.kind === 'command' ? pluginCommandHotkeyLabel(surface) : null;
  const commandHotkeyCount = surface.kind === 'command' ? pluginCommandHotkeyCount(surface) : 0;
  const commandHotkeyPolicy = surface.kind === 'command' ? pluginCommandHotkeyPolicyLabel(surface) : null;
  const hotkeyConflictSummary = surface.kind === 'command' ? pluginCommandHotkeyConflictSummary(surface) : null;
  const count = surface.metadata?.count;

  if (commandId) rows.push({ label: 'Command', value: commandId });
  if (surface.kind === 'command' && callbackType) rows.push({ label: 'Callback', value: callbackType });
  if (surface.kind === 'command' && surface.metadata?.requiresEditor === true) rows.push({ label: 'Context', value: 'Editor required' });
  if (surface.kind === 'command' && availabilityReason) rows.push({ label: 'Reason', value: availabilityReason });
  if (commandHotkey) {
    rows.push({
      label: commandHotkeyCount > 1 ? 'Obsidian hotkey' : 'Hotkey',
      value: commandHotkeyCount > 1 ? `${commandHotkey} +${commandHotkeyCount - 1}` : commandHotkey,
    });
    rows.push({ label: 'Hotkey binding', value: commandHotkeyPolicy === 'Conflict' ? 'Display only, conflict' : 'User-confirmable' });
  }
  if (hotkeyConflictSummary) rows.push({ label: 'Hotkey conflicts', value: hotkeyConflictSummary });
  if (viewType) rows.push({ label: 'View type', value: viewType });
  if (fileExtensions.length > 0) rows.push({ label: 'File extensions', value: fileExtensions.map((extension) => `.${extension}`).join(', ') });
  if (language) rows.push({ label: 'Code block', value: language });
  if (stylePath) rows.push({ label: 'Stylesheet', value: stylePath });
  if (injectionPolicy) {
    rows.push({
      label: 'Injection',
      value: injectionPolicy === 'not-mounted'
        ? 'Not mounted'
        : injectionPolicy === 'scoped-plugin-view'
          ? 'Scoped to plugin view'
          : injectionPolicy,
    });
  }
  if (surface.kind === 'editor' && mountPolicy) rows.push({ label: 'Mount policy', value: mountPolicy === 'catalog-only' ? 'Catalog only' : mountPolicy });
  if (surface.kind === 'editor' && capabilityGate?.capability) rows.push({ label: 'Capability gate', value: capabilityGate.capability });
  if (surface.kind === 'editor' && capabilityGate?.autoEnable === false) rows.push({ label: 'Auto mount', value: 'Disabled' });
  if (surface.kind === 'editor' && capabilityGate?.nextStep) rows.push({ label: 'Next step', value: capabilityGate.nextStep });
  if (typeof count === 'number') rows.push({ label: 'Count', value: String(count) });
  if (supportReason) rows.push({ label: 'Support note', value: supportReason });

  const editorExtensions = editorExtensionMetadata(surface);
  if (editorExtensions.length > 0) {
    const kinds = editorExtensions
      .map((extension) => extension.constructorName || extension.kind || extension.valueType)
      .filter(Boolean)
      .join(', ');
    const serializableCount = editorExtensions.filter((extension) => extension.serializable === true).length;
    const gatedCount = editorExtensions.filter((extension) => extension.mountStatus === 'catalog-only').length;
    if (kinds) rows.push({ label: 'Extension types', value: kinds });
    rows.push({ label: 'Serializable', value: `${serializableCount}/${editorExtensions.length}` });
    rows.push({ label: 'Gate status', value: `${gatedCount}/${editorExtensions.length} catalog-only` });
  }

  return rows;
}

function editorExtensionMetadata(surface: PluginSurface): EditorExtensionMetadata[] {
  const value = surface.metadata?.editorExtensions;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is EditorExtensionMetadata => item !== null && typeof item === 'object');
}

function countLabel(count: number, singular: string, plural?: string): string {
  return count > 0 ? `${count} ${pluralize(count, singular, plural)}` : '';
}

function countMountedEntries(surfaces: PluginSurface[]): number {
  return surfaces.filter((surface) => surface.host.state === 'mounted').length;
}

function countCatalogEntries(surfaces: PluginSurface[]): number {
  return surfaces.filter((surface) => surface.host.state !== 'mounted').length;
}

function groupedSurfaces(surfaces: PluginSurface[]): Record<HostSurfaceKind, PluginSurface[]> {
  return HOST_SURFACE_ORDER.reduce((acc, kind) => {
    acc[kind] = surfaces.filter((surface) => surface.kind === kind);
    return acc;
  }, {} as Record<HostSurfaceKind, PluginSurface[]>);
}

function PluginSurfaceDetail({
  surface,
  onOpenPluginsSettings,
  onOpenCommandCenter,
  onRunRibbonAction,
  runningRibbonAction,
  actionError,
  sourcePath,
}: {
  surface: PluginSurface;
  onOpenPluginsSettings: () => void;
  onOpenCommandCenter: () => void;
  onRunRibbonAction: (surface: PluginSurface) => void;
  runningRibbonAction: boolean;
  actionError: string | null;
  sourcePath?: string | null;
}) {
  const meta = isHostSurfaceKind(surface.kind) ? HOST_SURFACE_META[surface.kind] : HOST_SURFACE_META.status;
  const Icon = meta.icon;
  const metadataRows = surfaceMetadataRows(surface);
  const viewHref = pluginViewSurfaceHref(surface, sourcePath);
  const supportKind = metadataString(surface, 'supportKind');
  const supportLabel = metadataString(surface, 'supportLabel');
  const commandExecutable = surface.kind === 'command'
    && surface.availability === 'available'
    && surface.action?.type === 'obsidian-command';

  return (
    <section
      data-testid="plugin-surface-detail"
      className="border-t border-border bg-background/55 px-3 py-3"
      aria-label={`Plugin entry host for ${surface.title}`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-card text-muted-foreground">
          <Icon size={13} className={meta.tone} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-xs font-semibold text-foreground">{surface.title}</h3>
            <span className={`shrink-0 rounded border px-1.5 py-0.5 text-2xs font-medium ${hostStateClass(surface.host.state)}`}>
              {hostStateLabel(surface.host.state)}
            </span>
            {supportLabel && (
              <span className={`shrink-0 rounded border px-1.5 py-0.5 text-2xs font-medium ${supportClass(supportKind)}`}>
                {supportLabel}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-2xs text-muted-foreground">{surface.pluginName} · {surface.host.label}</div>
        </div>
      </div>

      <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-border/60 bg-card/70 px-2.5 py-2 text-2xs text-muted-foreground">
        <Info size={12} className="mt-0.5 shrink-0" />
        <span>{surface.host.description}</span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {metadataRows.map((row) => (
          <div
            key={`${row.label}:${row.value}`}
            className={`min-w-0 rounded-md border border-border/50 bg-card/55 px-2 py-1.5 ${row.label === 'Support note' ? 'col-span-2' : ''}`}
          >
            <div className="text-2xs uppercase text-muted-foreground/70">{row.label}</div>
            <div className={`mt-0.5 text-2xs font-medium text-foreground ${row.label === 'Support note' ? 'break-words leading-relaxed' : 'truncate'}`}>
              {row.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex justify-end gap-2">
        {surface.kind === 'ribbon' && surface.action?.type === 'obsidian-ribbon' && (
          <button
            type="button"
            onClick={() => onRunRibbonAction(surface)}
            disabled={runningRibbonAction}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--amber)] px-2.5 text-2xs font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
          >
            {runningRibbonAction ? <Loader2 size={11} className="animate-spin" /> : <MousePointer2 size={11} />}
            Run action
          </button>
        )}
        {commandExecutable && (
          <button
            type="button"
            onClick={onOpenCommandCenter}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-2xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Terminal size={11} />
            Command Center
          </button>
        )}
        {viewHref && (
          <a
            href={viewHref}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--amber)] px-2.5 text-2xs font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PanelRightOpen size={11} />
            Open view
          </a>
        )}
        <button
          type="button"
          onClick={onOpenPluginsSettings}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-2xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Settings size={11} />
          Manage plugin
        </button>
      </div>
      {actionError && (
        <div className="mt-2 rounded-md border border-error/25 bg-error/10 px-2.5 py-1.5 text-2xs text-error">
          {actionError}
        </div>
      )}
    </section>
  );
}

function PluginEntriesPanel({
  groups,
  selectedSurface,
  selectedSurfaceId,
  mountedEntryCount,
  catalogEntryCount,
  panelClassName,
  onOpenPluginsSettings,
  onOpenCommandCenter,
  onSelectSurface,
  onRunRibbonAction,
  runningRibbonSurfaceId,
  actionError,
  sourcePath,
  testId,
}: {
  groups: Record<HostSurfaceKind, PluginSurface[]>;
  selectedSurface: PluginSurface | null;
  selectedSurfaceId: string | null;
  mountedEntryCount: number;
  catalogEntryCount: number;
  panelClassName: string;
  onOpenPluginsSettings: () => void;
  onOpenCommandCenter: () => void;
  onSelectSurface: (surface: PluginSurface) => void;
  onRunRibbonAction: (surface: PluginSurface) => void;
  runningRibbonSurfaceId: string | null;
  actionError: string | null;
  sourcePath?: string | null;
  testId: string;
}) {
  return (
    <div
      role="dialog"
      aria-label="Plugin Entries"
      data-testid={testId}
      className={`overflow-hidden rounded-xl border border-border bg-card shadow-lg z-app-popover ${panelClassName}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-border/70 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-foreground">Plugin Entries</div>
          <div className="mt-0.5 truncate text-2xs text-muted-foreground">
            Use entries here; manage separately.
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded border border-success/25 bg-[color-mix(in_srgb,var(--success)_10%,transparent)] px-1.5 py-0.5 text-2xs text-success">
              {mountedEntryCount} mounted
            </span>
            {catalogEntryCount > 0 && (
              <span className="rounded border border-[var(--amber)]/20 bg-[var(--amber-subtle)] px-1.5 py-0.5 text-2xs text-[var(--amber-text)]">
                {catalogEntryCount} catalog
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenPluginsSettings}
          className="hit-target-box inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-2xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)]"
          aria-label="Manage plugins in settings"
          title="Manage plugins in settings"
        >
          <Settings size={12} />
          Manage
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {HOST_SURFACE_ORDER.map((kind) => {
          const items = groups[kind];
          if (items.length === 0) return null;
          const meta = HOST_SURFACE_META[kind];
          const Icon = meta.icon;
          const sectionBorder = kind === HOST_SURFACE_ORDER.find((item) => groups[item].length > 0)
            ? ''
            : 'border-t border-border/60';

          return (
            <section key={kind} data-testid={`plugin-surface-section-${kind}`} className={`${sectionBorder} py-1`}>
              <div className="flex items-center justify-between gap-2 px-3 py-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Icon size={12} className={`shrink-0 ${meta.tone}`} />
                  <span className="truncate text-2xs font-semibold uppercase text-muted-foreground">
                    {meta.title}
                  </span>
                </div>
                <span className="shrink-0 text-2xs text-muted-foreground/70">{meta.subtitle}</span>
              </div>
              {items.map((surface) => {
                const subtitle = surfaceSubtitle(surface);
                const isSelected = surface.id === selectedSurfaceId;
                const commandExecutable = surface.kind === 'command'
                  && surface.availability === 'available'
                  && surface.action?.type === 'obsidian-command';

                return (
                  <button
                    key={surface.id}
                    type="button"
                    onClick={() => {
                      onSelectSurface(surface);
                      if (commandExecutable) onOpenCommandCenter();
                    }}
                    data-selected={isSelected ? 'true' : undefined}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[selected=true]:bg-muted/60"
                    aria-label={commandExecutable ? `Open Command Center for ${surface.title}` : `Inspect plugin entry ${surface.title}`}
                  >
                    <Icon size={13} className={`mt-0.5 shrink-0 ${meta.tone}`} />
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-foreground">{surface.title}</span>
                      <span className="block truncate text-2xs text-muted-foreground">{subtitle}</span>
                    </span>
                    <span className={`ml-auto mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-2xs ${hostStateClass(surface.host.state)}`}>
                      {hostStateLabel(surface.host.state)}
                    </span>
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>

      {selectedSurface && (
        <PluginSurfaceDetail
          surface={selectedSurface}
          onOpenPluginsSettings={onOpenPluginsSettings}
          onOpenCommandCenter={onOpenCommandCenter}
          onRunRibbonAction={onRunRibbonAction}
          runningRibbonAction={runningRibbonSurfaceId === selectedSurface.id}
          actionError={selectedSurface.id === selectedSurfaceId ? actionError : null}
          sourcePath={sourcePath}
        />
      )}
    </div>
  );
}

export default function PluginEntriesDock({ onOpenPluginsSettings, onOpenCommandCenter }: PluginEntriesDockProps) {
  const [surfaces, setSurfaces] = useState<PluginSurface[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string | null>(null);
  const [runningRibbonSurfaceId, setRunningRibbonSurfaceId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pluginModal, setPluginModal] = useState<PluginModalSnapshot | null>(null);
  const [pluginMenu, setPluginMenu] = useState<PluginMenuSnapshot | null>(null);
  const [choosingSuggestionIndex, setChoosingSuggestionIndex] = useState<number | null>(null);
  const [submittingModalText, setSubmittingModalText] = useState(false);
  const [modalChoiceError, setModalChoiceError] = useState<string | null>(null);
  const [choosingMenuItemIndex, setChoosingMenuItemIndex] = useState<number | null>(null);
  const [menuChoiceError, setMenuChoiceError] = useState<string | null>(null);
  const router = useRouter();
  const smoothPush = useSmoothRouterPush();
  const pathname = usePathname();
  const sourcePath = useMemo(() => sourcePathFromViewPathname(pathname), [pathname]);

  const refresh = useCallback(async (loadEnabled = false, options: { bypassCache?: boolean } = {}) => {
    try {
      const next = await fetchPluginHostSurfaces({ loadEnabled, bypassCache: options.bypassCache });
      setSurfaces(next);
    } catch {
      setSurfaces([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh(false, { bypassCache: true });
    const onPluginChange = () => void refresh(false, { bypassCache: true });
    const onPluginEntriesOpen = () => {
      setOpen(true);
      void refresh(true, { bypassCache: true });
    };
    const onWindowFocus = () => void refresh();
    window.addEventListener(PLUGINS_CHANGED_EVENT, onPluginChange);
    window.addEventListener(PLUGIN_ENTRIES_OPEN_EVENT, onPluginEntriesOpen);
    window.addEventListener('focus', onWindowFocus);
    return () => {
      window.removeEventListener(PLUGINS_CHANGED_EVENT, onPluginChange);
      window.removeEventListener(PLUGIN_ENTRIES_OPEN_EVENT, onPluginEntriesOpen);
      window.removeEventListener('focus', onWindowFocus);
    };
  }, [refresh]);

  const hostSurfaces = useMemo(
    () => surfaces.filter((surface) => isHostSurfaceKind(surface.kind)),
    [surfaces],
  );
  const groups = useMemo(() => groupedSurfaces(hostSurfaces), [hostSurfaces]);
  const selectedSurface = useMemo(
    () => hostSurfaces.find((surface) => surface.id === selectedSurfaceId) ?? null,
    [hostSurfaces, selectedSurfaceId],
  );

  useEffect(() => {
    if (selectedSurfaceId && !hostSurfaces.some((surface) => surface.id === selectedSurfaceId)) {
      setSelectedSurfaceId(null);
    }
  }, [hostSurfaces, selectedSurfaceId]);

  useEffect(() => {
    setActionError(null);
  }, [selectedSurfaceId]);

  const primaryStatus = groups.status.find((surface) => surface.title.trim()) ?? groups.status[0];
  const mountedEntryCount = countMountedEntries(hostSurfaces);
  const catalogEntryCount = countCatalogEntries(hostSurfaces);
  const detail = [
    countLabel(groups.ribbon.length, 'action'),
    countLabel(groups.command.filter((surface) => surface.availability === 'available' && surface.action?.type === 'obsidian-command').length, 'command'),
    countLabel(groups.view.length, 'view'),
    countLabel(groups.markdown.length, 'document hook'),
    countLabel(groups.style.length, 'asset'),
    countLabel(groups.editor.length, 'editor hook'),
    countLabel(groups.status.length, 'status', 'statuses'),
  ].filter(Boolean).slice(0, 3).join(' · ');
  const statusDetail = primaryStatus ? `${primaryStatus.pluginName}: ${primaryStatus.title}` : detail;
  const hideLauncherOnSettingsRoute = pathname.startsWith('/settings') && !open;

  useEffect(() => {
    notifyPluginEntriesState({
      count: hostSurfaces.length,
      mounted: mountedEntryCount,
      catalog: catalogEntryCount,
    });
  }, [catalogEntryCount, hostSurfaces.length, mountedEntryCount]);

  if (!loaded || (hostSurfaces.length === 0 && !pluginModal && !pluginMenu)) return null;

  const openCommandCenter = onOpenCommandCenter ?? onOpenPluginsSettings;
  const selectSurface = (surface: PluginSurface) => setSelectedSurfaceId(surface.id);
  const applyPluginActionResult = (result: Awaited<ReturnType<typeof choosePluginModalSuggestion>>) => {
    toastPluginActionNotices(result);
    const targetPath = firstPluginActionTargetPath(result);
    if (targetPath) {
      openTab('doc', targetPath, targetPath.split('/').pop() || targetPath);
      smoothPush(`/view/${encodePath(targetPath)}`);
      setPluginModal(null);
      setPluginMenu(null);
      setOpen(false);
      return;
    }
    if (result.editorUpdates?.some((update) => update.changed)) {
      notifyFilesChanged(
        result.editorUpdates.flatMap((update) => update.changed && update.sourcePath ? [update.sourcePath] : []),
      );
      router.refresh();
      setPluginModal(null);
      setPluginMenu(null);
      return;
    }

    const modal = firstPluginActionModalSnapshot(result);
    if (modal) {
      setPluginModal(modal);
      setPluginMenu(null);
      return;
    }

    const menu = firstPluginActionMenuSnapshot(result);
    if (menu) {
      setPluginMenu(menu);
      setPluginModal(null);
      return;
    }

    setPluginModal(null);
  };

  const runRibbonAction = async (surface: PluginSurface) => {
    setRunningRibbonSurfaceId(surface.id);
    setActionError(null);
    try {
      const result = await executePluginRibbonSurface(surface);
      toastPluginActionNotices(result);
      const targetPath = firstPluginActionTargetPath(result);
      if (targetPath) {
        openTab('doc', targetPath, targetPath.split('/').pop() || targetPath);
        smoothPush(`/view/${encodePath(targetPath)}`);
        setOpen(false);
      } else {
        const modal = firstPluginActionModalSnapshot(result);
        if (modal) {
          setPluginModal(modal);
          setOpen(false);
        } else {
          const menu = firstPluginActionMenuSnapshot(result);
          if (menu) {
            setPluginMenu(menu);
            setOpen(false);
          }
        }
      }
      await refresh(true, { bypassCache: true });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to run plugin action');
    } finally {
      setRunningRibbonSurfaceId(null);
    }
  };
  const chooseModalSuggestion = async (modal: PluginModalSnapshot, suggestion: PluginModalSuggestionChoice) => {
    setChoosingSuggestionIndex(suggestion.index);
    setModalChoiceError(null);
    try {
      if (!modal.interactionId) {
        throw new Error('Plugin modal interaction expired. Run the command again.');
      }
      const result = await choosePluginModalSuggestion(modal.id, suggestion.index, modal.interactionId);
      applyPluginActionResult(result);
      await refresh(true, { bypassCache: true });
    } catch (error) {
      setModalChoiceError(error instanceof Error ? error.message : 'Failed to choose plugin suggestion');
    } finally {
      setChoosingSuggestionIndex(null);
    }
  };
  const submitModalText = async (modal: PluginModalSnapshot, text: string) => {
    setSubmittingModalText(true);
    setModalChoiceError(null);
    try {
      if (!modal.interactionId) {
        throw new Error('Plugin modal interaction expired. Run the command again.');
      }
      const result = await submitPluginModalText(modal.id, text, modal.interactionId);
      applyPluginActionResult(result);
      await refresh(true, { bypassCache: true });
    } catch (error) {
      setModalChoiceError(error instanceof Error ? error.message : 'Failed to submit plugin modal text');
    } finally {
      setSubmittingModalText(false);
    }
  };
  const chooseMenuItem = async (menu: PluginMenuSnapshot, item: PluginMenuSnapshot['items'][number]) => {
    setChoosingMenuItemIndex(item.index);
    setMenuChoiceError(null);
    try {
      if (!menu.interactionId) {
        throw new Error('Plugin menu interaction expired. Run the command again.');
      }
      const result = await choosePluginMenuItem(menu.id, item.index, menu.interactionId);
      applyPluginActionResult(result);
      await refresh(true, { bypassCache: true });
    } catch (error) {
      setMenuChoiceError(error instanceof Error ? error.message : 'Failed to choose plugin menu item');
    } finally {
      setChoosingMenuItemIndex(null);
    }
  };

  return (
    <>
      {hostSurfaces.length > 0 && !hideLauncherOnSettingsRoute && (
        <>
          <div
            className="pointer-events-none fixed bottom-4 hidden md:block z-app-popover"
            style={{
              left: 'calc(var(--content-left-offset, var(--rail-width, 48px)) + 16px)',
              right: 'calc(var(--right-panel-width, 0px) + var(--right-agent-detail-width, 0px) + 92px)',
            }}
          >
            <div className="relative inline-flex max-w-full pointer-events-auto">
              <button
                type="button"
                data-testid="plugin-entries-dock"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                className="hit-target-box flex h-9 max-w-full items-center gap-2 rounded-lg border border-border/70 bg-card/95 px-3 text-xs text-muted-foreground shadow-sm backdrop-blur transition-colors hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-lg)]"
                title="Plugin Entries"
              >
                <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
                  <Puzzle size={12} />
                  {groups.status.length > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-success" />
                  )}
                </span>
                <span className="shrink-0 text-foreground">Plugin Entries</span>
                {statusDetail && <span className="hidden min-w-0 truncate text-muted-foreground/70 lg:inline">{statusDetail}</span>}
                {detail && <span className="hidden shrink-0 text-muted-foreground/70 xl:inline">{detail}</span>}
                <ChevronUp size={12} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>

              {open && (
                <PluginEntriesPanel
                  groups={groups}
                  selectedSurface={selectedSurface}
                  selectedSurfaceId={selectedSurfaceId}
                  mountedEntryCount={mountedEntryCount}
                  catalogEntryCount={catalogEntryCount}
                  panelClassName="absolute bottom-[calc(100%+8px)] left-0 flex max-h-[calc(100vh-7rem)] w-[440px] max-w-[calc(100vw-7rem)] flex-col"
                  onOpenPluginsSettings={onOpenPluginsSettings}
                  onOpenCommandCenter={openCommandCenter}
                  onSelectSurface={selectSurface}
                  onRunRibbonAction={(surface) => void runRibbonAction(surface)}
                  runningRibbonSurfaceId={runningRibbonSurfaceId}
                  actionError={actionError}
                  sourcePath={sourcePath}
                  testId="plugin-entries-popover"
                />
              )}
            </div>
          </div>

          <div
            className="fixed bottom-4 right-4 z-app-popover md:hidden"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            <button
              type="button"
              data-testid="plugin-entries-mobile-button"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className="hit-target-box flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border border-border/70 bg-card/95 px-3 text-xs font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-xl)]"
              title="Plugin Entries"
              aria-label="Open Plugin Entries"
            >
              <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
                <Puzzle size={12} />
                {groups.status.length > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-success" />
                )}
              </span>
              <span>{hostSurfaces.length}</span>
            </button>

            {open && (
              <PluginEntriesPanel
                groups={groups}
                selectedSurface={selectedSurface}
                selectedSurfaceId={selectedSurfaceId}
                mountedEntryCount={mountedEntryCount}
                catalogEntryCount={catalogEntryCount}
                panelClassName="fixed bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] left-3 right-3 flex max-h-[calc(100vh-7rem)] flex-col"
                onOpenPluginsSettings={onOpenPluginsSettings}
                onOpenCommandCenter={openCommandCenter}
                onSelectSurface={selectSurface}
                onRunRibbonAction={(surface) => void runRibbonAction(surface)}
                runningRibbonSurfaceId={runningRibbonSurfaceId}
                actionError={actionError}
                sourcePath={sourcePath}
                testId="plugin-entries-mobile-sheet"
              />
            )}
          </div>
        </>
      )}

      <PluginActionModalDialog
        modal={pluginModal}
        onChooseSuggestion={(modal, suggestion) => void chooseModalSuggestion(modal, suggestion)}
        onSubmitText={(modal, text) => void submitModalText(modal, text)}
        choosingSuggestionIndex={choosingSuggestionIndex}
        submittingText={submittingModalText}
        choiceError={modalChoiceError}
        onClose={() => {
          setPluginModal(null);
          setModalChoiceError(null);
        }}
      />
      <PluginActionMenuDialog
        menu={pluginMenu}
        onChooseItem={(menu, item) => void chooseMenuItem(menu, item)}
        choosingItemIndex={choosingMenuItemIndex}
        choiceError={menuChoiceError}
        onClose={() => {
          setPluginMenu(null);
          setMenuChoiceError(null);
        }}
      />
    </>
  );
}
