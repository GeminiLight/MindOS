'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { MIN_PANEL_WIDTH, MAX_PANEL_WIDTH_ABS } from '@/components/Panel';
import type { PanelId } from '@/lib/navigation-panel';
import { RAIL_WIDTH_COLLAPSED, RAIL_WIDTH_EXPANDED } from '@/components/ActivityBar';

export interface LeftPanelState {
  activePanel: PanelId | null;
  setActivePanel: (p: PanelId | null | ((prev: PanelId | null) => PanelId | null)) => void;
  /** Global left-sidebar visibility preference, shared by all routes. */
  sidebarExpanded: boolean;
  /** User-resized width (global across panels) — null until the user resizes */
  panelWidth: number | null;
  panelMaximized: boolean;
  railExpanded: boolean;
  railWidth: number;
  handlePanelWidthChange: (w: number) => void;
  handlePanelWidthCommit: (w: number) => void;
  handlePanelMaximize: () => void;
  handleSidebarExpandedChange: (expanded: boolean) => void;
  handleExpandedChange: (expanded: boolean) => void;
}

const SIDEBAR_EXPANDED_STORAGE_KEY = 'mindos.sidebar.expanded';

function readSidebarExpanded(defaultExpanded: boolean): boolean {
  if (typeof window === 'undefined') return defaultExpanded;
  try {
    const stored = window.localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {}
  return defaultExpanded;
}

/**
 * Manages left panel state: active panel, width, maximize, rail expansion.
 * Extracted from SidebarLayout to reduce its state complexity.
 */
export function useLeftPanel(initialActivePanel: PanelId | null = 'files'): LeftPanelState {
  const [activePanel, setActivePanel] = useState<PanelId | null>(initialActivePanel);
  const [sidebarExpanded, setSidebarExpanded] = useState(() => readSidebarExpanded(initialActivePanel !== null));
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const [panelMaximized, setPanelMaximized] = useState(false);
  const [railExpanded, setRailExpanded] = useState(false);

  // Load persisted rail state
  useEffect(() => {
    try {
      if (localStorage.getItem('rail-expanded') === 'true') setRailExpanded(true);
    } catch {}
  }, []);

  // Load the persisted panel width once — the width is one global value, so
  // re-reading (and force-defaulting) on every panel switch only created
  // extra width transitions. null means "use the per-panel default".
  useEffect(() => {
    try {
      const stored = localStorage.getItem('left-panel-width');
      if (!stored) return;
      const w = parseInt(stored, 10);
      if (w >= MIN_PANEL_WIDTH && w <= MAX_PANEL_WIDTH_ABS) setPanelWidth(w);
    } catch {}
  }, []);

  // Exit maximize when switching panels
  useEffect(() => { setPanelMaximized(false); }, [activePanel]);

  // Drag resize fires one onResize per mousemove (often >60/s on high-rate
  // mice), and SidebarLayout derives the content padding from `panelWidth`, so
  // the live value must stay in React state — we can't bypass it with direct
  // style mutation. Instead, coalesce updates to one setState per animation
  // frame and commit the final value synchronously on drag end.
  const widthRafRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (widthRafRef.current !== null) cancelAnimationFrame(widthRafRef.current);
  }, []);

  const handlePanelWidthChange = useCallback((w: number) => {
    if (typeof requestAnimationFrame !== 'function') { setPanelWidth(w); return; }
    pendingWidthRef.current = w;
    if (widthRafRef.current !== null) return; // frame already scheduled
    widthRafRef.current = requestAnimationFrame(() => {
      widthRafRef.current = null;
      if (pendingWidthRef.current !== null) {
        setPanelWidth(pendingWidthRef.current);
        pendingWidthRef.current = null;
      }
    });
  }, []);

  const handlePanelWidthCommit = useCallback((w: number) => {
    // Drop any pending frame so a stale drag value can't overwrite the commit.
    if (widthRafRef.current !== null) {
      cancelAnimationFrame(widthRafRef.current);
      widthRafRef.current = null;
    }
    pendingWidthRef.current = null;
    setPanelWidth(w);
    try { localStorage.setItem('left-panel-width', String(w)); } catch {}
  }, []);
  const handlePanelMaximize = useCallback(() => setPanelMaximized(v => !v), []);

  const handleSidebarExpandedChange = useCallback((expanded: boolean) => {
    setSidebarExpanded(expanded);
    try { localStorage.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, String(expanded)); } catch {}
  }, []);

  const handleExpandedChange = useCallback((expanded: boolean) => {
    setRailExpanded(expanded);
    try { localStorage.setItem('rail-expanded', String(expanded)); } catch {}
  }, []);

  const railWidth = railExpanded ? RAIL_WIDTH_EXPANDED : RAIL_WIDTH_COLLAPSED;

  return {
    activePanel, setActivePanel,
    sidebarExpanded,
    panelWidth, panelMaximized, railExpanded, railWidth,
    handlePanelWidthChange, handlePanelWidthCommit, handlePanelMaximize,
    handleSidebarExpandedChange,
    handleExpandedChange,
  };
}
