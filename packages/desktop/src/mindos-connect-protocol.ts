/**
 * Custom scheme so connect / mode-select UI loads reliably.
 *
 * `file://` from app.asar or app.asar.unpacked is flaky on macOS (sandbox, codesign, asar FS).
 * This protocol reads files from disk via `readFileSync` and returns them as Response bodies.
 */
import { protocol } from 'electron';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { resolvePreferUnpacked } from './resolve-packaged-asset';

const HOST = 'bundle';

let registered = false;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function safeResolvePathname(pathname: string): string | null {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.some((s) => s === '..' || s === '.')) return null;
  if (segs.length === 0) return null;
  return resolvePreferUnpacked(...segs);
}

/** Call once inside `app.whenReady()` before opening connect / mode windows. */
export function registerMindosConnectProtocol(): void {
  if (registered) return;
  registered = true;

  protocol.handle('mindos-connect', (request) => {
    try {
      const u = new URL(request.url);
      if (u.hostname !== HOST) {
        return new Response('Not found', { status: 404 });
      }
      const abs = safeResolvePathname(u.pathname);
      if (!abs || !existsSync(abs)) {
        console.warn('[MindOS] mindos-connect:// 404:', u.pathname, '→', abs);
        return new Response('Not found', { status: 404 });
      }
      const ext = path.extname(abs).toLowerCase();
      const contentType = MIME[ext] || 'application/octet-stream';
      const body = readFileSync(abs);
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': contentType },
      });
    } catch (err) {
      console.error('[MindOS] mindos-connect:// error:', err);
      return new Response('Internal error', { status: 500 });
    }
  });
}

/** Load URL for connect UI; relative script URLs in connect.html resolve under the same host. */
export function mindosConnectPageUrl(query?: Record<string, string>): string {
  const base = `mindos-connect://${HOST}/src/connect.html`;
  if (!query || Object.keys(query).length === 0) return base;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) sp.set(k, v);
  return `${base}?${sp.toString()}`;
}

/** Must run before app ready (Electron requirement). */
export function registerMindosConnectSchemePrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'mindos-connect',
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}
