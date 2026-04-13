export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { handleRouteErrorSimple } from '@/lib/errors';
import {
  isLocalModelDownloaded,
  downloadLocalModel,
  DEFAULT_LOCAL_MODEL,
  LOCAL_MODEL_OPTIONS,
} from '@/lib/core/embedding-provider';
import { getEmbeddingStatus } from '@/lib/core/hybrid-search';

/**
 * GET /api/embedding — Check local model status.
 * Returns: { downloaded, downloading, modelId, models[], status }
 */
export async function GET() {
  try {
    const downloaded = await isLocalModelDownloaded();
    const status = getEmbeddingStatus();
    return NextResponse.json({
      downloaded,
      defaultModel: DEFAULT_LOCAL_MODEL,
      models: LOCAL_MODEL_OPTIONS,
      ...status,
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}

// Track download state
let _downloading = false;
let _downloadError: string | null = null;

/**
 * POST /api/embedding — Download local model.
 * Body: { action: "download", model?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { action: string; model?: string };

    if (body.action === 'download') {
      if (_downloading) {
        return NextResponse.json({ ok: false, error: 'Download already in progress' });
      }

      const modelId = body.model || DEFAULT_LOCAL_MODEL;
      _downloading = true;
      _downloadError = null;

      // Run download async — don't block the response
      downloadLocalModel(modelId)
        .then(ok => {
          _downloading = false;
          if (!ok) {
            _downloadError = 'Download failed. Check your network connection and try again.';
          }
        })
        .catch(err => {
          _downloading = false;
          const errMsg = err instanceof Error ? err.message : String(err);
          const lowerMsg = errMsg.toLowerCase();
          
          // Classify error for user-friendly message
          if (lowerMsg.includes('timeout') || lowerMsg.includes('took too long')) {
            _downloadError = 'Download timeout. Your connection may be too slow. Try again or use API mode.';
          } else if (
            lowerMsg.includes('enotfound') ||
            lowerMsg.includes('econnrefused') ||
            lowerMsg.includes('econnreset') ||
            lowerMsg.includes('net::err_internet_disconnected')
          ) {
            _downloadError = 'Network connection failed. Check your internet and try again.';
          } else if (lowerMsg.includes('permission denied') || lowerMsg.includes('eacces')) {
            _downloadError = 'Permission denied. Check cache directory permissions (~/.cache/huggingface/).';
          } else if (lowerMsg.includes('disk quota') || lowerMsg.includes('no space')) {
            _downloadError = 'Not enough disk space. Free up space and try again.';
          } else {
            _downloadError = `Download failed: ${errMsg.slice(0, 200)}`;
          }
          console.error('[embedding/POST] Download error:', {
            model: modelId,
            originalError: errMsg,
            displayedError: _downloadError,
          });
        });

      return NextResponse.json({ ok: true, message: `Downloading ${modelId}...` });
    }

    if (body.action === 'status') {
      const downloaded = await isLocalModelDownloaded(body.model);
      return NextResponse.json({
        downloading: _downloading,
        downloaded,
        error: _downloadError,
      });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
