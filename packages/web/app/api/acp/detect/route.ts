export const dynamic = 'force-dynamic';

import { handleAcpDetectGet, type AcpDetectServices } from '@geminilight/mindos/server';
import { detectLocalAcpAgents } from '@/lib/acp/detect-local';
import { readSettings } from '@/lib/settings';
import { toNextResponse } from '../../_mindos-adapter';

const services: AcpDetectServices = {
  readSettings: readSettings as AcpDetectServices['readSettings'],
  detectLocalAcpAgents: detectLocalAcpAgents as AcpDetectServices['detectLocalAcpAgents'],
};

export async function GET(req: Request) {
  return toNextResponse(await handleAcpDetectGet(new URL(req.url).searchParams, services));
}
