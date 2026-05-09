export const dynamic = 'force-dynamic';

import { handleA2aDiscoverPost, type A2aServices } from '@geminilight/mindos/server';
import { discoverAgent } from '@/lib/a2a/client';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../../_mindos-adapter';

const services: A2aServices = {
  discoverAgent: discoverAgent as A2aServices['discoverAgent'],
};

export async function POST(req: Request) {
  try {
    return toNextResponse(await handleA2aDiscoverPost(await req.json(), services));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}
