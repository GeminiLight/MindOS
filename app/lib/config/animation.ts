/**
 * Centralized animation configuration.
 * Three-tier system for consistent animation timings across the app.
 * All durations in milliseconds, <= 300ms per WCAG/a11y standards.
 */

/** Animation duration tiers */
export const ANIMATION = {
  // Micro: Quick feedback, hover/focus states
  MICRO: 100,    // Button hover, icon transitions, quick visual feedback

  // Short: Interactive transitions, small content changes
  SHORT: 200,    // Slide/fade modals, popovers, panel opens, dropdowns, quick state changes

  // Medium: Larger content transitions, drawing attention
  MEDIUM: 300,   // Long panel slides, collapse/expand grids, significant layout changes

  // Fast-exit: When closing/dismissing (slightly faster)
  FAST_EXIT: 150,
} as const;

/** Easing functions (using Tailwind defaults) */
export const EASING = {
  // Use for enter/appear animations (slow start, fast end)
  EASE_OUT: 'cubic-bezier(0, 0, 0.2, 1)',

  // Use for exit/disappear animations (fast start, slow end)
  EASE_IN: 'cubic-bezier(0.4, 0, 1, 1)',

  // Use for continuous/reversible animations (uniform acceleration/deceleration)
  EASE_IN_OUT: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

/**
 * Helper to build transition string
 * @example
 * buildTransition('all') // 'all 200ms cubic-bezier(...)'
 * buildTransition('opacity', { duration: ANIMATION.MICRO, easing: EASING.EASE_IN_OUT })
 */
export function buildTransition(
  property: string = 'all',
  options?: {
    duration?: number;
    easing?: string;
    delay?: number;
  }
) {
  const duration = options?.duration ?? ANIMATION.SHORT;
  const easing = options?.easing ?? EASING.EASE_IN_OUT;
  const delay = options?.delay ?? 0;

  const delayStr = delay > 0 ? ` ${delay}ms` : '';
  return `${property} ${duration}ms ${easing}${delayStr}`;
}

/**
 * Usage guide:
 *
 * ### Hover/Focus (MICRO)
 * className="transition duration-100 ease-out hover:bg-muted"
 *
 * ### Modal/Panel Open (SHORT with EASE_OUT)
 * className="animate-in fade-in-0 zoom-in-95 duration-200 ease-out"
 *
 * ### Collapse/Expand Grid (MEDIUM with EASE_IN_OUT)
 * style={{
 *   transition: buildTransition('grid-template-rows', {
 *     duration: ANIMATION.MEDIUM,
 *     easing: EASING.EASE_IN_OUT
 *   })
 * }}
 *
 * ### Sidebar Slide (SHORT with EASE_OUT for enter, EASE_IN for exit)
 * // Sidebar appears: transition duration-200 ease-out
 * // Sidebar closes: transition duration-150 ease-in
 */
