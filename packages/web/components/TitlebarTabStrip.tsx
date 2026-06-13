'use client';

/**
 * TitlebarTabStrip — the workspace tab strip hosted by TitlebarRow
 * (wiki/specs/spec-titlebar-row.md, Phase 2).
 *
 * Visuals: 34px tabs sitting on the row's bottom edge, rounded-t-lg, active
 * tab bg-card with top/side borders; FileText for docs, MessageSquare for
 * chat sessions (same icon the session history panel uses). Chat indicators
 * come from useRunSummary: spinner while running, amber dot when unread.
 *
 * Overflow: a ResizeObserver measures the strip container; visible count =
 * how many min-width (96px) tabs fit next to the ＋ button (plus the ⌄N
 * trigger when not everything fits). Hidden tabs live in a SyncPopover-style
 * fixed menu (z-50, ESC + outside-click close), running/unread first.
 *
 * Drag regions: the row background stays a drag area; every interactive
 * element opts out with WebkitAppRegion: no-drag. The ≥110px drag spacer at
 * the row's right end is reserved by TitlebarRow, not here.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, FileText, Loader2, MessageSquare, Pin, Plus, X } from 'lucide-react';
import { closeTab, keepTab, type WorkspaceTab } from '@/lib/workspace-tabs';
import { tabHref, useWorkspaceTabSync } from '@/hooks/useWorkspaceTabSync';
import { useLocale } from '@/lib/stores/locale-store';

const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

/** Geometry constants for the fit computation (px). */
export const TAB_MIN_W = 96;
const NEW_CHAT_W = 32; // ＋ button incl. its leading gap
const OVERFLOW_W = 48; // ⌄N trigger incl. its leading gap

/**
 * How many tabs are rendered inline. null width = not measured yet (first
 * paint, jsdom) → render everything and let flexbox shrink; the observer
 * corrects on the next frame.
 */
export function computeVisibleCount(containerWidth: number | null, tabCount: number): number {
  if (containerWidth === null || tabCount === 0) return tabCount;
  const availableWithoutOverflow = containerWidth - NEW_CHAT_W;
  if (tabCount * TAB_MIN_W <= availableWithoutOverflow) return tabCount;
  const available = availableWithoutOverflow - OVERFLOW_W;
  return Math.max(0, Math.min(tabCount, Math.floor(available / TAB_MIN_W)));
}

interface IndicatorProps {
  tab: WorkspaceTab;
  running: ReadonlySet<string>;
  unread: ReadonlySet<string>;
}

function TabIndicator({ tab, running, unread }: IndicatorProps) {
  if (tab.kind !== 'chat') return null;
  if (running.has(tab.key)) {
    return <Loader2 size={12} aria-hidden="true" data-indicator="running" className="shrink-0 animate-spin text-muted-foreground" />;
  }
  if (unread.has(tab.key)) {
    return <span aria-hidden="true" data-indicator="unread" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--amber)]" />;
  }
  return null;
}

