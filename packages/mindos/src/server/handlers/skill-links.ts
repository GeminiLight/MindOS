import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  createSkillLink,
  directoriesHaveSameContent,
  lstatSafe,
  parseSkillFrontmatter,
  resolveSkillSourceDir,
  cellDirsOf,
  errorMessage,
  getSkillCellStatus,
  isSkillCellEnabled,
  MINDOS_DISABLED_DIR,
  MINDOS_MANAGED_MARKER,
  type SkillCellStatus,
  type SkillLinkAgent,
  type SkillLinkAgentMode,
  type SkillLinkDeps,
  type SkillLinkOutcome,
} from '../../agent/config/skill-link.js';
import { MINDOS_SELF_AGENT_KEY } from '../../agent/config/registry.js';
import type { MindosSkillInfo, MindosSkillRoot } from './skills.js';
import { emptySkillRuntimeRequirements } from './skill-metadata.js';

/**
 * Skills matrix read model and the legacy copy-install migration. The link /
 * unlink / disable / enable primitives live in `agent/config/skill-link.ts`
 * (shared with `POST /api/mcp/install-skill` and the CLI bundle) and are
 * re-exported here under their historical `Mindos*` names.
 */
export {
  disableNativeSkill,
  enableNativeSkill,
  getSkillCellStatus,
  isSkillCellEnabled,
  linkSkillToAgent,
  MINDOS_DISABLED_DIR,
  MINDOS_MANAGED_MARKER,
  resolveSkillSourceDir,
  unlinkSkillFromAgent,
} from '../../agent/config/skill-link.js';
export { MINDOS_SELF_AGENT_KEY };

export type MindosSkillLinkAgentMode = SkillLinkAgentMode;
export type MindosSkillLinkAgent = SkillLinkAgent;
export type MindosSkillLinkDeps = SkillLinkDeps;
export type MindosSkillCellStatus = SkillCellStatus;
export type MindosSkillLinkOutcome = SkillLinkOutcome;

export type MindosSkillMatrixAgent = {
  key: string;
  name: string;
  mode: 'self' | MindosSkillLinkAgentMode;
  skillDir?: string;
};

export type MindosSkillMatrixCell = {
  enabled: boolean;
  status: MindosSkillCellStatus | 'enabled' | 'disabled';
};

export type MindosSkillMatrix = {
  skills: Array<Pick<MindosSkillInfo, 'name' | 'description' | 'source' | 'origin' | 'path' | 'runtimeRequirements'>>;
  agents: MindosSkillMatrixAgent[];
  state: Record<string, Record<string, boolean>>;
  cells: Record<string, Record<string, MindosSkillMatrixCell>>;
};

export type MindosSkillInstallRecord = { agent: string; skill: string; path: string };

export type MindosSkillMigrationResult = {
  converted: Array<{ agent: string; skill: string }>;
  marked: Array<{ agent: string; skill: string }>;
  skipped: Array<{ agent: string; skill: string; reason: string }>;
};

/* ── Matrix read model (spec 4.2) ─────────────────────────────── */

/**
 * Compute the unified (skill × agent) matrix. The MindOS column reads
 * `disabledSkills`; external agent columns read link existence on disk.
 */
export function buildSkillMatrix(options: {
  skills: MindosSkillInfo[];
  agents: MindosSkillLinkAgent[];
  disabledSkills?: string[];
}): MindosSkillMatrix {
  const disabled = new Set(options.disabledSkills ?? []);
  const agents: MindosSkillMatrixAgent[] = [
    { key: MINDOS_SELF_AGENT_KEY, name: 'MindOS', mode: 'self' },
    ...options.agents.map((agent) => ({
      key: agent.key,
      name: agent.name,
      mode: agent.mode,
      skillDir: agent.skillDir,
    })),
  ];

  // Skills parked under some agent's .mindos-disabled may have vanished from
  // the skill roots entirely (their body dir doubled as a root, e.g. Codex's
  // ~/.codex/skills). They must stay visible here, or they become
  // unrestorable from any UI.
  const baseSkills = options.skills.map(({ name, description, source, origin, path, runtimeRequirements }) => ({
    name,
    description,
    source,
    origin,
    path,
    runtimeRequirements,
  }));
  const parkedOnly = collectParkedOnlySkills(options.agents, new Set(baseSkills.map((skill) => skill.name)));
  const allSkills = [...baseSkills, ...parkedOnly].sort((a, b) => a.name.localeCompare(b.name));
  const parkedOnlyNames = new Set(parkedOnly.map((skill) => skill.name));

  const state: MindosSkillMatrix['state'] = {};
  const cells: MindosSkillMatrix['cells'] = {};
  for (const skill of allSkills) {
    // A parked body is not loadable by MindOS either — its self cell is off.
    const selfEnabled = !parkedOnlyNames.has(skill.name) && !disabled.has(skill.name);
    const stateRow: Record<string, boolean> = { [MINDOS_SELF_AGENT_KEY]: selfEnabled };
    const cellRow: Record<string, MindosSkillMatrixCell> = {
      [MINDOS_SELF_AGENT_KEY]: { enabled: selfEnabled, status: selfEnabled ? 'enabled' : 'disabled' },
    };
    for (const agent of options.agents) {
      const status = getSkillCellStatus(agent, skill.name);
      const enabled = isSkillCellEnabled(status);
      stateRow[agent.key] = enabled;
      cellRow[agent.key] = { enabled, status };
    }
    state[skill.name] = stateRow;
    cells[skill.name] = cellRow;
  }

  return {
    skills: allSkills,
    agents,
    state,
    cells,
  };
}

