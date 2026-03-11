/**
 * Minimal JWT implementation using Web Crypto (HMAC-SHA256).
 * Compatible with both Next.js Edge runtime (proxy) and Node.js API routes.
 */

const ALG = { name: 'HMAC', hash: 'SHA-256' };

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlEncode(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): string {
  return decodeURIComponent(escape(atob(str.replace(/-/g, '+').replace(/_/g, '/'))));
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    ALG,
    false,
    ['sign', 'verify'],
  );
}

export async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = b64urlEncode(JSON.stringify(payload));
  const key    = await importKey(secret);
  const sig    = await crypto.subtle.sign(ALG.name, key, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(sig)}`;
}

export async function verifyJwt(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts;
  const key = await importKey(secret);
  const valid = await crypto.subtle.verify(
    ALG.name,
    key,
    Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
    new TextEncoder().encode(`${header}.${body}`),
  );
  if (!valid) return null;

  const payload = JSON.parse(b64urlDecode(body)) as Record<string, unknown>;
  if (typeof payload.exp === 'number' && Date.now() / 1000 > payload.exp) return null;

  return payload;
}
