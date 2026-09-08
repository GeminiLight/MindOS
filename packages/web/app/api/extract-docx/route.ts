export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { EXTRACT_DOCX_MAX_BODY_BYTES, handleExtractDocxPost } from '@geminilight/mindos/server';
import { isPayloadTooLarge, payloadTooLargeResponse, readJsonBodyWithLimit } from '@/lib/api/request-utils';
import { toNextResponse } from '../_mindos-adapter';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    // Same byte ceiling as the product HTTP server so both entry points reject
    // oversized uploads before buffering them.
    body = await readJsonBodyWithLimit(req, EXTRACT_DOCX_MAX_BODY_BYTES);
  } catch (err) {
    if (isPayloadTooLarge(err)) return payloadTooLargeResponse(EXTRACT_DOCX_MAX_BODY_BYTES);
    body = undefined;
  }
  return toNextResponse(await handleExtractDocxPost(body));
}
