export const dynamic = 'force-dynamic';

import { handleA2aDelegationsGet, type A2aServices } from '@geminilight/mindos/server';
import { getDelegationHistory } from '@/lib/a2a/client';
import { toNextResponse } from '../../_mindos-adapter';

const services: A2aServices = {
  getDelegationHistory,
};

export function GET() {
  return toNextResponse(handleA2aDelegationsGet(services));
}
