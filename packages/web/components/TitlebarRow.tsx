'use client';

import React from 'react';
import { PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import TitlebarTabStrip from './TitlebarTabStrip';
import { useLocale } from '@/lib/stores/locale-store';

// Titlebar row (spec-titlebar-row Phase 1 + 2).
// display: none by default; globals.css flips it to flex for the mac shell
// (html[data-mac-titlebar-row]) and for desktop-width browsers, so mobile and
// old shells never see it. All geometry comes from shell CSS variables — when
// they are 0 the row is a zero-height no-op.
// Phase 2: the row hosts the workspace tab strip. The row background stays a
// window drag region; every interactive element inside the strip opts out
// individually, and the trailing spacer guarantees >=110px of pure drag space
// at the row's right end no matter how many tabs are open.
const ROW_STYLE = {
  left: 'var(--rail-width, var(--titlebar-row-left, 48px))',
  height: 'var(--app-titlebar-h)',
  // Clear the traffic lights only while the rail is narrower than them. The row
  // must start after the live rail width, otherwise the titlebar drag layer
  // covers the expanded rail home/logo hit area.
  paddingLeft: 'max(0px, calc(var(--window-controls-left, 0px) - var(--rail-width, var(--titlebar-row-left, 48px))))',
  WebkitAppRegion: 'drag',
} as React.CSSProperties;

// Hard guarantee from the spec box model: the right end of the row always
// keeps >=110px the user can grab to drag the window.
const DRAG_SPACER_STYLE = {
  minWidth: 110,
  WebkitAppRegion: 'drag',
} as React.CSSProperties;

const NO_DRAG_STYLE = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

interface TitlebarRowProps {
  searchActive?: boolean;
  onSearchOpenOrFocus?: () => void;
  sidebarExpanded?: boolean;
  onSidebarExpandedChange?: (expanded: boolean) => void;
}

const TITLEBAR_ACTION_CLASS = 'mb-1 ml-1.5 hidden h-7 w-7 shrink-0 items-center justify-center self-end rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex';

function TitlebarSearchTrigger({
  active,
  onOpenOrFocus,
  label,
}: {
  active: boolean;
  onOpenOrFocus?: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      aria-expanded={active}
      title={`${label} (⌘K)`}
      data-titlebar-search-trigger
      style={NO_DRAG_STYLE}
      onClick={onOpenOrFocus}
      className={`${TITLEBAR_ACTION_CLASS} ${
        active
          ? 'bg-[var(--amber-dim)] text-[var(--amber)]'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      <Search size={15} aria-hidden="true" />
    </button>
  );
}

function TitlebarSidebarToggle({
  expanded,
  onExpandedChange,
  collapseLabel,
  expandLabel,
}: {
  expanded: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  collapseLabel: string;
  expandLabel: string;
}) {
  const label = expanded ? collapseLabel : expandLabel;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={expanded}
      title={label}
      data-titlebar-sidebar-toggle
      style={NO_DRAG_STYLE}
      onClick={() => onExpandedChange?.(!expanded)}
      className={`${TITLEBAR_ACTION_CLASS} ml-0 mr-1 text-muted-foreground hover:bg-muted hover:text-foreground`}
    >
      {expanded ? <PanelLeftClose size={15} aria-hidden="true" /> : <PanelLeftOpen size={15} aria-hidden="true" />}
    </button>
  );
}

export default function TitlebarRow({
  searchActive = false,
  onSearchOpenOrFocus,
  sidebarExpanded = false,
  onSidebarExpandedChange,
}: TitlebarRowProps) {
  const { t } = useLocale();

  return (
    <div
      className="titlebar-row fixed top-0 right-0 z-app-rail-affordance bg-background border-b border-border"
      style={ROW_STYLE}
    >
      <TitlebarSearchTrigger
        active={searchActive}
        onOpenOrFocus={onSearchOpenOrFocus}
        label={t.sidebar.searchTitle}
      />
      <TitlebarSidebarToggle
        expanded={sidebarExpanded}
        onExpandedChange={onSidebarExpandedChange}
        collapseLabel={t.sidebar.collapseTitle}
        expandLabel={t.sidebar.expandTitle}
      />
      <TitlebarTabStrip />
      <div aria-hidden="true" data-drag-spacer className="h-full shrink-0" style={DRAG_SPACER_STYLE} />
    </div>
  );
}
