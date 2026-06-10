export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { handleAgentRuntimesGet, type AgentRuntimesServices } from '@geminilight/mindos/server';
import { checkNativeRuntimeHealth, detectLocalAcpAgents, resolveCommandPath } from '@/lib/acp/detect-local';
import { readSettings } from '@/lib/settings';
import { toNextResponse } from '../_mindos-adapter';
import { rememberAvailableNativeRuntimeDescriptorsFromPayload } from '@/lib/agent/native-runtime-descriptor-cache';

const services: AgentRuntimesServices = {
  readSettings: readSettings as AgentRuntimesServices['readSettings'],
  detectLocalAcpAgents: detectLocalAcpAgents as AgentRuntimesServices['detectLocalAcpAgents'],
  resolveRuntimeCommand: resolveCommandPath as AgentRuntimesServices['resolveRuntimeCommand'],
  checkNativeRuntimeHealth: checkNativeRuntimeHealth as AgentRuntimesServices['checkNativeRuntimeHealth'],
};

export async function GET(req: Request) {
  const response = await handleAgentRuntimesGet(new URL(req.url).searchParams, services);
  if (response.status === 200) {
    rememberAvailableNativeRuntimeDescriptorsFromPayload(response.body);
  }
  return toNextResponse(response);
}
