export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { handleCodexThreadArchivePost } from '@geminilight/mindos/server';
import { toNextResponse } from '@/app/api/_mindos-adapter';

type RouteContext = {
  params: Promise<{ threadId: string }>;
};

export async function POST(_req: Request, context: RouteContext) {
  const params = await context.params;
  return toNextResponse(await handleCodexThreadArchivePost(params.threadId));
}
