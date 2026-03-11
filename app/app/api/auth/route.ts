export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { signJwt } from '@/lib/jwt';

const COOKIE_NAME = 'mindos-session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// POST /api/auth — validate password and set JWT session cookie
export async function POST(req: NextRequest) {
  const webPassword = process.env.WEB_PASSWORD;
  if (!webPassword) return NextResponse.json({ ok: false }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { password?: string };
  if (body.password !== webPassword) return NextResponse.json({ ok: false }, { status: 401 });

  const token = await signJwt(
    { sub: 'user', exp: Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE },
    webPassword,
  );

  // Only set Secure flag when served over HTTPS (x-forwarded-proto set by reverse proxy)
  const isHttps = req.headers.get('x-forwarded-proto') === 'https';
  const secure = isHttps ? '; Secure' : '';
  const res = NextResponse.json({ ok: true });
  res.headers.set(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}; Path=/${secure}`,
  );
  return res;
}

// DELETE /api/auth — clear session cookie (logout)
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.headers.set('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/`);
  return res;
}
