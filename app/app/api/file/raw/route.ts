export const dynamic = 'force-dynamic';
import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import { resolveSafe } from '@/lib/core/security';
import { getMindRoot } from '@/lib/fs';

/** MIME types for binary files served from the knowledge base */
const BINARY_MIME: Record<string, string> = {
  // Documents
  '.pdf': 'application/pdf',
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  // Video
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
};

/** Max file size: 200MB for media, protects against truly absurd files */
const MAX_RAW_SIZE = 200 * 1024 * 1024;

/**
 * GET /api/file/raw?path=<relative-path>
 *
 * Serve a binary file from the knowledge base with the correct Content-Type.
 * Supports HTTP Range requests for audio/video seeking (required by <audio>/<video>).
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

  const totalSize = stat.size;
  const rangeHeader = req.headers.get('range');

  // HTTP Range request — required for audio/video seeking
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = Math.min(parseInt(match[1], 10), totalSize - 1);
      const end = Math.min(match[2] ? parseInt(match[2], 10) : totalSize - 1, totalSize - 1);
      const chunkSize = end - start + 1;

      const buf = Buffer.alloc(chunkSize);
      const fd = fs.openSync(resolved, 'r');
      try {
        fs.readSync(fd, buf, 0, chunkSize, start);
      } finally {
        fs.closeSync(fd);
      }

      return new NextResponse(buf, {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=60',
        },
      });
    }
  }

  // Full file response
  const buf = fs.readFileSync(resolved);
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(totalSize),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=60',
      'Content-Disposition': 'inline',
    },
  });
}
