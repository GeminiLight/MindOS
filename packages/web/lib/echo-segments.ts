/**
 * Echo content routes: segment slugs and validation.
 */

export const ECHO_SEGMENT_IDS = ['overview', 'imprint', 'threads', 'growth'] as const;

export type EchoSegment = (typeof ECHO_SEGMENT_IDS)[number];

export const ECHO_SEGMENT_ORDER: readonly EchoSegment[] = ECHO_SEGMENT_IDS;

/** App Router paths for each segment (single source for panel + in-page nav). */
export const ECHO_SEGMENT_HREF: Record<EchoSegment, string> = {
  overview: '/echo/overview',
  imprint: '/echo/imprint',
  threads: '/echo/threads',
  growth: '/echo/growth',
};

export function isEchoSegment(value: string): value is EchoSegment {
  return (ECHO_SEGMENT_IDS as readonly string[]).includes(value);
}

export function defaultEchoSegment(): EchoSegment {
  return 'overview';
}

/** Default landing route — `/` and `/echo` server-redirect here. */
export function defaultEchoPath(): string {
  return `/echo/${defaultEchoSegment()}`;
}
