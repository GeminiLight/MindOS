export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { handleSetupListDirectories } from '@geminilight/mindos/server';
import { toNextResponse } from '../../_mindos-adapter';

export async function POST(req: NextRequest) {
  try {
    return toNextResponse(handleSetupListDirectories(await req.json()));
  } catch {
    return toNextResponse(handleSetupListDirectories({}));
  }
}
