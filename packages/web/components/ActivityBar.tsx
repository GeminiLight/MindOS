'use client';

import { useRef, useCallback, useState, useEffect, useTransition, type CSSProperties } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Brain, Settings, RefreshCw, Bot, Compass, ChevronLeft, ChevronRight, Radio, Zap, Inbox, Puzzle, DraftingCompass } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { DOT_COLORS, getStatusLevel } from './SyncStatusBar';
import type { SyncStatus } from './settings/types';
import Logo from './Logo';
import {
  ROUTE_PANEL_HREF,
  getRailActivePanel,
  getRailPanelClickDecision,
  isContentRouteForPanel,
  type PanelId,
  type RoutePanelId,
} from '@/lib/navigation-panel';
import { ACTIVITY_BAR } from '@/lib/config/panel-sizes';
import { shouldHandleSmoothNavigation, useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import { useRailPreferences } from '@/lib/rail-preferences';

export const RAIL_WIDTH_COLLAPSED = ACTIVITY_BAR.WIDTH_COLLAPSED;
export const RAIL_WIDTH_EXPANDED = ACTIVITY_BAR.WIDTH_EXPANDED;

interface ActivityBarProps {
  activePanel: PanelId | null;
  suppressRouteActive?: boolean;
  onPanelChange: (id: PanelId | null) => void;
  onCaptureClick?: React.MouseEventHandler<HTMLAnchorElement | HTMLButtonElement>;
  onEchoClick?: React.MouseEventHandler<HTMLAnchorElement | HTMLButtonElement>;
  onAgentsClick?: React.MouseEventHandler<HTMLAnchorElement | HTMLButtonElement>;
  onDiscoverClick?: React.MouseEventHandler<HTMLAnchorElement | HTMLButtonElement>;
  onStudioClick?: React.MouseEventHandler<HTMLAnchorElement | HTMLButtonElement>;
  onWorkflowsClick?: React.MouseEventHandler<HTMLAnchorElement | HTMLButtonElement>;
  onSpacesClick?: React.MouseEventHandler<HTMLAnchorElement | HTMLButtonElement>;
  onHomeClick?: React.MouseEventHandler<HTMLAnchorElement>;
  syncStatus: SyncStatus | null;
  syncStale?: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSettingsClick: () => void;
  onPluginEntriesClick?: () => void;
  pluginEntriesAvailable?: boolean;
  onSyncClick: (rect: DOMRect) => void;
  syncPopoverOpen?: boolean;
  syncPopoverId?: string;
}

interface RailButtonProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  current?: boolean;
  expanded: boolean;
  href?: string;
  onClick: React.MouseEventHandler<HTMLAnchorElement | HTMLButtonElement>;
  onNavigate?: (event: { preventDefault: () => void }) => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
  pressed?: boolean;
  ariaControls?: string;
  ariaExpanded?: boolean;
  ariaHaspopup?: 'dialog' | 'menu';
  /** Optional overlay badge (e.g. status dot) rendered inside the button */
  badge?: React.ReactNode;
  /** Optional data-walkthrough attribute for interactive walkthrough targeting */
  walkthroughId?: string;
}

function RailButton({
  icon,
  label,
  shortcut,
  active = false,
  current = false,
  expanded,
  href,
  onClick,
  onNavigate,
  buttonRef,
  pressed,
  ariaControls,
  ariaExpanded,
  ariaHaspopup,
  badge,
  walkthroughId,
}: RailButtonProps) {
  const tooltipText = shortcut ? `${label} (${shortcut})` : label;
  const buttonClassName = `
    hit-target-box relative flex items-center ${expanded ? 'justify-start px-3 w-full' : 'justify-center w-10'} h-10 transition-colors [--hit-target-hover-bg:var(--muted)] [--hit-target-active-bg:var(--amber-dim)] [--hit-target-radius:var(--radius-md)]
    ${active
      ? 'text-[var(--amber)]'
      : 'text-muted-foreground hover:text-foreground'
    }
    focus-visible:ring-2 focus-visible:ring-ring
  `;
  const buttonContent = (
    <>
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-[18px] rounded-r-full bg-[var(--amber)]" />
      )}
      <span className="shrink-0 flex items-center justify-center w-[18px]">{icon}</span>
      {badge}
      {expanded && (
        <>
          <span className="ml-2.5 text-sm whitespace-nowrap">{label}</span>
          {shortcut && (
            <span className="ml-auto text-2xs text-muted-foreground/60 font-mono shrink-0">{shortcut}</span>
          )}
        </>
      )}
    </>
  );

  const handleLinkClick: React.MouseEventHandler<HTMLAnchorElement> = (event) => {
    onClick(event);
  };

  const commonProps = {
    'aria-label': label,
    title: expanded ? undefined : tooltipText,
    'data-walkthrough': walkthroughId,
    'data-hit-active': active ? 'true' : undefined,
    className: buttonClassName,
  };

  if (href) {
    return (
      <Link
        href={href}
        onClick={handleLinkClick}
        onNavigate={onNavigate}
        aria-current={current ? 'page' : undefined}
        {...commonProps}
      >
        {buttonContent}
      </Link>
    );
  }

  return (
    <button
      type="button"
      ref={buttonRef}
      onClick={onClick}
      aria-pressed={pressed}
      aria-controls={ariaControls}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHaspopup}
      {...commonProps}
    >
      {buttonContent}
    </button>
  );
}

