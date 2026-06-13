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
  left: 'var(--rail-width)',
  height: 'var(--app-titlebar-h)',
  // Clear the traffic lights only when the rail does not already cover them
  paddingLeft: 'max(0px, calc(var(--window-controls-left) - var(--rail-width)))',
  // Same duration/easing as the rail width transition so expand/collapse stays in sync
  transition: 'left 200ms ease-out, padding-left 200ms ease-out',
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
      className={`mb-1 ml-1.5 mr-1 hidden h-7 w-7 shrink-0 items-center justify-center self-end rounded-full text-muted-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex ${
        active
          ? 'bg-[var(--amber)]/10 text-[var(--amber)]'
          : 'hover:bg-muted hover:text-foreground'
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
      className="mb-1 mr-1 hidden h-7 w-7 shrink-0 items-center justify-center self-end rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
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
      className="titlebar-row fixed top-0 right-0 z-30 bg-background border-b border-border"
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
