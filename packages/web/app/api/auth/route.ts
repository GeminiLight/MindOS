export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { signJwt } from '@/lib/jwt';
import { WEB_SESSION_COOKIE_NAME, WEB_SESSION_MAX_AGE_SECONDS } from '@/lib/auth-session';

// Allowed CORS origins for cross-origin auth (Capacitor, Electron remote).
// Localhost variants are always allowed; custom origins can be added here.
const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/\[::1\](:\d+)?$/,
  /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^capacitor:\/\//,
  /^file:\/\//,
];

function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGIN_PATTERNS.some((p) => p.test(origin));
}

/** CORS headers — validate origin against allowlist */
function getAuthCors(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin');
  // No origin header (same-origin browser request or non-browser client) → no CORS needed
  if (!origin) return {};
  // Validate origin
  if (!isAllowedOrigin(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

function withCors(res: NextResponse, req: NextRequest): NextResponse {
  for (const [k, v] of Object.entries(getAuthCors(req))) res.headers.set(k, v);
  return res;
}

// OPTIONS /api/auth — CORS preflight
export async function OPTIONS(req: NextRequest) {
  const headers = getAuthCors(req);
  if (Object.keys(headers).length === 0) {
    return new Response(null, { status: 204 });
  }
  return new Response(null, { status: 204, headers });
}

// POST /api/auth — validate password and set JWT session cookie
export async function POST(req: NextRequest) {
  const webPassword = process.env.WEB_PASSWORD;
  if (!webPassword) return withCors(NextResponse.json({ ok: false }, { status: 401 }), req);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return withCors(NextResponse.json({ error: 'Invalid request body' }, { status: 400 }), req);
  }
  const { password } = body as { password?: string };
  if (password !== webPassword) return withCors(NextResponse.json({ ok: false }, { status: 401 }), req);

  const token = await signJwt(
    { sub: 'user', exp: Math.floor(Date.now() / 1000) + WEB_SESSION_MAX_AGE_SECONDS },
    webPassword,
  );

  const isHttps = req.headers.get('x-forwarded-proto') === 'https';
  const origin = req.headers.get('origin');
  // Cross-origin requests need SameSite=None + Secure (HTTPS required by spec).
  // Same-origin or no-origin → use Lax (works over HTTP).
  const isCrossOrigin = !!origin && isAllowedOrigin(origin);
  const sameSite = isCrossOrigin && isHttps ? 'None' : 'Lax';
  const secure = isHttps ? '; Secure' : '';

  const res = NextResponse.json({ ok: true });
  res.headers.set(
    'Set-Cookie',
    `${WEB_SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=${sameSite}; Max-Age=${WEB_SESSION_MAX_AGE_SECONDS}; Path=/${secure}`,
  );
  return withCors(res, req);
}

// DELETE /api/auth — clear session cookie (logout)
export async function DELETE(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  res.headers.set('Set-Cookie', `${WEB_SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`);
  return withCors(res, req);
}
