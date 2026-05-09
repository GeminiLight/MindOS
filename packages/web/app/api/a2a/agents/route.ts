export const dynamic = 'force-dynamic';

import { handleA2aAgentsGet, type A2aServices } from '@geminilight/mindos/server';
import { getDiscoveredAgents } from '@/lib/a2a/client';
import { toNextResponse } from '../../_mindos-adapter';

const services: A2aServices = {
  getDiscoveredAgents,
};

export function GET() {
  return toNextResponse(handleA2aAgentsGet(services));
}
