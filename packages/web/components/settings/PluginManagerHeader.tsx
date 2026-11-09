'use client';

import Link from 'next/link';
import { ExternalLink, Puzzle, type LucideIcon } from 'lucide-react';
import type { PluginsCopy } from './PluginsTabModel';
import type { PluginPanel } from './types';
import { SettingCard } from './Primitives';

export interface PluginManagerNavItem {
  id: PluginPanel;
  label: string;
  icon: LucideIcon;
  count?: number;
}

interface PluginManagerHeaderProps {
  copy: PluginsCopy;
  panel: PluginPanel;
  panels: PluginManagerNavItem[];
  onPanelChange: (panel: PluginPanel) => void;
}

export function PluginManagerHeader({
  copy,
  panel,
  panels,
  onPanelChange,
}: PluginManagerHeaderProps) {
  return (
    <SettingCard
      icon={<Puzzle size={15} />}
      title={copy.managerTitle}
      description={copy.managerSubtitle}
      bodyClassName="space-y-0"
    >
      <nav
        aria-label={copy.sectionNavLabel}
        className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border/70 bg-muted/25 p-1"
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
              className={`inline-flex h-8 min-w-0 shrink-0 items-center gap-2 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
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
    </SettingCard>
  );
}
