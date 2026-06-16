'use client';

import Link from 'next/link';
import { ExternalLink, type LucideIcon } from 'lucide-react';
import type { PluginsCopy } from './PluginsTabModel';
import type { PluginPanel } from './types';

interface PluginManagerStats {
  total: number;
  obsidian: number;
  surfaces: number;
}

export interface PluginManagerNavItem {
  id: PluginPanel;
  label: string;
  icon: LucideIcon;
  count?: number;
}

interface PluginManagerHeaderProps {
  copy: PluginsCopy;
  managerStats: PluginManagerStats;
  panel: PluginPanel;
  panels: PluginManagerNavItem[];
  onPanelChange: (panel: PluginPanel) => void;
}

export function PluginManagerHeader({
  copy,
  managerStats,
  panel,
  panels,
  onPanelChange,
}: PluginManagerHeaderProps) {
  return (
    <header className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-muted-foreground">{copy.title}</p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">{copy.managerTitle}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{copy.managerSubtitle}</p>
        </div>

        <div className="flex min-w-0 flex-col items-stretch gap-2 sm:items-end">
          <Link
            href="/explore/plugins"
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLink size={13} />
            {copy.browseMarketAction}
          </Link>
          <div className="grid min-w-0 grid-cols-3 overflow-hidden rounded-xl border border-border bg-card/50 text-center sm:min-w-72">
            <div className="px-3 py-2">
              <div className="font-mono text-sm font-semibold tabular-nums text-foreground">{managerStats.total}</div>
              <div className="text-2xs text-muted-foreground">{copy.pluginsMetric}</div>
            </div>
            <div className="border-l border-border px-3 py-2">
              <div className="font-mono text-sm font-semibold tabular-nums text-[var(--amber-text)]">{managerStats.obsidian}</div>
              <div className="text-2xs text-muted-foreground">{copy.obsidianMetric}</div>
            </div>
            <div className="border-l border-border px-3 py-2">
              <div className="font-mono text-sm font-semibold tabular-nums text-foreground">{managerStats.surfaces}</div>
              <div className="text-2xs text-muted-foreground">{copy.surfacesMetric}</div>
            </div>
          </div>
        </div>
      </div>

      <nav
        aria-label={copy.sectionNavLabel}
        className="inline-flex max-w-full overflow-hidden rounded-xl border border-border bg-muted/30 p-1"
      >
        {panels.map((item) => {
          const Icon = item.icon;
          const active = panel === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => onPanelChange(item.id)}
              className={`inline-flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                active
                  ? 'bg-background text-foreground shadow-[0_1px_2px_0_color-mix(in_srgb,var(--foreground)_8%,transparent)]'
                  : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
              }`}
            >
              <Icon size={14} className={active ? 'text-[var(--amber)]' : 'text-muted-foreground'} />
              <span className="truncate">{item.label}</span>
              {typeof item.count === 'number' && (
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground tabular-nums">
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
