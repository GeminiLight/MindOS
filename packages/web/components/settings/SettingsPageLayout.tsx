'use client';

import type { ReactNode } from 'react';
import { shouldHandleSmoothNavigation } from '@/hooks/useSmoothRouterPush';
import { Select } from './Primitives';
import type { Tab } from './types';

type Category = { id: Tab; label: string; icon: ReactNode; badge?: boolean; group: string };

/** Full-page settings use workspace navigation, independently of the floating panel. */
export function SettingsPageLayout({ title, categoryLabel, groups, categories, activeTab, onChange, status, children, footer }: {
  title: string;
  categoryLabel: string;
  groups: readonly { id: string; label: string }[];
  categories: Category[];
  activeTab: Tab;
  onChange: (tab: Tab) => void;
  status: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  const selected = categories.find(item => item.id === activeTab);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-5 md:px-8 md:py-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {status}
      </header>
      <div className="shrink-0 border-b border-border px-5 py-3 md:hidden">
        <label htmlFor="settings-page-category" className="mb-2 block text-xs font-medium text-muted-foreground">{categoryLabel}</label>
        <Select
          id="settings-page-category"
          aria-label={categoryLabel}
          value={activeTab}
          onChange={event => onChange(event.target.value as Tab)}
          className="w-full [&>button]:min-h-11"
        >
          {categories.map(item => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </Select>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav aria-label={categoryLabel} className="hidden w-52 shrink-0 overflow-y-auto border-r border-border px-3 py-6 md:block">
          {groups.map(group => (
            <div key={group.id} className="mb-7 last:mb-0">
              <p className="mb-2 px-3 text-xs font-medium text-muted-foreground">{group.label}</p>
              <div className="space-y-1">
                {categories.filter(item => item.group === group.id).map(item => (
                  <a
                    key={item.id}
                    href={`/settings?tab=${item.id}`}
                    aria-current={activeTab === item.id ? 'page' : undefined}
                    onClick={event => {
                      if (!shouldHandleSmoothNavigation(event)) return;
                      event.preventDefault();
                      onChange(item.id);
                    }}
                    className={`flex min-h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeTab === item.id
                      ? 'bg-[var(--amber-subtle)] font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                  >
                    <span aria-hidden="true" className="shrink-0">{item.icon}</span>
                    <span>{item.label}</span>
                    {item.badge && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-error" />}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <section aria-label={selected?.label} className="flex min-h-0 min-w-0 flex-1 flex-col">
          {children}
          {footer}
        </section>
      </div>
    </div>
  );
}