export default function TitlebarTabStrip() {
  const { tabs, activeTabId, running, unread } = useWorkspaceTabSync();
  const router = useRouter();
  const { t } = useLocale();

  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const visibleCount = computeVisibleCount(containerWidth, tabs.length);
  const visibleTabs = tabs.slice(0, visibleCount);
  const hiddenTabs = tabs.slice(visibleCount);

  // Hidden tabs that demand attention surface first in the overflow menu.
  const hiddenSorted = useMemo(() => {
    const score = (tab: WorkspaceTab) => {
      if (tab.kind !== 'chat') return 2;
      if (running.has(tab.key)) return 0;
      if (unread.has(tab.key)) return 1;
      return 2;
    };
    return [...hiddenTabs].sort((a, b) => score(a) - score(b));
  }, [hiddenTabs, running, unread]);

  // Menu lifecycle: close when emptied, on ESC, and on outside click.
  useEffect(() => {
    if (menuOpen && hiddenTabs.length === 0) setMenuOpen(false);
  }, [menuOpen, hiddenTabs.length]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const timer = setTimeout(() => window.addEventListener('mousedown', onMouseDown), 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [menuOpen]);

  const navigate = useCallback((tab: WorkspaceTab) => {
    router.push(tabHref(tab));
  }, [router]);

  /** Close a tab; closing the ACTIVE one moves to the right neighbor, then left, then home. */
  const handleClose = useCallback((tab: WorkspaceTab) => {
    const index = tabs.findIndex((item) => item.id === tab.id);
    const wasActive = tab.id === activeTabId;
    closeTab(tab.id);
    if (!wasActive) return;
    const neighbor = (index >= 0 && tabs[index + 1]) || (index > 0 && tabs[index - 1]) || null;
    router.push(neighbor ? tabHref(neighbor) : '/');
  }, [tabs, activeTabId, router]);

  // Place routes: no active tab → the working set renders dimmed but intact
  // (indicators keep full opacity — a background run must stay noticeable).
  const dimmed = activeTabId === null;

  const renderTab = (tab: WorkspaceTab, index: number) => {
    const isActive = tab.id === activeTabId;
    const isPreview = tab.kind === 'doc' && tab.pinned === false;
    const previousTab = index > 0 ? visibleTabs[index - 1] : null;
    const showLeadingSeparator = Boolean(
      previousTab && previousTab.id !== activeTabId && tab.id !== activeTabId,
    );
    return (
      <div
        key={tab.id}
        role="tab"
        aria-selected={isActive}
        tabIndex={0}
        title={tab.title}
        data-titlebar-tab-preview={isPreview ? 'true' : undefined}
        data-titlebar-tab-separator={showLeadingSeparator ? 'true' : undefined}
        style={NO_DRAG}
        onClick={() => navigate(tab)}
        onDoubleClick={() => {
          if (isPreview) keepTab(tab.id);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            navigate(tab);
          }
        }}
        onMouseDown={(e) => {
          // Middle-click closes; preventDefault stops autoscroll on mousedown.
          if (e.button === 1) e.preventDefault();
        }}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            handleClose(tab);
          }
        }}
        className={`group relative flex h-[34px] min-w-[96px] max-w-[180px] shrink cursor-pointer select-none items-center gap-1.5 self-end rounded-t-lg border-x border-t px-2.5 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
          showLeadingSeparator
            ? "before:pointer-events-none before:absolute before:-left-0.5 before:top-1/2 before:h-4 before:w-px before:-translate-y-1/2 before:rounded-full before:bg-border/60 before:content-['']"
            : ''
        } ${
          isActive
            ? 'border-border bg-card text-foreground'
            : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
        }`}
      >
        <span className={`flex min-w-0 flex-1 items-center gap-1.5 ${dimmed ? 'opacity-60' : ''}`}>
          {tab.kind === 'doc'
            ? <FileText size={13} aria-hidden="true" className="shrink-0" />
            : <MessageSquare size={13} aria-hidden="true" className="shrink-0" />}
          <span className={`truncate ${isPreview ? 'italic' : ''}`}>{tab.title}</span>
        </span>
        <TabIndicator tab={tab} running={running} unread={unread} />
        {isPreview && (
          <button
            type="button"
            aria-label={t.workspaceTabs.keepTab}
            title={t.workspaceTabs.keepTab}
            style={NO_DRAG}
            onClick={(e) => {
              e.stopPropagation();
              keepTab(tab.id);
            }}
            className="shrink-0 rounded p-0.5 text-muted-foreground/70 transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Pin size={12} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          aria-label={t.workspaceTabs.closeTab}
          style={NO_DRAG}
          onClick={(e) => {
            e.stopPropagation();
            handleClose(tab);
          }}
          className={`shrink-0 rounded p-0.5 transition-opacity duration-150 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          }`}
        >
          <X size={12} aria-hidden="true" />
        </button>
      </div>
    );
  };

  return (
    <div ref={containerRef} className="flex min-w-0 flex-1 items-end overflow-hidden">
      <div role="tablist" className="flex min-w-0 items-end gap-1">
        {visibleTabs.map(renderTab)}
      </div>

      {hiddenTabs.length > 0 && (
        <button
          type="button"
          style={NO_DRAG}
          aria-label={t.workspaceTabs.moreTabs(hiddenTabs.length)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-overflow-trigger
          onClick={(e) => {
            setMenuAnchor(e.currentTarget.getBoundingClientRect());
            setMenuOpen((open) => !open);
          }}
          className="mb-1 ml-1 flex h-7 shrink-0 items-center gap-0.5 self-end rounded-full px-1.5 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown size={13} aria-hidden="true" />
          {hiddenTabs.length}
        </button>
      )}

      <button
        type="button"
        style={NO_DRAG}
        title={t.workspaceTabs.newChat}
        aria-label={t.workspaceTabs.newChat}
        onClick={() => router.push('/chat/new')}
        className="mb-1 ml-1 flex h-7 w-7 shrink-0 items-center justify-center self-end rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus size={15} aria-hidden="true" />
      </button>

      {menuOpen && menuAnchor && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t.workspaceTabs.overflowMenuTitle}
          className="fixed z-50 w-64 rounded-lg border border-border bg-background py-1 shadow-lg"
          style={{
            top: menuAnchor.bottom + 4,
            left: Math.max(8, Math.min(menuAnchor.left, (typeof window === 'undefined' ? 0 : window.innerWidth) - 264)),
            ...NO_DRAG,
          }}
        >
          <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t.workspaceTabs.overflowMenuTitle}
          </div>
          {hiddenSorted.map((tab) => (
            <div key={tab.id} role="menuitem" className="flex items-center gap-1 px-1.5 py-0.5">
              <button
                type="button"
                title={tab.title}
                data-titlebar-tab-preview={tab.pinned === false ? 'true' : undefined}
                onClick={() => {
                  setMenuOpen(false);
                  navigate(tab);
                }}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {tab.kind === 'doc'
                  ? <FileText size={13} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                  : <MessageSquare size={13} aria-hidden="true" className="shrink-0 text-muted-foreground" />}
                <span className={`truncate ${tab.pinned === false ? 'italic' : ''}`}>{tab.title}</span>
                <TabIndicator tab={tab} running={running} unread={unread} />
              </button>
              {tab.kind === 'doc' && tab.pinned === false && (
                <button
                  type="button"
                  aria-label={t.workspaceTabs.keepTab}
                  title={t.workspaceTabs.keepTab}
                  onClick={() => keepTab(tab.id)}
                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Pin size={12} aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                aria-label={t.workspaceTabs.closeTab}
                onClick={() => handleClose(tab)}
                className="shrink-0 rounded p-1 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
