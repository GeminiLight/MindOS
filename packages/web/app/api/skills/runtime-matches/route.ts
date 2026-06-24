export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import path from 'path';
import os from 'os';
import {
  handleAgentRuntimesGet,
  handleSkillRuntimeMatchesGet,
  getSkillRootsFromRuntime,
  type AgentRuntimesServices,
  type MindosRuntimeSettings,
} from '@geminilight/mindos/server';
import { checkNativeRuntimeHealth, detectLocalAcpAgents, resolveCommandPath, resolveCommandPathCandidates } from '@/lib/acp/detect-local';
import { readSettings } from '@/lib/settings';
import { handleRouteErrorSimple } from '@/lib/errors';
import { getProjectRoot } from '@/lib/project-root';
import { toNextResponse } from '../../_mindos-adapter';

const PROJECT_ROOT = getProjectRoot();

const runtimeServices: AgentRuntimesServices = {
  readSettings: readSettings as AgentRuntimesServices['readSettings'],
  detectLocalAcpAgents: detectLocalAcpAgents as AgentRuntimesServices['detectLocalAcpAgents'],
  resolveRuntimeCommand: resolveCommandPath as AgentRuntimesServices['resolveRuntimeCommand'],
  resolveRuntimeCommandCandidates: resolveCommandPathCandidates as AgentRuntimesServices['resolveRuntimeCommandCandidates'],
  checkNativeRuntimeHealth: checkNativeRuntimeHealth as AgentRuntimesServices['checkNativeRuntimeHealth'],
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const settings = readSettings();
    const mindRoot = settings.mindRoot || process.env.MIND_ROOT || path.join(os.homedir(), 'MindOS', 'mind');
    const skillRoots = getSkillRootsFromRuntime({
      mindRoot,
      runtimeRoot: PROJECT_ROOT,
      homeDir: process.env.HOME || os.homedir(),
      settings: settings as unknown as MindosRuntimeSettings,
    });

    return toNextResponse(await handleSkillRuntimeMatchesGet(url.searchParams, {
      disabledSkills: settings.disabledSkills,
      skillRoots,
      listRuntimes: async () => {
        const runtimeParams = new URLSearchParams();
        if (url.searchParams.get('force') === '1') runtimeParams.set('force', '1');
        const runtimeResponse = await handleAgentRuntimesGet(runtimeParams, runtimeServices);
        if (runtimeResponse.status === 200 && runtimeResponse.body && 'runtimes' in runtimeResponse.body) {
          return runtimeResponse.body.runtimes;
        }
        throw new Error('Failed to build runtime descriptors for skill runtime matches.');
      },
    }));
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
