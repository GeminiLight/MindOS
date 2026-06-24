export const dynamic = 'force-dynamic';

import { handleAcpRegistryGet, type AcpRegistryServices } from '@geminilight/mindos/server';
import { fetchAcpRegistry, findAcpAgent } from '@/lib/acp/registry';
import { readSettings } from '@/lib/settings';
import { toNextResponse } from '../../_mindos-adapter';

const services: AcpRegistryServices = {
  readSettings: readSettings as AcpRegistryServices['readSettings'],
  fetchAcpRegistry: fetchAcpRegistry as AcpRegistryServices['fetchAcpRegistry'],
  findAcpAgent: findAcpAgent as AcpRegistryServices['findAcpAgent'],
};

export async function GET(req: Request) {
  return toNextResponse(await handleAcpRegistryGet(new URL(req.url).searchParams, services));
}
