import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { resolveSafe } from '../../foundation/security/index.js';
import { type MindosServerResponse } from '../response.js';

export const STATIC_MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export type StaticArtifactHandlerOptions = {
  staticRoot?: string;
  path: string;
};

export function handleStaticArtifact(
  options: StaticArtifactHandlerOptions,
): MindosServerResponse<Buffer | { error: string }> | null {
  if (!options.staticRoot) return null;

  const requestPath = normalizeStaticRequestPath(options.path);
  const resolved = resolveStaticPath(options.staticRoot, requestPath);
  if (!resolved) return { status: 403, body: { error: 'Access denied' } };

  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    const fallback = resolveStaticPath(options.staticRoot, 'index.html');
    if (!fallback || !existsSync(fallback) || !statSync(fallback).isFile()) return null;
    return staticFileResponse(fallback, '.html', false);
  }

  return staticFileResponse(resolved, extname(resolved).toLowerCase(), isImmutableAsset(requestPath));
}

function normalizeStaticRequestPath(pathname: string): string {
  const withoutSlash = pathname.replace(/^\/+/, '');
  if (!withoutSlash || withoutSlash.endsWith('/')) return `${withoutSlash}index.html`;
  return withoutSlash;
}

function resolveStaticPath(root: string, filePath: string): string | null {
  try {
    return resolveSafe(root, filePath);
  } catch {
    return null;
  }
}

function staticFileResponse(resolved: string, ext: string, immutable: boolean): MindosServerResponse<Buffer> {
  const body = readFileSync(resolved);
  return {
    status: 200,
    body,
    headers: {
      'Content-Type': STATIC_MIME_TYPES[ext] ?? 'application/octet-stream',
      'Content-Length': String(body.length),
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    },
  };
}

function isImmutableAsset(requestPath: string): boolean {
  return requestPath.startsWith('_next/static/')
    || requestPath.startsWith('assets/')
    || /[.-][a-f0-9]{8,}\./i.test(requestPath);
}
