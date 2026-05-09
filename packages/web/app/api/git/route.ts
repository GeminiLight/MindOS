export const dynamic = 'force-dynamic';

import { handleGit } from '@geminilight/mindos/server';
import { NextRequest } from 'next/server';
import { getMindRoot } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../_mindos-adapter';

export async function GET(req: NextRequest) {
  try {
    return toNextResponse(await handleGit(req.nextUrl.searchParams, {
      mindRoot: getMindRoot(),
    }));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}
