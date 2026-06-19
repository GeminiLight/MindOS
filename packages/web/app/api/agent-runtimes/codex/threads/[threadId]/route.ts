export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { handleCodexThreadGet } from '@geminilight/mindos/server';
import { toNextResponse } from '@/app/api/_mindos-adapter';
import { codexThreadServices } from '../../_services';

type RouteContext = {
  params: Promise<{ threadId: string }>;
};

export async function GET(req: Request, context: RouteContext) {
  const params = await context.params;
  return toNextResponse(await handleCodexThreadGet(
    params.threadId,
    new URL(req.url).searchParams,
    codexThreadServices,
  ));
}
