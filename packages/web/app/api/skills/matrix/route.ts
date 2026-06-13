export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import path from 'path';
import os from 'os';
import {
  getSkillRootsFromRuntime,
  handleSkillMatrixGet,
  migrateInstalledSkillAgents,
  type MindosRuntimeSettings,
  type MindosSkillRoot,
} from '@geminilight/mindos/server';
import { clearInstalledSkillAgents, readInstalledSkillAgents, readSettings } from '@/lib/settings';
import { handleRouteErrorSimple } from '@/lib/errors';
import { getProjectRoot } from '@/lib/project-root';
import { listSkillLinkAgents } from '@/lib/mcp-agents';
import { toNextResponse } from '../../_mindos-adapter';

const PROJECT_ROOT = getProjectRoot();

export async function GET() {
  try {
    const settings = readSettings();
    const mindRoot = settings.mindRoot || process.env.MIND_ROOT || path.join(os.homedir(), 'MindOS', 'mind');
    const skillRoots = getSkillRootsFromRuntime({
      mindRoot,
      runtimeRoot: PROJECT_ROOT,
      homeDir: process.env.HOME || os.homedir(),
      settings: settings as unknown as MindosRuntimeSettings,
    });

    migrateLegacySkillInstalls(skillRoots);

    return toNextResponse(handleSkillMatrixGet({
      disabledSkills: settings.disabledSkills,
      skillRoots,
      listLinkAgents: listSkillLinkAgents,
    }));
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}

/**
 * One-time migration of legacy installedSkillAgents[] copy installs into
 * symlinks (spec 4.6). Failure never blocks the matrix request — it only
 * logs and leaves the records in place for the next attempt.
 */
function migrateLegacySkillInstalls(skillRoots: MindosSkillRoot[]): void {
  const records = readInstalledSkillAgents();
  if (records.length === 0) return;
  try {
    migrateInstalledSkillAgents({
      records,
      skillRoots,
      agents: listSkillLinkAgents(),
      warn: console.warn,
    });
    clearInstalledSkillAgents();
  } catch (err) {
    console.warn('[skills/matrix] legacy skill install migration failed:', err);
  }
}
