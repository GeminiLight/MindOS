export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { handleBootstrapGet } from '@geminilight/mindos/server';
import { collectAllFiles, getFileContent } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../_mindos-adapter';

// GET /api/bootstrap?target_dir=Workflows/Research
export function GET(req: NextRequest) {
  try {
    return toNextResponse(handleBootstrapGet(req.nextUrl.searchParams, {
      collectAllFiles,
      readTextFile: getFileContent,
    }));
  } catch (e) {
    return handleRouteErrorSimple(e);
  }
}
