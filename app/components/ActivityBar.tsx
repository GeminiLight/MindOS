'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import Link from 'next/link';
import { FolderTree, Search, Settings, RefreshCw, Blocks, Bot, Compass, HelpCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import { DOT_COLORS, getStatusLevel } from './SyncStatusBar';
import type { SyncStatus } from './settings/SyncTab';
import Logo from './Logo';

export type PanelId = 'files' | 'search' | 'plugins' | 'agents' | 'discover';

export const RAIL_WIDTH_COLLAPSED = 48;
export const RAIL_WIDTH_EXPANDED = 180;

interface ActivityBarProps {
  activePanel: PanelId | null;
  onPanelChange: (id: PanelId | null) => void;
  syncStatus: SyncStatus | null;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSettingsClick: () => void;
  onHelpClick: () => void;
  onSyncClick: (rect: DOMRect) => void;
}

interface RailButtonProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  expanded: boolean;
  onClick: () => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
  /** Optional overlay badge (e.g. status dot) rendered inside the button */
  badge?: React.ReactNode;
  /** Optional data-walkthrough attribute for interactive walkthrough targeting */
  walkthroughId?: string;
}

function RailButton({ icon, label, shortcut, active = false, expanded, onClick, buttonRef, badge, walkthroughId }: RailButtonProps) {
  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={expanded ? undefined : (shortcut ? `${label} (${shortcut})` : label)}
      data-walkthrough={walkthroughId}
      className={`
        relative flex items-center ${expanded ? 'justify-start px-3 w-full' : 'justify-center w-10'} h-10 rounded-md transition-colors
        ${active
          ? 'text-[var(--amber)] bg-[var(--amber-dim)]'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        }
        focus-visible:ring-2 focus-visible:ring-ring
      `}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-[18px] rounded-r-full" style={{ background: 'var(--amber)' }} />
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
    </button>
  );
}

