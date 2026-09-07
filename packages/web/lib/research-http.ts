import { NextRequest, NextResponse } from 'next/server';
import { LearningError } from '@geminilight/mindos/knowledge';
import { readRuntimeAuthConfig } from '@/lib/runtime-auth-config';
import { verifyJwt } from '@/lib/jwt';
import { WEB_SESSION_COOKIE_NAME } from '@/lib/auth-session';
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function ownerBoundary(req: NextRequest) {
  const denied = sameOriginBoundary(req); if (denied) return denied;
  const { webPassword, webSessionSecret } = readRuntimeAuthConfig();
  // A shared Agent bearer token must not bypass a configured browser password here.
  // Open local instances retain their existing owner-access contract; this is not a participant API.
  if (webPassword) {
    const token = req.cookies.get(WEB_SESSION_COOKIE_NAME)?.value;
    if (!token || !await verifyJwt(token, webSessionSecret)) return json({ code: 'unauthorized' }, 401);
  }
  return null;
}
export function failure(error: unknown) {
  const code = error instanceof LearningError ? error.code : 'storage';
  return json({ code }, { invalid: 400, conflict: 409, 'not-found': 404, storage: 500 }[code]);
}
export async function body(req: NextRequest) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = req.body?.getReader(); if (!reader) throw new Error('Missing body');
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Upload timed out')), 15_000); });
    const decoder = new TextDecoder(); let content = ''; let bytes = 0;
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline]); if (done) break;
      bytes += value.byteLength; if (bytes > 800_000) { await reader.cancel(); throw new Error('Too large'); }
      content += decoder.decode(value, { stream: true });
    }
    content += decoder.decode();
    const input: unknown = JSON.parse(content);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid body');
    return input as Record<string, unknown>;
  } catch { void reader?.cancel().catch(() => {}); throw new LearningError('invalid', 'Invalid study request.'); }
  finally { if (timer) clearTimeout(timer); }
}

export function sameOriginBoundary(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (req.headers.get('sec-fetch-site') === 'cross-site') return json({ code: 'forbidden' }, 403);
  if (origin) {
    try {
      // Next can normalize loopback request URLs to localhost. Host retains the
      // browser's address; use it for CSRF comparison, never as authentication.
      const expected = new URL(req.nextUrl.origin); expected.host = req.headers.get('host') ?? req.nextUrl.host;
      if (new URL(origin).origin !== origin || origin !== expected.origin) return json({ code: 'forbidden' }, 403);
    } catch { return json({ code: 'forbidden' }, 403); }
  }
  return null;
}