/** Skills that exist ONLY as parked copies in some agent's .mindos-disabled dir. */
function collectParkedOnlySkills(
  agents: MindosSkillLinkAgent[],
  knownNames: Set<string>,
): MindosSkillMatrix['skills'] {
  const found: MindosSkillMatrix['skills'] = [];
  for (const agent of agents) {
    for (const dir of cellDirsOf(agent)) {
      const parkedBase = join(dir, MINDOS_DISABLED_DIR);
      if (!existsSync(parkedBase)) continue;
      let entries;
      try {
        entries = readdirSync(parkedBase, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || knownNames.has(entry.name)) continue;
        const skillFile = join(parkedBase, entry.name, 'SKILL.md');
        if (!existsSync(skillFile)) continue;
        let description = entry.name;
        try {
          description = parseSkillFrontmatter(readFileSync(skillFile, 'utf-8')).description || entry.name;
        } catch {
          // unreadable frontmatter — keep the name as description
        }
        knownNames.add(entry.name);
        // Keyed by the directory name — that is what restore operates on.
        found.push({
          name: entry.name,
          description,
          source: 'builtin',
          origin: 'custom',
          path: skillFile,
          runtimeRequirements: emptySkillRuntimeRequirements(),
        });
      }
    }
  }
  return found;
}

/* ── One-time migration of legacy copy installs (spec 4.6) ────── */

/**
 * Convert legacy `installedSkillAgents[]` copy installs into symlinks.
 * Content-identical copies are replaced with links. User-modified copies are
 * left untouched and reported as skipped; marking them as managed would make a
 * later unlink eligible to delete user-owned files. Never throws per record.
 */
export function migrateInstalledSkillAgents(options: {
  records: MindosSkillInstallRecord[];
  skillRoots: MindosSkillRoot[];
  agents: MindosSkillLinkAgent[];
  warn?: (message: string) => void;
  deps?: MindosSkillLinkDeps;
}): MindosSkillMigrationResult {
  const warn = options.warn ?? (() => {});
  const byKey = new Map(options.agents.map((agent) => [agent.key, agent]));
  const result: MindosSkillMigrationResult = { converted: [], marked: [], skipped: [] };

  for (const record of options.records) {
    const tag = { agent: record.agent, skill: record.skill };
    try {
      const agent = byKey.get(record.agent);
      if (!agent) {
        result.skipped.push({ ...tag, reason: 'agent not present' });
        continue;
      }
      const linkPath = join(agent.skillDir, record.skill);
      const stat = lstatSafe(linkPath);
      if (!stat) {
        result.skipped.push({ ...tag, reason: 'install path missing' });
        continue;
      }
      if (stat.isSymbolicLink()) {
        result.skipped.push({ ...tag, reason: 'already a link' });
        continue;
      }
      if (!stat.isDirectory()) {
        result.skipped.push({ ...tag, reason: 'not a directory' });
        continue;
      }

      const sourceDir = resolveSkillSourceDir(record.skill, options.skillRoots);
      if (!sourceDir) {
        result.skipped.push({ ...tag, reason: 'skill body not found' });
        continue;
      }
      if (resolve(linkPath) === resolve(sourceDir)) {
        // The install path IS the skill body (shared universal dir) — converting
        // it would delete the body and leave a self-referencing link.
        result.skipped.push({ ...tag, reason: 'install path is the skill body' });
        continue;
      }
      if (directoriesHaveSameContent(sourceDir, linkPath)) {
        rmSync(linkPath, { recursive: true, force: true });
        createSkillLink(sourceDir, linkPath, options.deps ?? {});
        result.converted.push(tag);
      } else {
        warn(`skill copy at ${linkPath} differs from its body; kept as user-owned and not migrated`);
        result.skipped.push({ ...tag, reason: 'copy differs from skill body' });
      }
    } catch (error) {
      warn(`failed to migrate skill install ${record.agent}/${record.skill}: ${errorMessage(error)}`);
      result.skipped.push({ ...tag, reason: errorMessage(error) });
    }
  }

  return result;
}
