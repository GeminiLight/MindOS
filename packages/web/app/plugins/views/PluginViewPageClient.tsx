'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, FileText, Loader2, PanelRightOpen, Puzzle, RefreshCw, Settings, ShieldCheck } from 'lucide-react';
import {
  fetchPluginSurfaces,
  fetchPluginStylesheet,
  fetchPluginView,
  pluginViewSurfaceHref,
  type PluginStylesheetSnapshot,
  type PluginViewSnapshot,
} from '@/lib/plugins/client';
import { PLUGINS_CHANGED_EVENT } from '@/lib/plugins/events';
import type { PluginSurface } from '@/lib/plugins/surfaces';

interface PluginViewPageClientProps {
  pluginId: string;
  viewType: string;
  sourcePath?: string;
}

export default function PluginViewPageClient({ pluginId, viewType, sourcePath = '' }: PluginViewPageClientProps) {
  const [view, setView] = useState<PluginViewSnapshot | null>(null);
  const [viewSurfaces, setViewSurfaces] = useState<PluginSurface[]>([]);
  const [stylesheet, setStylesheet] = useState<PluginStylesheetSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(pluginId && viewType));
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshSource, setRefreshSource] = useState<'initial' | 'manual' | 'plugins-changed'>('initial');
  const [lastRefreshLabel, setLastRefreshLabel] = useState('Not loaded yet');
  const isMissingParams = !pluginId || !viewType;
  const normalizedSourcePath = sourcePath.trim();

  const requestRefresh = useCallback((source: 'manual' | 'plugins-changed') => {
    setRefreshSource(source);
    setRefreshTick((current) => current + 1);
  }, []);

  useEffect(() => {
    if (isMissingParams) {
      let cancelled = false;
      setLoading(true);
      setError(null);
      setView(null);
      setStylesheet(null);
      setLastRefreshLabel('Loading available plugin views');
      fetchPluginSurfaces('kind=view&source=obsidian', { loadEnabled: true })
        .then((surfaces) => {
          if (cancelled) return;
          setViewSurfaces(surfaces.filter((surface) => surface.action?.type === 'obsidian-view'));
          setLastRefreshLabel(refreshSource === 'plugins-changed'
            ? 'Refreshed after plugin change'
            : refreshSource === 'manual'
              ? 'Refreshed manually'
              : 'Showing available plugin views');
        })
        .catch((err) => {
          if (cancelled) return;
          setLastRefreshLabel('Refresh failed');
          setError(err instanceof Error ? err.message : 'Failed to load plugin views.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setView(null);
    setViewSurfaces([]);
    setStylesheet(null);
    const viewRequest = normalizedSourcePath
      ? fetchPluginView(pluginId, viewType, normalizedSourcePath)
      : fetchPluginView(pluginId, viewType);
    const styleRequest = fetchPluginStylesheet(pluginId).catch(() => null);

    Promise.all([viewRequest, styleRequest])
      .then(([nextView, nextStylesheet]) => {
        if (!cancelled) {
          setView(nextView);
          setStylesheet(nextStylesheet);
          setLastRefreshLabel(refreshSource === 'plugins-changed'
            ? 'Refreshed after plugin change'
            : refreshSource === 'manual'
              ? 'Refreshed manually'
              : 'Loaded from plugin host');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLastRefreshLabel('Refresh failed');
          setError(err instanceof Error ? err.message : 'Failed to open plugin view.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isMissingParams, normalizedSourcePath, pluginId, refreshSource, refreshTick, viewType]);

  useEffect(() => {
    const onPluginsChanged = () => requestRefresh('plugins-changed');
    window.addEventListener(PLUGINS_CHANGED_EVENT, onPluginsChanged);
    return () => window.removeEventListener(PLUGINS_CHANGED_EVENT, onPluginsChanged);
  }, [requestRefresh]);

  const rows = useMemo(() => {
    const styleRow = {
      label: 'Styles',
      value: stylesheet?.scopedCss ? 'Scoped stylesheet active' : 'No scoped stylesheet',
    };
    if (!view) {
      return [
        { label: 'Plugin', value: pluginId || 'unknown' },
        { label: 'View type', value: viewType || 'unknown' },
        { label: 'Refresh', value: lastRefreshLabel },
        ...(isMissingParams ? [{ label: 'Available views', value: String(viewSurfaces.length) }] : []),
        styleRow,
        ...(normalizedSourcePath ? [{ label: 'Active file', value: normalizedSourcePath }] : []),
      ];
    }
    return [
      { label: 'Plugin', value: view.pluginId },
      { label: 'View type', value: view.viewType },
      { label: 'Resolved type', value: view.resolvedViewType },
      { label: 'Class', value: view.className },
      { label: 'Refresh', value: lastRefreshLabel },
      styleRow,
      ...(view.sourcePath ? [{ label: 'Active file', value: view.sourcePath }] : []),
    ];
  }, [isMissingParams, lastRefreshLabel, normalizedSourcePath, pluginId, stylesheet?.scopedCss, view, viewSurfaces.length, viewType]);

  const activeFileLabel = view?.sourcePath || normalizedSourcePath || 'No active file context';
  const canRefresh = !loading;
  const hostBadge = view
    ? (view.text ? 'Snapshot host' : 'No text snapshot')
    : isMissingParams
      ? 'View index'
      : 'Compatibility host';
  const hostBadgeClass = view?.text
    ? 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]'
    : 'border-border bg-muted text-muted-foreground';

  return (
    <main className="min-h-full bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-8 md:px-10">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/wiki"
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft size={14} />
            Wiki
          </Link>
          <Link
            href="/settings?tab=plugins"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Settings size={13} />
            Plugin settings
          </Link>
        </div>

        <header className="flex items-start gap-3 border-b border-border/70 pb-5">
          <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--amber-subtle)] text-[var(--amber)]">
            <PanelRightOpen size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="min-w-0 truncate text-2xl font-semibold tracking-normal text-foreground">
                {view?.displayText || viewType || 'Plugin views'}
              </h1>
              <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-2xs font-medium ${hostBadgeClass}`}>
                {hostBadge}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {isMissingParams
                ? 'Browse available Obsidian custom views exposed through MindOS.'
                : 'Obsidian custom view rendered through the MindOS plugin view host.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => requestRefresh('manual')}
            disabled={!canRefresh}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </header>

        <section className="rounded-lg border border-[var(--amber)]/25 bg-[var(--amber-subtle)] px-4 py-3 text-[var(--amber-text)]">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--amber)]/25 bg-background/70">
              <ShieldCheck size={15} />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold">Compatibility host boundary</div>
              <p className="mt-0.5 text-xs leading-relaxed">
                MindOS renders Obsidian custom views as safe text snapshots with scoped styles and explicit active-file context. It does not mount the native Obsidian workspace or run arbitrary layout navigation.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border/70 bg-card/65 px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground">
              <FileText size={15} />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">Workspace context</div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {activeFileLabel}
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map((row) => (
            <div key={row.label} className="min-w-0 rounded-lg border border-border/65 bg-card/70 px-3 py-2">
              <div className="text-2xs uppercase tracking-wider text-muted-foreground/70">{row.label}</div>
              <div className="mt-1 truncate text-xs font-medium text-foreground">{row.value}</div>
            </div>
          ))}
        </section>

        {loading && (
          <div className="flex min-h-64 items-center justify-center rounded-lg border border-border/70 bg-card/55 text-sm text-muted-foreground">
            <Loader2 size={16} className="mr-2 animate-spin" />
            Opening plugin view
          </div>
        )}

        {!loading && error && (
          <div className="flex min-h-64 items-start gap-3 rounded-lg border border-error/25 bg-error/10 p-4 text-sm text-error">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Could not open plugin view</div>
              <div className="mt-1 text-error/80">{error}</div>
              <div className="mt-3 grid gap-2 text-xs text-error/75 sm:grid-cols-3">
                <div className="rounded-md border border-error/20 bg-background/55 px-2 py-1.5">
                  Check that the plugin is enabled and loaded.
                </div>
                <div className="rounded-md border border-error/20 bg-background/55 px-2 py-1.5">
                  Confirm the view type still exists.
                </div>
                <div className="rounded-md border border-error/20 bg-background/55 px-2 py-1.5">
                  If an active file is required, open from that file page.
                </div>
              </div>
            </div>
          </div>
        )}

        {!loading && !error && isMissingParams && (
          <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">Available plugin views</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Views appear after an Obsidian plugin is installed, enabled, and loaded.
                </p>
              </div>
              <Link
                href="/settings?tab=plugins&panel=surfaces"
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Settings size={13} />
                Surfaces
              </Link>
            </div>

            {viewSurfaces.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="text-sm font-medium text-foreground">No plugin views are available yet.</div>
                <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                  Install or import an Obsidian plugin with a custom view, then enable and load it from plugin settings.
                </p>
                <Link
                  href="/explore/plugins"
                  className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--amber)] bg-[var(--amber)] px-3 text-xs font-medium text-[var(--amber-foreground)] transition-colors hover:bg-[var(--amber)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Puzzle size={13} />
                  Open plugin market
                </Link>
              </div>
            ) : (
              <div>
                {viewSurfaces.map((surface, index) => {
                  const href = pluginViewSurfaceHref(surface);
                  return (
                    <Link
                      key={surface.id}
                      href={href ?? '/settings?tab=plugins&panel=surfaces'}
                      className={`flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-muted/35 sm:flex-row sm:items-center sm:justify-between ${
                        index === 0 ? '' : 'border-t border-border/70'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">{surface.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {surface.pluginName} · {surface.host.label}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                          {surface.availability}
                        </span>
                        <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-2xs font-medium text-foreground">
                          <PanelRightOpen size={11} />
                          Open
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {!loading && !error && view && (
          <section
            className="rounded-lg border border-border bg-card shadow-sm"
            data-obsidian-plugin-view={pluginId}
          >
            {stylesheet?.scopedCss ? (
              <style data-obsidian-plugin-style={stylesheet.pluginId}>
                {stylesheet.scopedCss}
              </style>
            ) : null}
            <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
              <Puzzle size={14} className="text-[var(--amber)]" />
              <h2 className="text-sm font-semibold text-foreground">{view.displayText}</h2>
            </div>
            <div className="min-h-64 px-4 py-4">
              {view.text ? (
                <pre className="whitespace-pre-wrap rounded-md bg-muted/45 p-3 font-mono text-xs leading-relaxed text-foreground">
                  {view.text}
                </pre>
              ) : (
                <div className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border/80 px-4 text-center text-sm text-muted-foreground">
                  <span>This view did not render text content in the compatibility host.</span>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Link
                      href="/settings?tab=plugins"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Settings size={13} />
                      Back to plugin host
                    </Link>
                    <Link
                      href="/settings?tab=plugins&panel=surfaces"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <PanelRightOpen size={13} />
                      Open surfaces
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
