import { NextRequest } from 'next/server';
import {
  inquiryMethodOptions,
  LearningError,
} from '@geminilight/mindos/knowledge';
import { getMindRoot } from '@/lib/fs';
import { json, ownerBoundary, failure } from '@/lib/research-http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(req: NextRequest) {
  try {
    const denied = await ownerBoundary(req);
    if (denied) return denied;
    if (req.nextUrl.search)
      throw new LearningError(
        'invalid',
        'Method selection does not accept query parameters.',
      );
    return json({ methods: inquiryMethodOptions(getMindRoot()) });
  } catch (error) {
    return failure(error);
  }
}
