'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, ChevronDown } from 'lucide-react';
import type { MindSystemSlot } from '@/lib/mind-system';
import { useLocale } from '@/lib/stores/locale-store';
import { encodePath } from '@/lib/utils';

const MIND_SYSTEM_COLLAPSED_KEY = 'mindos.sidebar.mindSystemCollapsed';
const MIND_SYSTEM_SLOT_LIST_ID = 'mind-system-sidebar-slots';

export default function MindSystemSidebarSection({
  title,
  slots,
  activePathname,
  onOpen,
}: {
  title: string;
  slots: MindSystemSlot[];
  activePathname: string;
  onOpen: (path: string) => void;
}) {
  const { t } = useLocale();
  const [collapsed, setCollapsed] = useState(true);
  const visibleSlots = slots.length > 0 ? slots : [];

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(MIND_SYSTEM_COLLAPSED_KEY) !== '0');
    } catch { /* localStorage unavailable */ }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(MIND_SYSTEM_COLLAPSED_KEY, next ? '1' : '0');
      } catch { /* localStorage unavailable */ }
      return next;
    });
  }, []);

  if (visibleSlots.length === 0) return null;

  const activeSlotKey = visibleSlots.find((item) => {
    const slotHref = `/view/${encodePath(item.path)}`;
    return activePathname === slotHref || activePathname.startsWith(`${slotHref}/`);
  })?.key;
  const expanded = !collapsed;

  return (
    <section className="mb-2 px-1 pb-2 border-b border-border/40" aria-label={title}>
      <button
        type="button"
        onClick={toggleCollapsed}
        data-state={collapsed ? 'collapsed' : 'expanded'}
        data-hit-active={expanded || activeSlotKey ? 'true' : undefined}
        aria-expanded={!collapsed}
        aria-controls={MIND_SYSTEM_SLOT_LIST_ID}
        className="hit-target-box relative mb-1 flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-lg)] [--hit-target-border-width:1px] [--hit-target-border:transparent] [--hit-target-hover-bg:var(--muted)] [--hit-target-hover-border:color-mix(in_srgb,var(--border)_65%,transparent)] [--hit-target-active-bg:var(--amber-subtle)] [--hit-target-active-border:color-mix(in_srgb,var(--amber)_28%,transparent)]"
      >
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
          collapsed
            ? 'bg-[var(--amber)]/8 text-[var(--amber)]/70'
            : 'bg-[var(--amber)]/10 text-[var(--amber)]'
        }`}>
          <Activity size={15} strokeWidth={2.2} className="shrink-0 motion-safe:animate-pulse" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 py-0.5">
          <span className="block truncate text-xs font-semibold text-foreground">{title}</span>
        </span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-muted-foreground/60 transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`}
          aria-hidden="true"
        />
      </button>
      {!collapsed && (
        <div id={MIND_SYSTEM_SLOT_LIST_ID} className="space-y-0.5">
          {visibleSlots.map((item) => {
            const copy = t.home.mindPillars[item.key];
            const active = activeSlotKey === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onOpen(item.path)}
                data-mind-system-sidebar-open={item.key}
                data-hit-active={active ? 'true' : undefined}
                aria-current={active ? 'page' : undefined}
                className={`hit-target-box relative flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-radius:var(--radius-md)] [--hit-target-border-width:1px] [--hit-target-border:transparent] [--hit-target-hover-bg:var(--muted)] [--hit-target-hover-border:color-mix(in_srgb,var(--border)_60%,transparent)] [--hit-target-active-bg:var(--amber-subtle)] [--hit-target-active-border:color-mix(in_srgb,var(--amber)_24%,transparent)] ${
                  active
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border bg-background/40 text-[11px] font-semibold ${
                  active ? 'border-[var(--amber)]/35 text-[var(--amber)]' : 'border-border text-[var(--amber)]'
                }`}>
                  {item.label}
                </span>
                <span className="block min-w-0 flex-1 truncate">{copy?.desc ?? item.role}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