export default function ActivityBar({
  activePanel,
  suppressRouteActive = false,
  onPanelChange,
  onCaptureClick,
  onEchoClick,
  onAgentsClick,
  onDiscoverClick,
  onStudioClick,
  onWorkflowsClick,
  onSpacesClick,
  onHomeClick,
  syncStatus,
  syncStale,
  expanded,
  onExpandedChange,
  onSettingsClick,
  onPluginEntriesClick,
  pluginEntriesAvailable = false,
  onSyncClick,
  syncPopoverOpen = false,
  syncPopoverId = 'sync-popover',
}: ActivityBarProps) {
  const lastClickRef = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const syncBtnRef = useRef<HTMLButtonElement>(null);
  const { t } = useLocale();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const router = useRouter();
  const smoothPush = useSmoothRouterPush();
  const isHome = pathname === '/';
  const railPreferences = useRailPreferences();
  const activeDestination = suppressRouteActive ? activePanel : getRailActivePanel(pathname, activePanel);
  const isCurrentRouteForPanel = useCallback((panel: RoutePanelId) => (
    !suppressRouteActive && isContentRouteForPanel(pathname, panel)
  ), [pathname, suppressRouteActive]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    const timer = window.setTimeout(() => {
      router.prefetch('/capture');
      router.prefetch('/wiki');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [router]);

  // Update badge: Desktop → electron-updater IPC; Browser → npm registry check
  const [hasUpdate, setHasUpdate] = useState(false);
  useEffect(() => {
    const bridge = typeof window !== 'undefined'
      ? (window as unknown as { mindos?: { checkUpdate?: () => Promise<{ available: boolean }>; onUpdateAvailable?: (cb: () => void) => () => void } }).mindos
      : undefined;

    if (bridge?.checkUpdate) {
      const doCheck = bridge.checkUpdate.bind(bridge);
      const timer = setTimeout(async () => {
        try {
          const r = await doCheck();
          if (r.available) setHasUpdate(true);
        } catch { /* silent */ }
      }, 10_000);
      const cleanup = bridge.onUpdateAvailable?.(() => setHasUpdate(true));
      return () => { clearTimeout(timer); cleanup?.(); };
    }

    // Browser/CLI: check npm registry
    const dismissed = localStorage.getItem('mindos_update_dismissed');
    const latest = localStorage.getItem('mindos_update_latest');
    if (latest && latest !== dismissed) { setHasUpdate(true); }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/update-check', { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return;
        const data = await res.json();
        if (!data.hasUpdate) {
          localStorage.removeItem('mindos_update_latest');
          localStorage.removeItem('mindos_update_dismissed');
          setHasUpdate(false);
          return;
        }
        const d = localStorage.getItem('mindos_update_dismissed');
        if (data.latest === d) return;
        localStorage.setItem('mindos_update_latest', data.latest);
        setHasUpdate(true);
      } catch { /* silent */ }
    }, 5000);
    const onAvail = () => setHasUpdate(true);
    const onDismiss = () => setHasUpdate(false);
    window.addEventListener('mindos:update-available', onAvail);
    window.addEventListener('mindos:update-dismissed', onDismiss);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mindos:update-available', onAvail);
      window.removeEventListener('mindos:update-dismissed', onDismiss);
    };
  }, []);

  // Echo is a first-class content surface. Studio is visible by default; Flow
  // remains an experimental rail item controlled from Settings / Experiments.

  /** Debounce repeated clicks on the same rail target without swallowing destination changes. */
  const debounced = useCallback((key: string, fn: () => void): boolean => {
    const now = Date.now();
    if (lastClickRef.current.key === key && now - lastClickRef.current.at < 300) return false;
    lastClickRef.current = { key, at: now };
    fn();
    return true;
  }, []);

  const debouncedRailClick = useCallback((
    event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>,
    key: string,
    fn: () => void,
  ) => {
    if (!debounced(key, fn)) event.preventDefault();
  }, [debounced]);

  const toggle = useCallback((id: PanelId) => {
    debounced(`panel:${id}`, () => onPanelChange(activePanel === id ? null : id));
  }, [activePanel, onPanelChange, debounced]);

  const handleRouteRailClick = useCallback((
    event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>,
    targetPanel: RoutePanelId,
    onRouteClick?: React.MouseEventHandler<HTMLAnchorElement | HTMLButtonElement>,
  ) => {
    debouncedRailClick(event, `panel:${targetPanel}`, () => {
      if (onRouteClick) {
        onRouteClick(event);
        return;
      }
      const decision = getRailPanelClickDecision(pathname, activePanel, targetPanel);
      if (decision.preventDefault) event.preventDefault();
      onPanelChange(decision.nextPanel);
    });
  }, [activePanel, debouncedRailClick, onPanelChange, pathname]);

  const syncLevel = syncStale && syncStatus ? 'error' : getStatusLevel(syncStatus, false);
  const showSyncDot = syncLevel !== 'off' && syncLevel !== 'synced';

  const railWidth = expanded ? RAIL_WIDTH_EXPANDED : RAIL_WIDTH_COLLAPSED;

  // Sync dot badge — positioned differently in collapsed vs expanded
  const syncBadge = showSyncDot ? (
    <span className={`absolute ${expanded ? 'left-[26px] top-1.5' : 'top-1.5 right-1.5'} w-2 h-2 rounded-full ${DOT_COLORS[syncLevel]} ${syncLevel === 'error' || syncLevel === 'conflicts' ? 'animate-pulse' : ''}`} />
  ) : undefined;

  return (
    <aside
      className="group hidden md:flex fixed top-0 left-0 h-screen z-app-rail flex-col bg-background transition-[width] duration-200 ease-out after:absolute after:top-[var(--rail-titlebar-offset)] after:right-0 after:bottom-0 after:w-px after:bg-border after:pointer-events-none after:content-['']"
      style={{ width: `${railWidth}px` }}
      role="navigation"
      aria-label="Navigation"
    >
      {/* Content wrapper — overflow-hidden prevents text flash during width transitions */}
      <div className="relative z-10 flex flex-col h-full w-full overflow-hidden">
        {/* macOS titlebar row: draggable spacer pushes the logo below the traffic-light row (0px elsewhere) */}
        <div
          className="w-full shrink-0 h-[var(--rail-titlebar-offset)]"
          style={{ WebkitAppRegion: 'drag' } as CSSProperties}
        />
        {/* ── Top: Logo — mirrors the titlebar height so rail and panel start on the same line. ── */}
        <Link
          href="/"
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          onClick={(event) => {
            if (!shouldHandleSmoothNavigation(event)) return;
            if (onHomeClick) {
              event.preventDefault();
              onHomeClick(event);
              return;
            }
            event.preventDefault();
            startTransition(() => {
              onPanelChange(null);
            });
            if (!isHome) smoothPush('/');
          }}
          className={`relative z-10 flex items-center ${expanded ? 'px-3 gap-2' : 'justify-center'} w-full h-[var(--app-titlebar-h)] shrink-0 transition-opacity cursor-pointer ${isHome ? 'opacity-100' : 'opacity-50 hover:opacity-80'}`}
          aria-label="MindOS Home"
        >
          <Logo id="rail" className="w-7 h-3.5 shrink-0" />
          {expanded && <span className="text-sm text-foreground font-brand whitespace-nowrap">MindOS</span>}
        </Link>

        <div className={`${expanded ? 'mx-3' : 'mx-2'} border-t border-border`} />

        {/* ── Middle: Core panel toggles ── */}
        <div className={`flex flex-col ${expanded ? 'px-1.5' : 'items-center'} gap-1 py-2`}>
          <RailButton
            icon={<Inbox size={18} />}
            label={t.sidebar.capture}
            active={activeDestination === 'capture'}
            current={isCurrentRouteForPanel('capture')}
            expanded={expanded}
            href={ROUTE_PANEL_HREF.capture}
            onClick={(event) => handleRouteRailClick(event, 'capture', onCaptureClick)}
            walkthroughId="capture-page"
          />
          <RailButton
            icon={<Brain size={18} />}
            label={t.sidebar.files}
            active={activeDestination === 'files'}
            current={isCurrentRouteForPanel('files')}
            expanded={expanded}
            href={ROUTE_PANEL_HREF.files}
            onClick={(event) => handleRouteRailClick(event, 'files', onSpacesClick)}
            walkthroughId="files-panel"
          />
          {railPreferences.studio && (
            <RailButton
              icon={<DraftingCompass size={18} />}
              label={t.sidebar.studio ?? 'Studio'}
              active={activeDestination === 'studio'}
              current={isCurrentRouteForPanel('studio')}
              expanded={expanded}
              href={ROUTE_PANEL_HREF.studio}
              onClick={(event) => handleRouteRailClick(event, 'studio', onStudioClick)}
              walkthroughId="studio-page"
            />
          )}
          <RailButton
            icon={<Radio size={18} />}
            label={t.sidebar.echo}
            active={activeDestination === 'echo'}
            current={isCurrentRouteForPanel('echo')}
            expanded={expanded}
            href={ROUTE_PANEL_HREF.echo}
            onClick={(event) => handleRouteRailClick(event, 'echo', onEchoClick)}
            walkthroughId="echo-panel"
          />
          {railPreferences.flow && (
            <RailButton
              icon={<Zap size={18} />}
              label={t.sidebar.workflows ?? 'Flows'}
              active={activePanel === 'workflows'}
              pressed={activePanel === 'workflows'}
              expanded={expanded}
              onClick={(event) => (
                onWorkflowsClick
                  ? debouncedRailClick(event, 'panel:workflows', () => onWorkflowsClick(event))
                  : toggle('workflows')
              )}
            />
          )}
        </div>

        {/* ── Spacer ── */}
        <div className="flex-1" />

        {/* ── Secondary: Capabilities / Explore ── */}
        <div className={`${expanded ? 'mx-3' : 'mx-2'} border-t border-border`} />
        <div className={`flex flex-col ${expanded ? 'px-1.5' : 'items-center'} gap-1 py-2`}>
          <RailButton
            icon={<Bot size={18} />}
            label={t.sidebar.agents}
            active={activeDestination === 'agents'}
            current={isCurrentRouteForPanel('agents')}
            expanded={expanded}
            href={ROUTE_PANEL_HREF.agents}
            onClick={(event) => handleRouteRailClick(event, 'agents', onAgentsClick)}
            walkthroughId="agents-panel"
          />
          <RailButton
            icon={<Compass size={18} />}
            label={t.sidebar.discover}
            active={activeDestination === 'discover'}
            current={isCurrentRouteForPanel('discover')}
            expanded={expanded}
            href={ROUTE_PANEL_HREF.discover}
            onClick={(event) => handleRouteRailClick(event, 'discover', onDiscoverClick)}
          />
        </div>

        {/* ── Bottom: Action buttons (not panel toggles) ── */}
        <div className={`${expanded ? 'mx-3' : 'mx-2'} border-t border-border`} />
        <div className={`flex flex-col ${expanded ? 'px-1.5' : 'items-center'} gap-1 py-2`}>
          {pluginEntriesAvailable && onPluginEntriesClick && (
            <RailButton
              icon={<Puzzle size={18} />}
              label="Plugin Entries"
              expanded={expanded}
              onClick={() => debounced('action:plugin-entries', onPluginEntriesClick)}
              badge={(
                <span className={`absolute ${expanded ? 'left-[26px] top-1.5' : 'top-1.5 right-1.5'} h-1.5 w-1.5 rounded-full bg-success`} />
              )}
            />
          )}
          <RailButton
            icon={<Settings size={18} />}
            label={t.sidebar.settingsTitle}
            expanded={expanded}
            onClick={() => debounced('action:settings', onSettingsClick)}
            badge={hasUpdate ? (
              <span className={`absolute ${expanded ? 'left-[26px] top-1.5' : 'top-1.5 right-1.5'} w-2 h-2 rounded-full bg-error`} />
            ) : undefined}
          />
          <RailButton
            icon={<RefreshCw size={18} />}
            label={t.sidebar.syncLabel}
            expanded={expanded}
            buttonRef={syncBtnRef}
            badge={syncBadge}
            ariaHaspopup="dialog"
            ariaExpanded={syncPopoverOpen}
            ariaControls={syncPopoverOpen ? syncPopoverId : undefined}
            onClick={() => debounced('action:sync', () => {
              const rect = syncBtnRef.current?.getBoundingClientRect();
              if (rect) onSyncClick(rect);
            })}
          />
        </div>
      </div>

      {/* ── Hover expand/collapse button — vertically centered on right edge ── */}
      {/* Paints above Panel (z-30). Shows on Rail hover OR self-hover. */}
      <button
        onClick={() => onExpandedChange(!expanded)}
        className="
          absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-app-rail-affordance
          flex h-6 w-6 items-center justify-center rounded-full
          border border-border bg-card shadow-sm
          opacity-0 group-hover:opacity-100 hover:!opacity-100
          transition-[opacity,background-color,border-color,color,box-shadow] duration-200
          text-muted-foreground hover:text-foreground
          hover:bg-muted hover:shadow-md
          focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
        "
        aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        title={expanded ? 'Collapse' : 'Expand'}
      >
        {expanded ? <ChevronLeft size={10} /> : <ChevronRight size={10} />}
      </button>
    </aside>
  );
}
