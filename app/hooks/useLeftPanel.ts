'use client';

import { useState, useEffect, useCallback } from 'react';
import { MIN_PANEL_WIDTH, MAX_PANEL_WIDTH_ABS, PANEL_WIDTH } from '@/components/Panel';
import type { PanelId } from '@/components/ActivityBar';
import { RAIL_WIDTH_COLLAPSED, RAIL_WIDTH_EXPANDED } from '@/components/ActivityBar';

export interface LeftPanelState {
  activePanel: PanelId | null;
  setActivePanel: (p: PanelId | null | ((prev: PanelId | null) => PanelId | null)) => void;
  panelWidth: number | null;
  panelMaximized: boolean;
  railExpanded: boolean;
  railWidth: number;
  panelOpen: boolean;
  effectivePanelWidth: number;
  handlePanelWidthChange: (w: number) => void;
  handlePanelWidthCommit: (w: number) => void;
  handlePanelMaximize: () => void;
  handleExpandedChange: (expanded: boolean) => void;
}

/**
 * Manages left panel state: active panel, width, maximize, rail expansion.
 * Extracted from SidebarLayout to reduce its state complexity.
 */
export function useLeftPanel(): LeftPanelState {
  const [activePanel, setActivePanel] = useState<PanelId | null>('files');
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const [panelMaximized, setPanelMaximized] = useState(false);
  const [railExpanded, setRailExpanded] = useState(false);

  // Load persisted rail state
  useEffect(() => {
    try {
      if (localStorage.getItem('rail-expanded') === 'true') setRailExpanded(true);
    } catch {}
  }, []);

  // Load persisted panel width when activePanel changes
  useEffect(() => {
    if (!activePanel) return;
    try {
      const stored = localStorage.getItem('left-panel-width');
      if (stored) {
        const w = parseInt(stored, 10);
        if (w >= MIN_PANEL_WIDTH && w <= MAX_PANEL_WIDTH_ABS) {
          setPanelWidth(w);
          return;
        }
      }
    } catch {}
    setPanelWidth(280);
  }, [activePanel]);

  // Exit maximize when switching panels
  useEffect(() => { setPanelMaximized(false); }, [activePanel]);

  const handlePanelWidthChange = useCallback((w: number) => setPanelWidth(w), []);
  const handlePanelWidthCommit = useCallback((w: number) => {
    try { localStorage.setItem('left-panel-width', String(w)); } catch {}
  }, []);
  const handlePanelMaximize = useCallback(() => setPanelMaximized(v => !v), []);

  const handleExpandedChange = useCallback((expanded: boolean) => {
    setRailExpanded(expanded);
    try { localStorage.setItem('rail-expanded', String(expanded)); } catch {}
  }, []);

  const railWidth = railExpanded ? RAIL_WIDTH_EXPANDED : RAIL_WIDTH_COLLAPSED;
  const panelOpen = activePanel !== null;
  const effectivePanelWidth = panelWidth ?? (activePanel ? PANEL_WIDTH[activePanel] : 280);

  return {
    activePanel, setActivePanel,
    panelWidth, panelMaximized, railExpanded, railWidth,
    panelOpen, effectivePanelWidth,
    handlePanelWidthChange, handlePanelWidthCommit, handlePanelMaximize,
    handleExpandedChange,
  };
}
