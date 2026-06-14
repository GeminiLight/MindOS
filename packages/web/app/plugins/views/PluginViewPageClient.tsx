'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, FileText, Loader2, PanelRightOpen, Puzzle, RefreshCw, Settings } from 'lucide-react';
import {
  fetchPluginStylesheet,
  fetchPluginView,
  type PluginStylesheetSnapshot,
  type PluginViewSnapshot,
} from '@/lib/plugins/client';
import { PLUGINS_CHANGED_EVENT } from '@/lib/plugins/events';

interface PluginViewPageClientProps {
  pluginId: string;
  viewType: string;
  sourcePath?: string;
}

export default function PluginViewPageClient({ pluginId, viewType, sourcePath = '' }: PluginViewPageClientProps) {
  const [view, setView] = useState<PluginViewSnapshot | null>(null);
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
      setLoading(false);
      setError('Missing pluginId or viewType.');
      setView(null);
      setStylesheet(null);
      setLastRefreshLabel('Waiting for view parameters');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setView(null);
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
    if (isMissingParams) return;
    const onPluginsChanged = () => requestRefresh('plugins-changed');
    window.addEventListener(PLUGINS_CHANGED_EVENT, onPluginsChanged);
    return () => window.removeEventListener(PLUGINS_CHANGED_EVENT, onPluginsChanged);
  }, [isMissingParams, requestRefresh]);

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
  }, [lastRefreshLabel, normalizedSourcePath, pluginId, stylesheet?.scopedCss, view, viewType]);

  const activeFileLabel = view?.sourcePath || normalizedSourcePath || 'No active file context';
  const canRefresh = !loading && !isMissingParams;

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
                {view?.displayText || viewType || 'Plugin view'}
              </h1>
              <span className="shrink-0 rounded-md border border-success/30 bg-success/10 px-1.5 py-0.5 text-2xs font-medium text-success">
                Plugin View
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Obsidian custom view rendered through the MindOS plugin view host.
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
                <div className="flex min-h-44 items-center justify-center rounded-md border border-dashed border-border/80 text-sm text-muted-foreground">
                  This view did not render text content in the compatibility host.
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
