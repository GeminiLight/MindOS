export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import path from 'path';
import os from 'os';
import {
  getSkillRootsFromRuntime,
  handleSkillsGet,
  handleSkillsPost,
  type MindosRuntimeSettings,
  type MindosSkillsSettings,
} from '@geminilight/mindos/server';
import { readSettings, writeSettings } from '@/lib/settings';
import { handleRouteErrorSimple } from '@/lib/errors';
import { getProjectRoot } from '@/lib/project-root';
import { toNextResponse } from '../_mindos-adapter';
import { expandHome, listSkillLinkAgents, MCP_AGENTS, resolveSkillWorkspaceProfile } from '@/lib/mcp-agents';
import { loadCustomAgents } from '@/lib/custom-agents';

const PROJECT_ROOT = getProjectRoot();

function getMindRoot(): string {
  const s = readSettings();
  return s.mindRoot || process.env.MIND_ROOT || path.join(os.homedir(), 'MindOS', 'mind');
}

export async function GET() {
  try {
    const settings = readSettings();
    const mindRoot = getMindRoot();
    return toNextResponse(handleSkillsGet({
      disabledSkills: settings.disabledSkills,
      skillRoots: getSkillRootsFromRuntime({
        mindRoot,
        runtimeRoot: PROJECT_ROOT,
        homeDir: process.env.HOME || os.homedir(),
        settings: settings as unknown as MindosRuntimeSettings,
      }),
    }));
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const settings = readSettings();
    const mindRoot = getMindRoot();
    const homeDir = process.env.HOME || os.homedir();
    return toNextResponse(handleSkillsPost(body, {
      mindRoot,
      skillRoots: getSkillRootsFromRuntime({
        mindRoot,
        runtimeRoot: PROJECT_ROOT,
        homeDir,
        settings: settings as unknown as MindosRuntimeSettings,
      }),
      trustedNativeSkillRoots: getTrustedNativeSkillRoots(),
      readSettings: () => readSettings() as unknown as MindosSkillsSettings,
      writeSettings: (nextSettings) => writeSettings(nextSettings as unknown as ReturnType<typeof readSettings>),
      listLinkAgents: listSkillLinkAgents,
    }));
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}

function getTrustedNativeSkillRoots(): string[] {
  const roots = new Set<string>();
  for (const key of Object.keys(MCP_AGENTS)) {
    const profile = resolveSkillWorkspaceProfile(key);
    if (profile.workspacePath) roots.add(profile.workspacePath);
  }
  for (const custom of loadCustomAgents()) {
    roots.add(expandHome(custom.skillDir || path.join(custom.baseDir, 'skills')));
  }
  return [...roots];
}