export default function ActivityBar({
  activePanel,
  onPanelChange,
  syncStatus,
  expanded,
  onExpandedChange,
  onSettingsClick,
  onHelpClick,
  onSyncClick,
}: ActivityBarProps) {
  const lastClickRef = useRef(0);
  const syncBtnRef = useRef<HTMLButtonElement>(null);
  const { t } = useLocale();

  // Update available badge — check localStorage for persisted state
  const [hasUpdate, setHasUpdate] = useState(() => {
    if (typeof window === 'undefined') return false;
    const dismissed = localStorage.getItem('mindos_update_dismissed');
    const latest = localStorage.getItem('mindos_update_latest');
    return !!latest && latest !== dismissed;
  });
  useEffect(() => {
    const onAvail = (e: Event) => {
      const latest = (e as CustomEvent).detail?.latest;
      if (latest) localStorage.setItem('mindos_update_latest', latest);
      setHasUpdate(true);
    };
    const onDismiss = () => setHasUpdate(false);
    window.addEventListener('mindos:update-available', onAvail);
    window.addEventListener('mindos:update-dismissed', onDismiss);
    return () => {
      window.removeEventListener('mindos:update-available', onAvail);
      window.removeEventListener('mindos:update-dismissed', onDismiss);
    };
  }, []);

  /** Debounce rapid clicks (300ms) — shared across all Rail buttons */
  const debounced = useCallback((fn: () => void) => {
    const now = Date.now();
    if (now - lastClickRef.current < 300) return;
    lastClickRef.current = now;
    fn();
  }, []);

  const toggle = useCallback((id: PanelId) => {
    debounced(() => onPanelChange(activePanel === id ? null : id));
  }, [activePanel, onPanelChange, debounced]);

  const syncLevel = getStatusLevel(syncStatus, false);
  const showSyncDot = syncLevel !== 'off' && syncLevel !== 'synced';

  const railWidth = expanded ? RAIL_WIDTH_EXPANDED : RAIL_WIDTH_COLLAPSED;

  // Sync dot badge — positioned differently in collapsed vs expanded
  const syncBadge = showSyncDot ? (
    <span className={`absolute ${expanded ? 'left-[26px] top-1.5' : 'top-1.5 right-1.5'} w-2 h-2 rounded-full ${DOT_COLORS[syncLevel]} ${syncLevel === 'error' || syncLevel === 'conflicts' ? 'animate-pulse' : ''}`} />
  ) : undefined;

  return (
    <aside
      className="group hidden md:flex fixed top-0 left-0 h-screen z-[31] flex-col bg-background border-r border-border transition-[width] duration-200 ease-out"
      style={{ width: `${railWidth}px` }}
      role="toolbar"
      aria-label="Navigation"
      aria-orientation="vertical"
      data-walkthrough="activity-bar"
    >
      {/* Content wrapper — overflow-hidden prevents text flash during width transitions */}
      <div className="flex flex-col h-full w-full overflow-hidden">
        {/* ── Top: Logo ── */}
        <Link
          href="/"
          className={`flex items-center ${expanded ? 'px-3 gap-2' : 'justify-center'} w-full py-3 hover:opacity-80 transition-opacity`}
          aria-label="MindOS Home"
        >
          <Logo id="rail" className="w-7 h-3.5 shrink-0" />
          {expanded && <span className="text-sm font-semibold text-foreground font-display whitespace-nowrap">MindOS</span>}
        </Link>

        <div className={`${expanded ? 'mx-3' : 'mx-auto w-6'} border-t border-border`} />

        {/* ── Middle: Core panel toggles ── */}
        <div className={`flex flex-col ${expanded ? 'px-1.5' : 'items-center'} gap-1 py-2`}>
          <RailButton icon={<FolderTree size={18} />} label={t.sidebar.files} active={activePanel === 'files'} expanded={expanded} onClick={() => toggle('files')} walkthroughId="files-panel" />
          <RailButton icon={<Search size={18} />} label={t.sidebar.searchTitle} shortcut="⌘K" active={activePanel === 'search'} expanded={expanded} onClick={() => toggle('search')} walkthroughId="search-button" />
          <RailButton icon={<Blocks size={18} />} label={t.sidebar.plugins} active={activePanel === 'plugins'} expanded={expanded} onClick={() => toggle('plugins')} />
          <RailButton icon={<Bot size={18} />} label={t.sidebar.agents} active={activePanel === 'agents'} expanded={expanded} onClick={() => toggle('agents')} />
          <RailButton icon={<Compass size={18} />} label={t.sidebar.discover} active={activePanel === 'discover'} expanded={expanded} onClick={() => toggle('discover')} />
        </div>

        {/* ── Spacer ── */}
        <div className="flex-1" />

        {/* ── Bottom: Action buttons (not panel toggles) ── */}
        <div className={`${expanded ? 'mx-3' : 'mx-auto w-6'} border-t border-border`} />
        <div className={`flex flex-col ${expanded ? 'px-1.5' : 'items-center'} gap-1 py-2`}>
          <RailButton
            icon={<HelpCircle size={18} />}
            label={t.sidebar.help}
            expanded={expanded}
            onClick={() => debounced(onHelpClick)}
          />
          <RailButton
            icon={<Settings size={18} />}
            label={t.sidebar.settingsTitle}
            shortcut="⌘,"
            expanded={expanded}
            onClick={() => debounced(onSettingsClick)}
            walkthroughId="settings-button"
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
            onClick={() => debounced(() => {
              const rect = syncBtnRef.current?.getBoundingClientRect();
              if (rect) onSyncClick(rect);
            })}
          />
        </div>
      </div>

      {/* ── Hover expand/collapse button — vertically centered on right edge ── */}
      {/* z-[32] ensures it paints above Panel (z-30). Shows on Rail hover OR self-hover. */}
      <button
        onClick={() => onExpandedChange(!expanded)}
        className="
          absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-[32]
          w-5 h-5 rounded-full
          bg-card border border-border shadow-sm
          flex items-center justify-center
          opacity-0 group-hover:opacity-100 hover:!opacity-100
          transition-opacity duration-200
          text-muted-foreground hover:text-foreground hover:bg-muted
          focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring
        "
        aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        title={expanded ? 'Collapse' : 'Expand'}
      >
        {expanded ? <ChevronLeft size={10} /> : <ChevronRight size={10} />}
      </button>
    </aside>
  );
}
