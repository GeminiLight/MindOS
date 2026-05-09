export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { handleRawFile } from '@geminilight/mindos/server';
import { getMindRoot } from '@/lib/fs';
import { toNextResponse } from '../../_mindos-adapter';

/**
 * GET /api/file/raw?path=<relative-path>
 *
 * Serve a binary file from the knowledge base with the correct Content-Type.
 * Supports HTTP Range requests for audio/video seeking (required by <audio>/<video>).
 *
 * Security: path is resolved via resolveSafe() which prevents traversal attacks.
 */
export async function GET(req: NextRequest) {
  return toNextResponse(handleRawFile(req.nextUrl.searchParams, {
    mindRoot: getMindRoot(),
  }, {
    range: req.headers.get('range'),
  }));
}
