export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import {
  handleAgentRuntimePermissionProjectionsGet,
  handleAgentRuntimesGet,
  type AgentRuntimesServices,
} from '@geminilight/mindos/server';
import { checkNativeRuntimeHealth, detectLocalAcpAgents, resolveCommandPath, resolveCommandPathCandidates } from '@/lib/acp/detect-local';
import { readSettings } from '@/lib/settings';
import { toNextResponse } from '../../_mindos-adapter';

const runtimeServices: AgentRuntimesServices = {
  readSettings: readSettings as AgentRuntimesServices['readSettings'],
  detectLocalAcpAgents: detectLocalAcpAgents as AgentRuntimesServices['detectLocalAcpAgents'],
  resolveRuntimeCommand: resolveCommandPath as AgentRuntimesServices['resolveRuntimeCommand'],
  resolveRuntimeCommandCandidates: resolveCommandPathCandidates as AgentRuntimesServices['resolveRuntimeCommandCandidates'],
  checkNativeRuntimeHealth: checkNativeRuntimeHealth as AgentRuntimesServices['checkNativeRuntimeHealth'],
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  return toNextResponse(await handleAgentRuntimePermissionProjectionsGet(url.searchParams, {
    listRuntimes: async () => {
      const runtimeParams = new URLSearchParams();
      if (url.searchParams.get('force') === '1') runtimeParams.set('force', '1');
      const response = await handleAgentRuntimesGet(runtimeParams, runtimeServices);
      if (response.status === 200 && response.body && 'runtimes' in response.body) return response.body.runtimes;
      throw new Error('Failed to build runtime descriptors for permission projections.');
    },
  }));
}
