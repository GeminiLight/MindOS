import { dirname, join, normalize, sep } from 'node:path';
import { expandHome } from './paths.js';
import type { ResolvedAgentConfigProbes } from './probes.js';
import { MINDOS_SELF_AGENT_KEY } from './registry.js';
import type { AgentConfigDef, SkillAgentRegistration, SkillWorkspaceProfile } from './types.js';

/** Shared workspace read by every "universal" agent (the `npx skills` convention). */
export const UNIVERSAL_SKILLS_DIR = '~/.agents/skills';

function normalizeDir(value: string): string {
  return normalize(value).replace(/[\\/]+$/g, '');
}

/**
 * The agent's own hidden root (`~/.claude`, `~/.codex`, ...): the presence dir
 * that contains its global config, else the first presence dir that exists
 * (a file stands for its directory), else the first declared presence dir,
 * else the global config's directory, else `~/.agents`. Deterministic even
 * when nothing exists yet, so a fresh machine still gets `~/.claude/skills`
 * rather than `~/skills`.
 */
export function resolveAgentHiddenRoot(def: AgentConfigDef, probes: ResolvedAgentConfigProbes): string {
  const globalConfigDir = def.global ? dirname(expandHome(def.global, probes.homeDir)) : null;
  const presenceDirs = (def.presenceDirs ?? []).map((entry) => expandHome(entry, probes.homeDir));

  if (globalConfigDir) {
    const normalizedGlobal = normalizeDir(globalConfigDir);
    const matching = presenceDirs.find((candidate) => {
      const normalizedCandidate = normalizeDir(candidate);
      return normalizedGlobal === normalizedCandidate || normalizedGlobal.startsWith(`${normalizedCandidate}${sep}`);
    });
    if (matching) return normalizeDir(matching);
  }

  for (const candidate of presenceDirs) {
    if (!probes.pathExists(candidate)) continue;
    try {
      return probes.stat(candidate).isFile() ? dirname(candidate) : normalizeDir(candidate);
    } catch {
      return normalizeDir(candidate);
    }
  }

  if (presenceDirs[0]) return normalizeDir(presenceDirs[0]);
  return globalConfigDir ?? expandHome('~/.agents', probes.homeDir);
}

/**
 * Where MindOS installs skills for `agentKey`: universal agents share
 * `~/.agents/skills`; everyone else gets the agent's declared `skillDir` or
 * `<hidden root>/skills`. The MindOS self row reports universal mode over its
 * own `~/.mindos/skills` (the host may replace it with its real skill list).
 */
export function resolveSkillWorkspaceProfile(
  agentKey: string,
  def: AgentConfigDef,
  registration: SkillAgentRegistration | undefined,
  probes: ResolvedAgentConfigProbes,
): SkillWorkspaceProfile {
  if (registration?.mode === 'universal') {
    return { mode: 'universal', workspacePath: expandHome(UNIVERSAL_SKILLS_DIR, probes.homeDir) };
  }
  return {
    mode: agentKey === MINDOS_SELF_AGENT_KEY ? 'universal' : registration?.mode ?? 'unsupported',
    skillAgentName: registration?.skillAgentName,
    workspacePath: def.skillDir
      ? expandHome(def.skillDir, probes.homeDir)
      : join(resolveAgentHiddenRoot(def, probes), 'skills'),
  };
}

export type ListInstalledSkillNamesOptions = {
  /** Only count entries that carry a `SKILL.md` (what agents actually load); default lists every visible directory. */
  requireSkillFile?: boolean;
};

/** Skill names installed in `workspacePath`: visible directories or symlinks, sorted. */
export function listInstalledSkillNames(
  workspacePath: string,
  probes: ResolvedAgentConfigProbes,
  options: ListInstalledSkillNamesOptions = {},
): string[] {
  if (!probes.pathExists(workspacePath)) return [];
  let entries;
  try {
    entries = probes.readDir(workspacePath);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith('.'))
    .filter((entry) => !options.requireSkillFile || probes.pathExists(join(workspacePath, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}
