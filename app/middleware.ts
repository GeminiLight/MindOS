import { NextRequest, NextResponse } from 'next/server';

/**
 * Optional bearer-token authentication for API routes.
 *
 * - If `AUTH_TOKEN` env var is set, external /api/* requests must include
 *   `Authorization: Bearer <token>` header matching the env var.
 * - Same-origin browser requests are exempt (detected via Sec-Fetch-Site header).
 * - If `AUTH_TOKEN` is not set, all requests pass through (local dev mode).
 * - Static assets, pages, and _next/* are never blocked.
 */
export function middleware(req: NextRequest) {
  const authToken = process.env.AUTH_TOKEN;

  // No token configured → open access (local single-user mode)
  if (!authToken) return NextResponse.next();

  // Only protect API routes
  if (!req.nextUrl.pathname.startsWith('/api/')) return NextResponse.next();

  // Exempt same-origin browser requests (the app's own frontend).
  // Sec-Fetch-Site is set by browsers automatically and cannot be spoofed by JS.
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite === 'same-origin') return NextResponse.next();

  // External / cross-origin / non-browser requests must provide a bearer token
  const header = req.headers.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (bearer !== authToken) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
