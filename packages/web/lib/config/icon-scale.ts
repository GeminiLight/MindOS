/**
 * Centralized icon size scale.
 * Replaces arbitrary sizes (10/12/13/14/15/16/18/20px) with a named scale.
 * Usage: import { ICON_SIZES } from '@/lib/config/icon-scale'
 */

export const ICON_SIZES = {
  xs: 10,    // Tiny: breadcrumb items, status dots, inline badges
  sm: 12,    // Small: form field icons, list item decorators
  md: 14,    // Medium: button icons, sidebar items, file tree (DEFAULT)
  lg: 16,    // Large: main action buttons, panel headers
  xl: 18,    // XL: hero icons, large buttons, empty states
  xxl: 20,   // XXL: large empty state icons, prominent UI
  xxxl: 24,  // XXXL: section headers, splash screens
} as const;

export type IconSize = keyof typeof ICON_SIZES;

/**
 * Helper: Get pixel value by size name
 * @param size - Size key, e.g., 'md', 'lg'
 * @returns Pixel value, e.g., 14
 */
export function getIconSize(size: IconSize): number {
  return ICON_SIZES[size];
}

/**
 * Most common sizes in the codebase:
 * - md (14px): 60% of icons → FileTree, buttons, lists, sidebars
 * - lg (16px): 20% of icons → Headers, main actions
 * - sm (12px): 10% of icons → Inline, compact
 * - xs (10px): 8% of icons → Badges, tiny status
 * - xl+ (18-24px): 2% of icons → Empty states, highlights
 */
