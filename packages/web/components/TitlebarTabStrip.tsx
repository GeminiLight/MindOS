'use client';

/**
 * TitlebarTabStrip — the workspace tab strip hosted by TitlebarRow
 * (wiki/specs/spec-titlebar-row.md, Phase 2).
 *
 * Visuals: 34px tabs sitting on the row's bottom edge, rounded-t-lg, active
 * tab bg-card with top/side borders; Home for the product start page, FileText
 * for docs, and agent-runtime avatars for chat sessions. Chat indicators come
 * from useRunSummary: spinner while running, amber dot when unread.
 *
 * Overflow: a ResizeObserver measures the strip container; visible count =
 * how many min-width (76px) tabs fit next to the ＋ button (plus the ⌄N
 * trigger when not everything fits). Hidden tabs live in a SyncPopover-style
 * fixed menu (z-50, ESC + outside-click close), running/unread first.
 *
 * Drag regions: the row background stays a drag area; every interactive
 * element opts out with WebkitAppRegion: no-drag. The ≥110px drag spacer at
 * the row's right end is reserved by TitlebarRow, not here.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronDown, FileText, Home as HomeIcon, Loader2, Network, Pin, Plus, X } from 'lucide-react';
import { closeTabs, keepTab, type WorkspaceTab } from '@/lib/workspace-tabs';
import { tabHref, useWorkspaceTabSync } from '@/hooks/useWorkspaceTabSync';
import { useLocale } from '@/lib/stores/locale-store';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import { StableRowTrailingSlot } from '@/components/shared/StableRowChrome';
import { FLOATING_SURFACE_CLASS } from '@/components/shared/FloatingSurface';
import {
  requestAskPanelNewSessionActivation,
  requestAskPanelSessionActivation,
} from '@/lib/ask-panel-session-activation';
import type { AgentRuntimeIdentity } from '@/lib/types';

const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

/** Geometry constants for the fit computation (px). */
export const TAB_MIN_W = 76;
const HOME_LAUNCHER_W = 32; // Home button incl. its trailing gap
const NEW_CHAT_W = 32; // ＋ button incl. its leading gap
const OVERFLOW_W = 48; // ⌄N trigger incl. its leading gap

/**
 * How many tabs are rendered inline. null width = not measured yet (first
 * paint, jsdom) → render everything and let flexbox shrink; the observer
 * corrects on the next frame.
 */
export function computeVisibleCount(containerWidth: number | null, tabCount: number): number {
  if (containerWidth === null || tabCount === 0) return tabCount;
  const availableWithoutOverflow = containerWidth - HOME_LAUNCHER_W - NEW_CHAT_W;
  if (tabCount * TAB_MIN_W <= availableWithoutOverflow) return tabCount;
  const available = availableWithoutOverflow - OVERFLOW_W;
  return Math.max(0, Math.min(tabCount, Math.floor(available / TAB_MIN_W)));
}

