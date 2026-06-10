export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { handleCodexThreadsGet } from '@geminilight/mindos/server';
import { toNextResponse } from '@/app/api/_mindos-adapter';
import { getMindRoot } from '@/lib/fs';

export async function GET(req: Request) {
  const searchParams = new URL(req.url).searchParams;
  if (!searchParams.has('cwd')) searchParams.set('cwd', getMindRoot());
  return toNextResponse(await handleCodexThreadsGet(searchParams));
}
