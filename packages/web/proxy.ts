import { NextRequest, NextResponse } from 'next/server';
import { verifyJwt } from '@/lib/jwt';
import { buildLoginRedirectTarget, WEB_SESSION_COOKIE_NAME } from '@/lib/auth-session';
import { readSetupPending } from '@/lib/setup-state';
import { defaultEchoPath } from '@/lib/echo-segments';
import { readRuntimeAuthConfig } from '@/lib/runtime-auth-config';
import { MINDOS_SERVER_ROUTES, allowsSameOriginExemption } from '@geminilight/mindos/server';
import { isAllowedCorsOrigin } from '@/lib/cors-origins';

/**
 * CORS headers for /api/* routes. The request Origin is echoed only when it is
 * on the shared local-network allowlist; other origins get no CORS headers, so
 * a page on an arbitrary site cannot read API responses. Requests without an
 * Origin header (curl, native mobile, MCP server) need no CORS at all.
 */
function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!isAllowedCorsOrigin(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/**
 * Public API routes are derived from the core server contract so the proxy
 * never drifts from `MINDOS_SERVER_ROUTES` (e.g. the Feishu OAuth callback,
 * which a browser redirect reaches without any bearer token).
 * `/api/auth` handles its own password validation and stays open for every method.
 */
const ALWAYS_PUBLIC_API_PATHS = new Set(['/api/auth']);

/** Turn a contract path like `/api/foo/[id]/bar` into an exact-match regex. */
function contractPathPattern(routePath: string): RegExp {
  const source = routePath
    .split('/')
    .map((segment) => (/^\[.+\]$/.test(segment) ? '[^/]+' : segment.replace(/[.*+?^${}()|\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${source}/?$`);
}

const PUBLIC_API_ROUTES: Array<{ method: string; pattern: RegExp }> = MINDOS_SERVER_ROUTES
  .filter((route) => route.auth === 'public')
  .map((route) => ({ method: route.method, pattern: contractPathPattern(route.path) }));

export function isPublicApiRoute(method: string, pathname: string): boolean {
  if (ALWAYS_PUBLIC_API_PATHS.has(pathname)) return true;
  // HEAD is a GET without a body; health probes commonly use it.
  const normalized = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  return PUBLIC_API_ROUTES.some((route) => route.method === normalized && route.pattern.test(pathname));
}

/** Attach CORS headers to an existing response. */
function withCors(res: NextResponse, req: NextRequest): NextResponse {
  for (const [key, value] of Object.entries(corsHeaders(req))) {
    if (key === 'Vary') res.headers.append(key, value);
    else res.headers.set(key, value);
  }
  return res;
}

export async function proxy(req: NextRequest) {
  const { authToken, webPassword, webSessionSecret } = readRuntimeAuthConfig();
  const pathname = req.nextUrl.pathname;

  function next(): NextResponse {
    const newHeaders = new Headers(req.headers);
    newHeaders.set('x-pathname', pathname);
    return NextResponse.next({ request: { headers: newHeaders } });
  }

  // Participant and reviewer pages contain no vault shell. Their exact API routes authenticate
  // scoped invitations themselves, never the owner bearer or wildcard CORS.
  if (/^\/(?:api\/)?study\/longitudinal\/cohort-[a-f0-9]{24}(?:\/session)?\/?$/.test(pathname) || /^\/study\/(?:participate|review)\/study-[a-f0-9]{24}\/?$/.test(pathname)
    || /^\/api\/study\/(?:participate|review)\/study-[a-f0-9]{24}(?:\/session)?\/?$/.test(pathname)) {
    const response = next();
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return response;
  }

  // --- API protection (AUTH_TOKEN / WEB_PASSWORD) + CORS ---
  if (pathname.startsWith('/api/')) {
    // Handle preflight (OPTIONS) requests
    if (req.method === 'OPTIONS') {
      return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
    }

    // Contract-declared public routes (health/connect discovery, OAuth callback,
    // /api/auth password validation) never require credentials.
    if (isPublicApiRoute(req.method, pathname)) return withCors(NextResponse.next(), req);

    // Open mode only when NEITHER a bearer token NOR a Web password exists. A
    // Web password alone must still gate the API, otherwise the login wall on
    // the UI is decorative.
    if (!authToken && !webPassword) return withCors(NextResponse.next(), req);

    // Exempt authenticated web UI sessions (valid JWT cookie = logged-in browser user)
    if (webPassword) {
      const token = req.cookies.get(WEB_SESSION_COOKIE_NAME)?.value ?? '';
      if (token && await verifyJwt(token, webSessionSecret)) return withCors(NextResponse.next(), req);
    }

    if (authToken) {
      // Preserve the open-browser-UI contract only when the UI has no password
      // AND the browser is on this machine. When a Web password exists,
      // Sec-Fetch-Site alone is not an auth signal: non-browser HTTP clients can
      // send the same header value. Without a password, a LAN browser that
      // loaded the UI over `0.0.0.0` would otherwise get token-free API access,
      // so the exemption is limited to a localhost `Host` (the proxy has no
      // socket to inspect) and denied outright behind a reverse proxy.
      if (
        !webPassword
        && req.headers.get('sec-fetch-site') === 'same-origin'
        && allowsSameOriginExemption({ headers: req.headers })
      ) {
        return withCors(NextResponse.next(), req);
      }

      // External / cross-origin requests must provide a bearer token
      const header = req.headers.get('authorization') ?? '';
      const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (bearer === authToken) return withCors(NextResponse.next(), req);
    }

    // Web password without a valid session, or bearer mismatch.
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), req);
  }

  // --- Entry redirects (/ and /echo) ---
  // Redirecting /echo here yields a true 307 before rendering starts. `/`
  // is the product Home page and only redirects while setup is pending.
  // The proxy runs on the Node.js runtime in Next 16, so the fs read inside
  // readSetupPending() is allowed.
  if (pathname === '/' || pathname === '/echo') {
    if (readSetupPending()) {
      return NextResponse.redirect(new URL('/setup', req.url), 307);
    }
    if (pathname === '/echo') {
      return NextResponse.redirect(new URL(defaultEchoPath(), req.url), 307);
    }
    // `/` falls through to render the home page (behind the login wall below).
  }

  // --- Web UI protection (WEB_PASSWORD) ---
  if (!webPassword) return next();

  // Login page itself always passes through
  if (pathname === '/login') return next();

  // Verify JWT session cookie
  const token = req.cookies.get(WEB_SESSION_COOKIE_NAME)?.value ?? '';
  const session = token ? await verifyJwt(token, webSessionSecret) : null;
  if (session) return next();

  // Not authenticated: redirect to /login
  const loginUrl = new URL('/login', req.url);
  const redirectTarget = buildLoginRedirectTarget(pathname, req.nextUrl.search);
  if (redirectTarget) loginUrl.searchParams.set('redirect', redirectTarget);
  if (token) loginUrl.searchParams.set('reason', 'expired');
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon\\.ico).*)',
  ],
};
