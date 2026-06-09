export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { handleAgentRuntimesGet, type AgentRuntimesServices } from '@geminilight/mindos/server';
import { checkNativeRuntimeHealth, detectLocalAcpAgents, resolveCommandPath } from '@/lib/acp/detect-local';
import { readSettings } from '@/lib/settings';
import { toNextResponse } from '../_mindos-adapter';

const services: AgentRuntimesServices = {
  readSettings: readSettings as AgentRuntimesServices['readSettings'],
  detectLocalAcpAgents: detectLocalAcpAgents as AgentRuntimesServices['detectLocalAcpAgents'],
  resolveRuntimeCommand: resolveCommandPath as AgentRuntimesServices['resolveRuntimeCommand'],
  checkNativeRuntimeHealth: checkNativeRuntimeHealth as AgentRuntimesServices['checkNativeRuntimeHealth'],
};

export async function GET(req: Request) {
  return toNextResponse(await handleAgentRuntimesGet(new URL(req.url).searchParams, services));
}
