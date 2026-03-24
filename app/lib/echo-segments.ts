/**
 * Echo content routes: segment slugs and validation.
 * Keep in sync with `wiki/specs/spec-echo-content-pages.md`.
 */

export const ECHO_SEGMENT_IDS = ['about-you', 'continued', 'daily', 'past-you', 'growth'] as const;

export type EchoSegment = (typeof ECHO_SEGMENT_IDS)[number];

export const ECHO_SEGMENT_ORDER: readonly EchoSegment[] = ECHO_SEGMENT_IDS;

/** App Router paths for each segment (single source for panel + in-page nav). */
export const ECHO_SEGMENT_HREF: Record<EchoSegment, string> = {
  'about-you': '/echo/about-you',
  continued: '/echo/continued',
  daily: '/echo/daily',
  'past-you': '/echo/past-you',
  growth: '/echo/growth',
};

export function isEchoSegment(value: string): value is EchoSegment {
  return (ECHO_SEGMENT_IDS as readonly string[]).includes(value);
}

export function defaultEchoSegment(): EchoSegment {
  return 'about-you';
}
