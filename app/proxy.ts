import { NextRequest, NextResponse } from 'next/server';
import { verifyJwt } from '@/lib/jwt';

const COOKIE_NAME = 'mindos-session';

export async function proxy(req: NextRequest) {
  const authToken = process.env.AUTH_TOKEN;     // API bearer token (for Agents / MCP)
  const webPassword = process.env.WEB_PASSWORD; // Web UI login password (for browser users)
  const pathname = req.nextUrl.pathname;

  function next(): NextResponse {
    const newHeaders = new Headers(req.headers);
    newHeaders.set('x-pathname', pathname);
    return NextResponse.next({ request: { headers: newHeaders } });
  }

  // --- API protection (AUTH_TOKEN) ---
  if (pathname.startsWith('/api/')) {
    // /api/auth handles its own password validation — never block it.
    // /api/health is unauthenticated so check-port can detect this MindOS instance.
    if (pathname === '/api/auth' || pathname === '/api/health') return NextResponse.next();

    if (!authToken) return NextResponse.next();

    // Exempt same-origin browser requests (the app's own frontend).
    // Sec-Fetch-Site is set by browsers automatically and cannot be spoofed by JS.
    if (req.headers.get('sec-fetch-site') === 'same-origin') return NextResponse.next();

    // Exempt authenticated web UI sessions (valid JWT cookie = logged-in browser user)
    if (webPassword) {
      const token = req.cookies.get(COOKIE_NAME)?.value ?? '';
      if (token && await verifyJwt(token, webPassword)) return NextResponse.next();
    }

    // External / cross-origin requests must provide a bearer token
    const header = req.headers.get('authorization') ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (bearer !== authToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.next();
  }

  // --- Web UI protection (WEB_PASSWORD) ---
  if (!webPassword) return next();

  // Login page itself always passes through
  if (pathname === '/login') return next();

  // Verify JWT session cookie
  const token = req.cookies.get(COOKIE_NAME)?.value ?? '';
  if (token && await verifyJwt(token, webPassword)) return next();

  // Not authenticated: redirect to /login
  const loginUrl = new URL('/login', req.url);
  if (pathname !== '/') loginUrl.searchParams.set('redirect', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon\\.ico).*)',
  ],
};
