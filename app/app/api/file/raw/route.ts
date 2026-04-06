export const dynamic = 'force-dynamic';
import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import { resolveSafe } from '@/lib/core/security';
import { getMindRoot } from '@/lib/fs';

/** MIME types for binary files served from the knowledge base */
const BINARY_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

/** Max file size to serve inline (50MB — protects against OOM) */
const MAX_RAW_SIZE = 50 * 1024 * 1024;

/**
 * GET /api/file/raw?path=<relative-path>
 *
 * Serve a binary file from the knowledge base with the correct Content-Type.
 * Used by the PDF renderer (iframe src) and any future binary file viewers.
 *
 * Security: path is resolved via resolveSafe() which prevents traversal attacks.
 */
export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get('path');
  if (!filePath) {
    return NextResponse.json({ error: 'Missing path parameter' }, { status: 400 });
  }

  const lower = filePath.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf('.'));
  const mime = BINARY_MIME[ext];
  if (!mime) {
    return NextResponse.json({ error: `Unsupported binary file type: ${ext}` }, { status: 400 });
  }

  let resolved: string;
  try {
    resolved = resolveSafe(getMindRoot(), filePath);
  } catch {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const stat = fs.statSync(resolved);
  if (stat.size > MAX_RAW_SIZE) {
    return NextResponse.json(
      { error: `File too large (${Math.round(stat.size / 1024 / 1024)}MB). Max: ${MAX_RAW_SIZE / 1024 / 1024}MB` },
      { status: 413 },
    );
  }
  const buf = fs.readFileSync(resolved);

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(stat.size),
      // Allow browser to cache; ETag via size+mtime for cache invalidation
      'Cache-Control': 'private, max-age=60',
      'Content-Disposition': 'inline',
    },
  });
}
