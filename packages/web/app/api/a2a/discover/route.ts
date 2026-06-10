export const dynamic = 'force-dynamic';

import { handleA2aDiscoverPost, type A2aServices } from '@geminilight/mindos/server';
import { discoverAgent } from '@/lib/a2a/client';
import { validateA2aDiscoveryUrl } from '@/lib/a2a/discovery-policy';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../../_mindos-adapter';

const services: A2aServices = {
  discoverAgent: discoverAgent as A2aServices['discoverAgent'],
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const url = body && typeof body === 'object' ? (body as { url?: unknown }).url : undefined;
    if (typeof url === 'string' && url.trim()) {
      const decision = validateA2aDiscoveryUrl(url);
      if (!decision.ok) {
        return Response.json({ error: decision.message, agent: null }, { status: 400 });
      }
      (body as { url: string }).url = decision.url;
    }
    return toNextResponse(await handleA2aDiscoverPost(body, services));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}
