export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import {
  getDefaultMindRoot,
  getSkillRootsFromRuntime,
  handleAgentCopySkillPost,
  type MindosRuntimeSettings,
} from '@geminilight/mindos/server';
import { readSettings } from '@/lib/settings';
import { getProjectRoot } from '@/lib/project-root';
import { toNextResponse } from '../../_mindos-adapter';

/**
 * POST — Copy a skill to a target agent's skill directory.
 */
export async function POST(req: NextRequest) {
  const settings = readSettings() as unknown as MindosRuntimeSettings;
  const mindRoot = getDefaultMindRoot({ readSettings: () => settings });
  return toNextResponse(await handleAgentCopySkillPost(await req.json(), {
    skillRoots: getSkillRootsFromRuntime({
      mindRoot,
      runtimeRoot: getProjectRoot(),
      settings,
    }),
  }));
}
