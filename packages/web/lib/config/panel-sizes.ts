/**
 * Centralized panel width configuration.
 * All panel sizing constants in one place for easy maintenance.
 */

import type { PanelId } from '@/lib/navigation-panel';

// ── Left Panel (Files/Search/Agents/Echo/Discover) ──

export const STANDARD_LEFT_PANEL_WIDTH = 300;

export const DEFAULT_LEFT_PANEL_WIDTH: Record<PanelId, number> = {
  files: STANDARD_LEFT_PANEL_WIDTH,
  capture: STANDARD_LEFT_PANEL_WIDTH,
  search: STANDARD_LEFT_PANEL_WIDTH,
  echo: STANDARD_LEFT_PANEL_WIDTH,
  agents: STANDARD_LEFT_PANEL_WIDTH,
  discover: STANDARD_LEFT_PANEL_WIDTH,
  workflows: STANDARD_LEFT_PANEL_WIDTH,
};

export const LEFT_PANEL: { DEFAULT: number; MIN: number; MAX_RATIO: number; MAX_ABS: number } = {
  DEFAULT: STANDARD_LEFT_PANEL_WIDTH,
  MIN: 240,
  MAX_RATIO: 0.45, // 45% of screen width
  MAX_ABS: 600, // Absolute pixel max
};

/**
 * Single source of truth for the rendered left-panel width.
 * The stored width is global across panels — once the user resizes, it wins
 * everywhere. Per-panel defaults only apply before any resize, so the width
 * can never oscillate while local and route-derived panel state disagree
 * during a navigation transition.
 */
export function getLeftPanelWidth(activeLeftPanel: PanelId | null, userWidth: number | null): number {
  if (userWidth !== null) return userWidth;
  return activeLeftPanel ? DEFAULT_LEFT_PANEL_WIDTH[activeLeftPanel] : LEFT_PANEL.DEFAULT;
}

// ── Right Ask Panel ──

export const RIGHT_ASK_PANEL: { DEFAULT: number; MIN: number; MAX_ABS: number; MIN_CONTENT: number } = {
  DEFAULT: 380,
  MIN: 320,
  MAX_ABS: 4000, // Unlikely but safe upper bound
  MIN_CONTENT: 200, // Minimum content width — only auto-maximize when user drags near edge
};

// ── Right Agent Detail Panel ──

export const RIGHT_AGENT_DETAIL_PANEL: { DEFAULT: number; MIN: number; MAX_ABS: number; MAX_RATIO: number } = {
  DEFAULT: 400,
  MIN: 300,
  MAX_ABS: 640,
  MAX_RATIO: 0.42, // 42% of screen width
};

// ── Sidebar Chrome ──

export const SETTINGS_SIDEBAR = {
  WIDTH: 232,
} as const;

export const MOBILE_SIDEBAR = {
  WIDTH: '85vw',
  MAX_WIDTH: 320,
} as const;

// ── Mobile/Responsive Breakpoints ──

export const RESPONSIVE_BREAKPOINTS = {
  mobile: 375,
  tablet: 768,
  desktop: 1024,
  wide: 1440,
};

// ── Activity Bar ──

export const ACTIVITY_BAR = {
  WIDTH_COLLAPSED: 48,
  WIDTH_EXPANDED: 180,
} as const;
