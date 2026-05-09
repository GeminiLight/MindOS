import { handleWorkflowsGet, handleWorkflowsPost } from '@geminilight/mindos/server';
import { getMindRoot } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../_mindos-adapter';

export function GET() {
  try {
    return toNextResponse(handleWorkflowsGet({ mindRoot: getMindRoot() }));
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}

export async function POST(req: Request) {
  try {
    return toNextResponse(handleWorkflowsPost(await req.json(), { mindRoot: getMindRoot() }));
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
