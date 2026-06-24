'use client';

import type React from 'react';
import { Compass, Eye, EyeOff, LayoutGrid, Sparkles, Zap } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import {
  OPTIONAL_RAIL_ITEMS,
  useRailPreferences,
  writeRailPreference,
  type OptionalRailItem,
} from '@/lib/rail-preferences';
import { SettingCard, Toggle } from './Primitives';

const ITEM_META: Record<OptionalRailItem, { icon: React.ReactNode; detail: string }> = {
  studio: { icon: <Sparkles size={15} />, detail: 'Studio (/studio)' },
  apps: { icon: <LayoutGrid size={15} />, detail: 'Apps (/apps)' },
  flow: { icon: <Zap size={15} />, detail: 'Flow panel' },
};

export function NavigationTab() {
  const { t } = useLocale();
  const nav = t.settings.navigation;
  const preferences = useRailPreferences();

  const setPreference = (item: OptionalRailItem, enabled: boolean) => {
    writeRailPreference(item, enabled);
  };

  return (
    <div className="space-y-4">
      <SettingCard
        icon={<Compass size={15} />}
        title={nav.railTitle}
        description={nav.railDesc}
      >
        <div className="divide-y divide-border/60 rounded-lg border border-border/60 bg-background/45">
          {OPTIONAL_RAIL_ITEMS.map((item) => (
            <div
              key={item}
              className="flex items-center justify-between gap-4 px-3 py-3"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 ${
                    preferences[item]
                      ? 'bg-[var(--amber-subtle)] text-[var(--amber)]'
                      : 'bg-background/70 text-muted-foreground'
                  }`}
                  aria-hidden="true"
                >
                  {ITEM_META[item].icon}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-medium text-foreground">{nav.items[item].label}</div>
                    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {preferences[item] ? <Eye size={11} /> : <EyeOff size={11} />}
                      {preferences[item] ? nav.visible : nav.hidden}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {nav.items[item].description}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/70">
                    {nav.surfacePrefix} {ITEM_META[item].detail}
                  </p>
                </div>
              </div>
              <Toggle
                checked={preferences[item]}
                onChange={(checked) => setPreference(item, checked)}
                title={nav.items[item].label}
                ariaLabel={`${nav.items[item].label} ${nav.toggleSuffix}`}
              />
            </div>
          ))}
        </div>
      </SettingCard>

      <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {nav.hiddenHint}
        </p>
      </div>
    </div>
  );
}