export interface VisibleTabRange {
  start: number;
  end: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeVisibleRange(
  containerWidth: number | null,
  tabCount: number,
  activeIndex: number | null,
): VisibleTabRange {
  const count = computeVisibleCount(containerWidth, tabCount);
  if (count >= tabCount) return { start: 0, end: tabCount };
  if (count <= 0) return { start: tabCount, end: tabCount };
  if (activeIndex === null || activeIndex < 0 || activeIndex >= tabCount) {
    const start = Math.max(0, tabCount - count);
    return { start, end: start + count };
  }
  const start = clamp(activeIndex - Math.floor((count - 1) / 2), 0, tabCount - count);
  return { start, end: start + count };
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

function knownAgentIconSrc(runtime: AgentRuntimeIdentity | null | undefined): string | null {
  if (!runtime || runtime.kind === 'mindos') return '/agent-icons/mindos.svg';
  if (runtime.kind === 'codex') return '/agent-icons/openai.svg';
  if (runtime.kind === 'claude') return '/agent-icons/claude.svg';
  const haystack = `${runtime.id} ${runtime.name}`.toLowerCase();
  const candidates: Array<[string, string]> = [
    ['gemini', '/agent-icons/gemini.svg'],
    ['kimi', '/agent-icons/kimi-cli.png'],
    ['cursor', '/agent-icons/cursor.svg'],
    ['copilot', '/agent-icons/github-copilot.svg'],
    ['qwen', '/agent-icons/qwen-code.svg'],
    ['opencode', '/agent-icons/opencode.svg'],
    ['openclaw', '/agent-icons/openclaw.svg'],
    ['cline', '/agent-icons/cline.svg'],
    ['windsurf', '/agent-icons/windsurf.svg'],
    ['trae', '/agent-icons/trae.png'],
    ['roo', '/agent-icons/roo.svg'],
  ];
  return candidates.find(([needle]) => haystack.includes(needle))?.[1] ?? null;
}

function TabAgentMark({
  runtime,
  className = 'shrink-0',
}: {
  runtime?: AgentRuntimeIdentity | null;
  className?: string;
}) {
  const src = knownAgentIconSrc(runtime);
  const runtimeKind = runtime?.kind ?? 'mindos';
  const title = runtime?.name ?? 'MindOS';
  const baseClass = `inline-flex h-4 w-4 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-background/85 ${className}`;
  if (src) {
    return (
      <span className={baseClass} title={title} data-titlebar-agent-kind={runtimeKind}>
        <img src={src} alt="" aria-hidden="true" className="h-3 w-3 object-contain" />
      </span>
    );
  }
  return (
    <span className={`${baseClass} text-[var(--tool-read)]`} title={title} data-titlebar-agent-kind={runtimeKind}>
      <Network size={11} aria-hidden="true" />
    </span>
  );
}

function TabKindIcon({
  tab,
  runtime,
  className = 'shrink-0',
}: {
  tab: WorkspaceTab;
  runtime?: AgentRuntimeIdentity | null;
  className?: string;
}) {
  if (tab.kind === 'home') return <HomeIcon size={13} aria-hidden="true" className={className} />;
  if (tab.kind === 'doc') return <FileText size={13} aria-hidden="true" className={className} />;
  return <TabAgentMark runtime={runtime} className={className} />;
}

export default function TitlebarTabStrip() {
  const { tabs, activeTabId, running, unread, sessionAgents } = useWorkspaceTabSync();
  const pathname = usePathname();
  const smoothPush = useSmoothRouterPush();
  const { t } = useLocale();

  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const [pendingRoute, setPendingRoute] = useState<{ href: string; tabId: string | null; fromPathname: string } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Place routes: no active tab → the working set renders dimmed but intact
  // (indicators keep full opacity — a background run must stay noticeable).
  const optimisticTabId = pendingRoute?.fromPathname === pathname ? pendingRoute.tabId : activeTabId;
  const dimmed = optimisticTabId === null;
  const homeLauncherActive = pathname === '/' || (pendingRoute?.fromPathname === pathname && pendingRoute.href === '/');
  const activeTabIndex = optimisticTabId ? tabs.findIndex((tab) => tab.id === optimisticTabId) : null;
  const visibleRange = computeVisibleRange(containerWidth, tabs.length, activeTabIndex);
  const visibleTabs = tabs.slice(visibleRange.start, visibleRange.end);
  const hiddenTabs = tabs.filter((_, index) => index < visibleRange.start || index >= visibleRange.end);
  const tabIndexById = useMemo(() => new Map(tabs.map((tab, index) => [tab.id, index])), [tabs]);

  // Hidden tabs that demand attention surface first in the overflow menu.
  const hiddenSorted = useMemo(() => {
    const score = (tab: WorkspaceTab) => {
      if (tab.kind !== 'chat') return 2;
      if (running.has(tab.key)) return 0;
      if (unread.has(tab.key)) return 1;
      return 2;
    };
    return [...hiddenTabs].sort((a, b) => {
      const byScore = score(a) - score(b);
      if (byScore !== 0) return byScore;
      return (tabIndexById.get(a.id) ?? 0) - (tabIndexById.get(b.id) ?? 0);
    });
  }, [hiddenTabs, running, unread, tabIndexById]);
  const contextTab = contextMenu ? tabs.find((tab) => tab.id === contextMenu.tabId) ?? null : null;

  // Menu lifecycle: close when emptied, on ESC, and on outside click.
  useEffect(() => {
    if (menuOpen && hiddenTabs.length === 0) setMenuOpen(false);
  }, [menuOpen, hiddenTabs.length]);

  useEffect(() => {
    if (!menuOpen && !contextMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen(false);
        setContextMenu(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen, contextMenu]);

  useEffect(() => {
    if (!menuOpen && !contextMenu) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || contextMenuRef.current?.contains(target)) return;
      setMenuOpen(false);
      setContextMenu(null);
    };
    const timer = setTimeout(() => window.addEventListener('mousedown', onMouseDown), 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [menuOpen, contextMenu]);

  useEffect(() => {
    setPendingRoute((pending) => (pending && pending.fromPathname !== pathname ? null : pending));
  }, [pathname]);

  const scheduleNavigation = useCallback((href: string, tabId: string | null) => {
    setMenuOpen(false);
    setContextMenu(null);
    if (href === pathname) {
      setPendingRoute(null);
      return;
    }
    setPendingRoute({ href, tabId, fromPathname: pathname });
    smoothPush(href);
  }, [pathname, smoothPush]);

  const navigate = useCallback((tab: WorkspaceTab) => {
    setMenuOpen(false);
    setContextMenu(null);
    if (tab.kind === 'chat' && requestAskPanelSessionActivation(tab.key)) {
      setPendingRoute(null);
      return;
    }
    scheduleNavigation(tabHref(tab), tab.id);
  }, [scheduleNavigation]);

  const handleNewChat = useCallback(() => {
    setMenuOpen(false);
    setContextMenu(null);
    if (requestAskPanelNewSessionActivation({ source: 'titlebar-new' })) {
      setPendingRoute(null);
      return;
    }
    scheduleNavigation('/chat/new', null);
  }, [scheduleNavigation]);

  const navigateHome = useCallback(() => {
    scheduleNavigation('/', null);
  }, [scheduleNavigation]);

  /** Close a tab; closing the ACTIVE one moves to the right neighbor, then left, then home. */
  const handleCloseIds = useCallback((ids: Iterable<string>, preferredFallback?: WorkspaceTab | null) => {
    const targetIds = new Set(ids);
    if (targetIds.size === 0) return;
    setMenuOpen(false);
    setContextMenu(null);
    const activeId = pendingRoute?.fromPathname === pathname ? pendingRoute.tabId : activeTabId;
    const activeIndex = activeId ? tabs.findIndex((item) => item.id === activeId) : -1;
    const fallback = preferredFallback && !targetIds.has(preferredFallback.id)
      ? preferredFallback
      : (
          activeIndex >= 0
            ? tabs.slice(activeIndex + 1).find((item) => !targetIds.has(item.id))
              ?? [...tabs.slice(0, activeIndex)].reverse().find((item) => !targetIds.has(item.id))
              ?? null
            : null
        );
    closeTabs(targetIds);
    if (activeId && targetIds.has(activeId)) {
      scheduleNavigation(fallback ? tabHref(fallback) : '/', fallback?.id ?? null);
    }
  }, [tabs, activeTabId, pendingRoute, pathname, scheduleNavigation]);

  const handleClose = useCallback((tab: WorkspaceTab) => {
    if (tab.kind === 'home') return;
    handleCloseIds([tab.id]);
  }, [handleCloseIds]);

  const handleCloseTabsToLeft = useCallback((tab: WorkspaceTab) => {
    const index = tabs.findIndex((item) => item.id === tab.id);
    if (index <= 0) return;
    handleCloseIds(tabs.slice(0, index).map((item) => item.id), tab);
  }, [tabs, handleCloseIds]);

  const handleCloseTabsToRight = useCallback((tab: WorkspaceTab) => {
    const index = tabs.findIndex((item) => item.id === tab.id);
    if (index < 0 || index >= tabs.length - 1) return;
    handleCloseIds(tabs.slice(index + 1).map((item) => item.id), tab);
  }, [tabs, handleCloseIds]);

  const handleCloseOtherTabs = useCallback((tab: WorkspaceTab) => {
    handleCloseIds(tabs.filter((item) => item.id !== tab.id).map((item) => item.id), tab);
  }, [tabs, handleCloseIds]);

  const handleCloseKind = useCallback((kind: 'doc' | 'chat') => {
    const ids = tabs.filter((tab) => tab.kind === kind).map((tab) => tab.id);
    handleCloseIds(ids);
  }, [tabs, handleCloseIds]);

  const renderTab = (tab: WorkspaceTab, index: number) => {
    const isActive = tab.id === optimisticTabId;
    const isPreview = tab.pinned === false;
    const canClose = tab.kind !== 'home';
    const hasIndicator = tab.kind === 'chat' && (running.has(tab.key) || unread.has(tab.key));
    const previousTab = index > 0 ? visibleTabs[index - 1] : null;
    const showLeadingSeparator = Boolean(
      previousTab && previousTab.id !== optimisticTabId && tab.id !== optimisticTabId,
    );
    const runtime = tab.kind === 'chat' ? sessionAgents.get(tab.key) ?? null : null;
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
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(false);
          setContextMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
        }}
        className={`group relative flex h-[34px] min-w-[76px] max-w-[184px] flex-1 shrink cursor-pointer select-none items-center gap-1.5 self-end rounded-t-lg border-x border-t px-2.5 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
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
          <TabKindIcon tab={tab} runtime={runtime} />
          <span className={`truncate ${isPreview ? 'italic' : ''}`}>{tab.title}</span>
        </span>
        <StableRowTrailingSlot
          reserveClassName={isPreview ? 'w-10' : 'w-5'}
          className="h-5"
          forceActionsVisible={isActive && !hasIndicator}
          status={hasIndicator ? <TabIndicator tab={tab} running={running} unread={unread} /> : null}
          actionsClassName="gap-0"
          actions={(
            <>
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
              {canClose && (
                <button
                  type="button"
                  aria-label={t.workspaceTabs.closeTab}
                  style={NO_DRAG}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClose(tab);
                  }}
                  className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </>
          )}
        />
      </div>
    );
  };

  return (
    <div ref={containerRef} className="flex min-w-0 flex-1 items-end overflow-hidden">
      <button
        type="button"
        style={NO_DRAG}
        title={t.workspaceTabs.homeTab}
        aria-label={t.workspaceTabs.homeTab}
        data-titlebar-home-button
        onClick={navigateHome}
        className={`mb-1 mr-1 flex h-7 w-7 shrink-0 items-center justify-center self-end rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          homeLauncherActive
            ? 'bg-[var(--amber-dim)] text-[var(--amber)]'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        <HomeIcon size={15} aria-hidden="true" />
      </button>

      <div role="tablist" className="flex min-w-0 flex-1 items-end gap-1">
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
        onClick={handleNewChat}
        className="mb-1 ml-1 flex h-7 w-7 shrink-0 items-center justify-center self-end rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus size={15} aria-hidden="true" />
      </button>

      {menuOpen && menuAnchor && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t.workspaceTabs.overflowMenuTitle}
          className={`${FLOATING_SURFACE_CLASS} w-64 py-1`}
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
                <TabKindIcon tab={tab} runtime={tab.kind === 'chat' ? sessionAgents.get(tab.key) ?? null : null} className="shrink-0 text-muted-foreground" />
                <span className={`truncate ${tab.pinned === false ? 'italic' : ''}`}>{tab.title}</span>
                <TabIndicator tab={tab} running={running} unread={unread} />
              </button>
              {tab.pinned === false && (
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
              {tab.kind !== 'home' && (
                <button
                  type="button"
                  aria-label={t.workspaceTabs.closeTab}
                  onClick={() => handleClose(tab)}
                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
          <div className="mt-1 border-t border-border/70 px-1.5 py-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => handleCloseKind('doc')}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t.workspaceTabs.closeFileTabs}
              <span className="tabular-nums">{tabs.filter((tab) => tab.kind === 'doc').length}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => handleCloseKind('chat')}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t.workspaceTabs.closeSessionTabs}
              <span className="tabular-nums">{tabs.filter((tab) => tab.kind === 'chat').length}</span>
            </button>
          </div>
        </div>
      )}

      {contextMenu && contextTab && (
        <div
          ref={contextMenuRef}
          role="menu"
          aria-label={t.workspaceTabs.tabActions}
          className={`${FLOATING_SURFACE_CLASS} w-56 py-1`}
          style={{
            top: Math.max(8, Math.min(contextMenu.y, (typeof window === 'undefined' ? 0 : window.innerHeight) - 260)),
            left: Math.max(8, Math.min(contextMenu.x, (typeof window === 'undefined' ? 0 : window.innerWidth) - 232)),
            ...NO_DRAG,
          }}
        >
          <div className="truncate px-3 py-1.5 text-xs font-medium text-muted-foreground">
            {contextTab.title}
          </div>
          {contextTab.pinned === false && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                keepTab(contextTab.id);
                setContextMenu(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Pin size={12} aria-hidden="true" />
              {t.workspaceTabs.keepTab}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => handleClose(contextTab)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={12} aria-hidden="true" />
            {t.workspaceTabs.closeTab}
          </button>
          <div className="my-1 border-t border-border/70" />
          <button
            type="button"
            role="menuitem"
            onClick={() => handleCloseTabsToLeft(contextTab)}
            className="flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
            disabled={(tabIndexById.get(contextTab.id) ?? 0) <= 0}
          >
            {t.workspaceTabs.closeTabsToLeft}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => handleCloseTabsToRight(contextTab)}
            className="flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
            disabled={(tabIndexById.get(contextTab.id) ?? tabs.length - 1) >= tabs.length - 1}
          >
            {t.workspaceTabs.closeTabsToRight}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => handleCloseOtherTabs(contextTab)}
            className="flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
            disabled={tabs.length <= 1}
          >
            {t.workspaceTabs.closeOtherTabs}
          </button>
          <div className="my-1 border-t border-border/70" />
          <button
            type="button"
            role="menuitem"
            onClick={() => handleCloseKind('doc')}
            className="flex w-full items-center px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t.workspaceTabs.closeFileTabs}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => handleCloseKind('chat')}
            className="flex w-full items-center px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t.workspaceTabs.closeSessionTabs}
          </button>
        </div>
      )}
    </div>
  );
}
