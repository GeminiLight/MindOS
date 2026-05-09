export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { handleSetupCheckPath } from '@geminilight/mindos/server';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../../_mindos-adapter';

export async function POST(req: NextRequest) {
  try {
    return toNextResponse(handleSetupCheckPath(await req.json()));
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
