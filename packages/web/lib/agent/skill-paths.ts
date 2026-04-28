import path from 'path';
import os from 'os';
import type { ServerSettings } from '@/lib/settings';

/**
 * Build the ordered list of skill search directories based on settings.
 * Single source of truth — all call sites should use this instead of hardcoding paths.
 *
 * Priority (high → low):
 *   1. packages/web/data/skills/ — app builtin (core)
 *   2. skills/             — project builtin
 *   3. {mindRoot}/.skills/ — user local (knowledge base)
 *   4. ~/.mindos/skills/   — MindOS global
 *   5. ~/.agents/skills/   — external agent skills (toggleable)
 *   6+ custom paths        — user-defined
 */
export function getSkillSearchPaths(
  projectRoot: string,
  mindRoot: string,
  settings?: Pick<ServerSettings, 'skillPaths'>,
): string[] {
  const home = os.homedir();
  const paths = [
    path.join(projectRoot, 'packages', 'web', 'data', 'skills'),
    path.join(projectRoot, 'skills'),
    path.join(mindRoot, '.skills'),
    path.join(home, '.mindos', 'skills'),
  ];

  // ~/.agents/skills — on by default, user can toggle off
  if (settings?.skillPaths?.enableAgentsDir !== false) {
    paths.push(path.join(home, '.agents', 'skills'));
  }

  // User-defined custom paths
  for (const p of settings?.skillPaths?.custom ?? []) {
    const trimmed = p.trim();
    if (trimmed) paths.push(trimmed);
  }

  return paths;
}

/**
 * Same as getSkillSearchPaths but appends skillName to each path.
 * Used by skill-resolver for per-skill directory lookup.
 */
export function getSkillDirCandidates(
  skillName: string,
  projectRoot: string,
  mindRoot: string,
  settings?: Pick<ServerSettings, 'skillPaths'>,
): string[] {
  return getSkillSearchPaths(projectRoot, mindRoot, settings)
    .map(dir => path.join(dir, skillName));
}
