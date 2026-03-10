import { NextRequest, NextResponse } from 'next/server';

/**
 * Optional bearer-token authentication for API routes.
 *
 * - If `AUTH_TOKEN` env var is set, all /api/* requests must include
 *   `Authorization: Bearer <token>` header matching the env var.
 * - If `AUTH_TOKEN` is not set, all requests pass through (local dev mode).
 * - Static assets, pages, and _next/* are never blocked.
 */
export function middleware(req: NextRequest) {
  const authToken = process.env.AUTH_TOKEN;

  // No token configured → open access (local single-user mode)
  if (!authToken) return NextResponse.next();

  // Only protect API routes
  if (!req.nextUrl.pathname.startsWith('/api/')) return NextResponse.next();

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
