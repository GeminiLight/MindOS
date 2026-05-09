export const dynamic = 'force-dynamic';
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
    return toNextResponse(handleSkillsPost(body, {
      mindRoot,
      skillRoots: getSkillRootsFromRuntime({
        mindRoot,
        runtimeRoot: PROJECT_ROOT,
        homeDir: process.env.HOME || os.homedir(),
        settings: settings as unknown as MindosRuntimeSettings,
      }),
      readSettings: () => readSettings() as unknown as MindosSkillsSettings,
      writeSettings: (nextSettings) => writeSettings(nextSettings as unknown as ReturnType<typeof readSettings>),
    }));
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
