export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { handleCodexThreadForkPost } from '@geminilight/mindos/server';
import { toNextResponse } from '@/app/api/_mindos-adapter';
import { getMindRoot } from '@/lib/fs';
import { codexThreadServices } from '../../../_services';

type RouteContext = {
  params: Promise<{ threadId: string }>;
};

export async function POST(req: Request, context: RouteContext) {
  const params = await context.params;
  let body: unknown;
  const text = await req.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }
  } else {
    body = {};
  }
  const scopedBody = body && typeof body === 'object' && !Array.isArray(body) && !('cwd' in body)
    ? { ...body, cwd: getMindRoot() }
    : body;
  return toNextResponse(await handleCodexThreadForkPost(params.threadId, scopedBody, codexThreadServices));
}
