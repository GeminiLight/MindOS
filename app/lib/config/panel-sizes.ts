/**
 * Centralized panel width configuration.
 * All panel sizing constants in one place for easy maintenance.
 */

import type { PanelId } from '@/components/ActivityBar';

// ── Left Panel (Files/Search/Agents/Echo/Discover) ──

export const DEFAULT_LEFT_PANEL_WIDTH: Record<PanelId, number> = {
  files: 280,
  search: 320,
  echo: 340,
  agents: 300,
  discover: 300,
  workflows: 320,
  im: 300,
};

export const LEFT_PANEL: { DEFAULT: number; MIN: number; MAX_RATIO: number; MAX_ABS: number } = {
  DEFAULT: 280,
  MIN: 240,
  MAX_RATIO: 0.45, // 45% of screen width
  MAX_ABS: 600, // Absolute pixel max
};

// ── Right Ask Panel ──

export const RIGHT_ASK_PANEL: { DEFAULT: number; MIN: number; MAX_ABS: number; MIN_CONTENT: number } = {
  DEFAULT: 420,
  MIN: 400,
  MAX_ABS: 4000, // Unlikely but safe upper bound
  MIN_CONTENT: 360, // Minimum content width when panel is resized
};

// ── Right Agent Detail Panel ──

export const RIGHT_AGENT_DETAIL_PANEL: { DEFAULT: number; MIN: number; MAX_ABS: number; MAX_RATIO: number } = {
  DEFAULT: 400,
  MIN: 300,
  MAX_ABS: 640,
  MAX_RATIO: 0.42, // 42% of screen width
};

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
};
