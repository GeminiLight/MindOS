import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { MindosSkillInfo, MindosSkillRoot } from './skills.js';

/** Marker file written inside copy-fallback installs so uninstall can tell our copies from user directories. */
export const MINDOS_MANAGED_MARKER = '.mindos-managed';

/**
 * Where disabled native skills are parked: `{agentSkillDir}/.mindos-disabled/{skill}`.
 * Dot-prefixed, so every agent scanner skips it — "off without deleting".
 */
export const MINDOS_DISABLED_DIR = '.mindos-disabled';

export type MindosSkillLinkAgentMode = 'universal' | 'additional';

/** A downstream agent eligible for skill linking (present on this machine, skill-capable). */
export type MindosSkillLinkAgent = {
  key: string;
  name: string;
  mode: MindosSkillLinkAgentMode;
  skillDir: string;
  /**
   * The agent's OWN private skills directory when it differs from skillDir —
   * universal agents share ~/.agents/skills as skillDir but may also ship
   * skills in their own home (e.g. Codex's ~/.codex/skills). Skills living
   * here are natively ON for this agent; never shadow them with pool links.
   */
  nativeSkillDir?: string;
};

/** Injection points so tests can simulate platform/symlink failures. */
export type MindosSkillLinkDeps = {
  platform?: NodeJS.Platform;
  symlink?: (target: string, path: string, type: 'dir' | 'junction') => void;
};

export type MindosSkillCellStatus = 'linked' | 'copied' | 'broken' | 'conflict' | 'native-disabled' | 'none';

export type MindosSkillLinkOutcome =
  | { ok: true; result: 'linked' | 'copied' | 'already' | 'removed' | 'missing' | 'disabled' | 'enabled' }
  | { ok: false; code: 'skill-not-found' | 'conflict' | 'io-error'; message: string };

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
  skills: Array<Pick<MindosSkillInfo, 'name' | 'description' | 'source' | 'origin' | 'path'>>;
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

/* ── Skill source resolution (spec 4.8) ───────────────────────── */

/**
 * Find the on-disk body directory for a skill by name.
 * User-defined roots take priority over builtin roots; within the same
 * source class the skillRoots order is preserved.
 */
export function resolveSkillSourceDir(skill: string, skillRoots: MindosSkillRoot[]): string | null {
  const ordered = [...skillRoots].sort((a, b) => sourceRank(a) - sourceRank(b));
  for (const root of ordered) {
    if (!existsSync(root.path)) continue;
    if (root.origin === 'mindos-user' && lstatSync(root.path).isSymbolicLink()) continue;

    // Root itself is a single-skill directory (SKILL.md directly inside).
    const directSkillFile = join(root.path, 'SKILL.md');
    if (existsSync(directSkillFile) && statSync(directSkillFile).isFile()) {
      const parsed = parseSkillFrontmatter(readFileSync(directSkillFile, 'utf-8'));
      if ((parsed.name || basename(root.path)) === skill) return root.path;
    }

    // Fast path: sub-directory named exactly like the skill (frontmatter may rename it away).
    const exact = join(root.path, skill);
    const exactFile = join(exact, 'SKILL.md');
    if (existsSync(exactFile)) {
      const parsed = parseSkillFrontmatter(readFileSync(exactFile, 'utf-8'));
      if ((parsed.name || skill) === skill) return exact;
    }

    // Slow path: frontmatter name may differ from the directory name.
    for (const entry of readdirSync(root.path, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const skillFile = join(root.path, entry.name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;
      const parsed = parseSkillFrontmatter(readFileSync(skillFile, 'utf-8'));
      if ((parsed.name || entry.name) === skill) return join(root.path, entry.name);
    }
  }
  return null;
}

function sourceRank(root: MindosSkillRoot): number {
  return root.source === 'user' ? 0 : 1;
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: { name?: string; description?: string } = {};
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    if (key !== 'name' && key !== 'description') continue;
    result[key] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return result;
}

/* ── Cell status (single source of truth, spec 4.1) ───────────── */

/** What `{baseDir}/{skill}` is right now in ONE directory. */
function statusInDir(baseDir: string, skill: string): MindosSkillCellStatus {
  const linkPath = join(baseDir, skill);
  let stat;
  try {
    stat = lstatSync(linkPath);
  } catch {
    return existsSync(join(baseDir, MINDOS_DISABLED_DIR, skill)) ? 'native-disabled' : 'none';
  }
  if (stat.isSymbolicLink()) {
    try {
      return statSync(linkPath).isDirectory() ? 'linked' : 'broken';
    } catch {
      return 'broken';
    }
  }
  if (stat.isDirectory()) {
    return existsSync(join(linkPath, MINDOS_MANAGED_MARKER)) ? 'copied' : 'conflict';
  }
  return 'conflict';
}

/** The directories a cell spans: the (possibly shared) workspace plus the agent's own dir. */
function cellDirsOf(agent: MindosSkillLinkAgent): string[] {
  return agent.nativeSkillDir && resolve(agent.nativeSkillDir) !== resolve(agent.skillDir)
    ? [agent.skillDir, agent.nativeSkillDir]
    : [agent.skillDir];
}

/**
 * The single authority for a cell's enabled state: the workspace dir first,
 * then the agent's own private dir (universal agents ship skills there too).
 */
export function getSkillCellStatus(agent: MindosSkillLinkAgent, skill: string): MindosSkillCellStatus {
  for (const dir of cellDirsOf(agent)) {
    const status = statusInDir(dir, skill);
    if (status !== 'none') return status;
  }
  return 'none';
}

export function isSkillCellEnabled(status: MindosSkillCellStatus): boolean {
  // conflict = a real agent-owned directory: the agent DOES load it.
  return status === 'linked' || status === 'copied' || status === 'conflict';
}

/* ── Link / unlink (spec 4.3, 4.5, 4.7) ───────────────────────── */

/**
 * Expose a skill to a downstream agent: create `{agentSkillDir}/{skill}` as a
 * symlink to the skill body (junction on Windows, copy as last resort).
 * Never touches the skill body itself.
 */
export function linkSkillToAgent(
  skill: string,
  agent: MindosSkillLinkAgent,
  skillRoots: MindosSkillRoot[],
  deps: MindosSkillLinkDeps = {},
): MindosSkillLinkOutcome {
  const linkPath = join(agent.skillDir, skill);
  // The agent may already ship this skill in its OWN directory (universal
  // agents: e.g. Codex's ~/.codex/skills). It is natively ON for that agent —
  // never shadow it with a pool link that would leak it to every pool reader.
  if (agent.nativeSkillDir && resolve(agent.nativeSkillDir) !== resolve(agent.skillDir)) {
    const nativeStatus = statusInDir(agent.nativeSkillDir, skill);
    if (nativeStatus === 'native-disabled') return enableInDir(agent.nativeSkillDir, skill);
    if (nativeStatus !== 'none' && nativeStatus !== 'broken') return { ok: true, result: 'already' };
  }
  // A disabled native copy exists: "turn on" means restoring the agent's own
  // directory, not shadowing it with a link. Checked before source resolution —
  // the parked copy may be the only body there is.
  if (!lstatSafe(linkPath) && lstatSafe(join(agent.skillDir, MINDOS_DISABLED_DIR, skill))) {
    return enableInDir(agent.skillDir, skill);
  }

  const sourceDir = resolveSkillSourceDir(skill, skillRoots);
  if (!sourceDir) {
    return { ok: false, code: 'skill-not-found', message: `Skill not found: ${skill}` };
  }
  // The skill body may live INSIDE the agent's skill directory (e.g. a skill
  // root shared with universal agents). Linking onto itself would destroy the
  // body and leave a self-referencing loop — it is already exposed, so no-op.
  if (resolve(linkPath) === resolve(sourceDir)) {
    return { ok: true, result: 'already' };
  }
  try {
    const stat = lstatSafe(linkPath);
    if (stat?.isSymbolicLink()) {
      if (symlinkTargetIsDirectory(linkPath)) return { ok: true, result: 'already' };
      unlinkSync(linkPath); // dangling link → clean up and re-create (spec 4.5)
    } else if (stat?.isDirectory()) {
      if (existsSync(join(linkPath, MINDOS_MANAGED_MARKER))) return { ok: true, result: 'already' };
      if (!directoriesHaveSameContent(sourceDir, linkPath)) {
        return {
          ok: false,
          code: 'conflict',
          message: `A directory already exists at ${linkPath} and is not managed by MindOS`,
        };
      }
      // Pre-symlink era copy of this very skill → safe to convert in place.
      rmSync(linkPath, { recursive: true, force: true });
    } else if (stat) {
      return { ok: false, code: 'conflict', message: `A file already exists at ${linkPath}` };
    }

    mkdirSync(agent.skillDir, { recursive: true });
    return { ok: true, result: createSkillLink(sourceDir, linkPath, deps) };
  } catch (error) {
    return { ok: false, code: 'io-error', message: errorMessage(error) };
  }
}

/**
 * Remove a skill from a downstream agent. Deletes only the link, our marked
 * copy, or an unmarked copy whose content is identical to the skill body
 * (lossless — e.g. created by the legacy copy install). A real directory with
 * diverged content is refused.
 */
export function unlinkSkillFromAgent(
  skill: string,
  agent: MindosSkillLinkAgent,
  skillRoots: MindosSkillRoot[] = [],
): MindosSkillLinkOutcome {
  // Operate on whichever directory actually holds the entry (pool first,
  // then the agent's own dir).
  for (const dir of cellDirsOf(agent)) {
    const status = statusInDir(dir, skill);
    if (status !== 'none' && status !== 'native-disabled') return unlinkInDir(dir, skill, skillRoots);
  }
  return { ok: true, result: 'missing' };
}

function unlinkInDir(
  baseDir: string,
  skill: string,
  skillRoots: MindosSkillRoot[],
): MindosSkillLinkOutcome {
  const linkPath = join(baseDir, skill);
  try {
    const stat = lstatSafe(linkPath);
    if (!stat) return { ok: true, result: 'missing' };
    if (stat.isSymbolicLink()) {
      unlinkSync(linkPath);
      return { ok: true, result: 'removed' };
    }
    if (stat.isDirectory()) {
      if (!existsSync(join(linkPath, MINDOS_MANAGED_MARKER)) && !isLosslessSkillCopy(skill, linkPath, skillRoots)) {
        return {
          ok: false,
          code: 'conflict',
          message: `${linkPath} is a real directory not managed by MindOS; refusing to delete`,
        };
      }
      rmSync(linkPath, { recursive: true, force: true });
      return { ok: true, result: 'removed' };
    }
    return { ok: false, code: 'conflict', message: `${linkPath} is not a skill link` };
  } catch (error) {
    return { ok: false, code: 'io-error', message: errorMessage(error) };
  }
}

/**
 * Turn a native skill OFF without deleting it: move the agent-owned directory
 * into `{agentSkillDir}/.mindos-disabled/` — scanners skip dot-prefixed
 * entries, so the agent stops loading it; the body stays byte-identical.
 */
export function disableNativeSkill(skill: string, agent: MindosSkillLinkAgent): MindosSkillLinkOutcome {
  for (const dir of cellDirsOf(agent)) {
    const status = statusInDir(dir, skill);
    if (status === 'native-disabled') return { ok: true, result: 'already' };
    if (status !== 'none') return disableInDir(dir, skill);
  }
  return { ok: true, result: 'missing' };
}

function disableInDir(baseDir: string, skill: string): MindosSkillLinkOutcome {
  const activePath = join(baseDir, skill);
  const disabledPath = join(baseDir, MINDOS_DISABLED_DIR, skill);
  try {
    const stat = lstatSafe(activePath);
    if (!stat) {
      return { ok: true, result: lstatSafe(disabledPath) ? 'already' : 'missing' };
    }
    if (stat.isSymbolicLink() || (stat.isDirectory() && existsSync(join(activePath, MINDOS_MANAGED_MARKER)))) {
      return { ok: false, code: 'conflict', message: `${activePath} is a MindOS-managed link — unlink it instead` };
    }
    if (!stat.isDirectory()) {
      return { ok: false, code: 'conflict', message: `${activePath} is not a skill directory` };
    }
    if (lstatSafe(disabledPath)) {
      return { ok: false, code: 'conflict', message: `${disabledPath} already exists; resolve it first` };
    }
    mkdirSync(join(baseDir, MINDOS_DISABLED_DIR), { recursive: true });
    renameSync(activePath, disabledPath);
    return { ok: true, result: 'disabled' };
  } catch (error) {
    return { ok: false, code: 'io-error', message: errorMessage(error) };
  }
}

/** Restore a native skill disabled by {@link disableNativeSkill}: move it back in place. */
export function enableNativeSkill(skill: string, agent: MindosSkillLinkAgent): MindosSkillLinkOutcome {
  for (const dir of cellDirsOf(agent)) {
    const status = statusInDir(dir, skill);
    if (status === 'native-disabled') return enableInDir(dir, skill);
    if (status !== 'none') {
      // An active entry exists; if a parked copy ALSO lingers here, surface
      // the clash explicitly instead of silently stranding it.
      if (lstatSafe(join(dir, MINDOS_DISABLED_DIR, skill))) return enableInDir(dir, skill);
      return { ok: true, result: 'already' };
    }
  }
  return { ok: true, result: 'missing' };
}

function enableInDir(baseDir: string, skill: string): MindosSkillLinkOutcome {
  const activePath = join(baseDir, skill);
  const disabledPath = join(baseDir, MINDOS_DISABLED_DIR, skill);
  try {
    if (!lstatSafe(disabledPath)) {
      return { ok: true, result: lstatSafe(activePath) ? 'already' : 'missing' };
    }
    if (lstatSafe(activePath)) {
      return { ok: false, code: 'conflict', message: `${activePath} already exists; cannot restore the disabled copy over it` };
    }
    renameSync(disabledPath, activePath);
    try {
      rmdirSync(join(baseDir, MINDOS_DISABLED_DIR)); // only succeeds when empty
    } catch {
      // other disabled skills remain — keep the holding directory
    }
    return { ok: true, result: 'enabled' };
  } catch (error) {
    return { ok: false, code: 'io-error', message: errorMessage(error) };
  }
}

/** An unmarked copy is safe to delete only when the body exists elsewhere with identical content. */
function isLosslessSkillCopy(skill: string, copyPath: string, skillRoots: MindosSkillRoot[]): boolean {
  if (skillRoots.length === 0) return false;
  const sourceDir = resolveSkillSourceDir(skill, skillRoots);
  if (!sourceDir || resolve(sourceDir) === resolve(copyPath)) return false;
  return directoriesHaveSameContent(sourceDir, copyPath);
}

function createSkillLink(sourceDir: string, linkPath: string, deps: MindosSkillLinkDeps): 'linked' | 'copied' {
  const platform = deps.platform ?? process.platform;
  const symlink = deps.symlink ?? ((target: string, path: string, type: 'dir' | 'junction') => symlinkSync(target, path, type));

  try {
    symlink(sourceDir, linkPath, 'dir');
    return 'linked';
  } catch {
    if (platform === 'win32') {
      try {
        symlink(sourceDir, linkPath, 'junction');
        return 'linked';
      } catch {
        // fall through to copy
      }
    }
  }

  cpSync(sourceDir, linkPath, { recursive: true });
  writeFileSync(join(linkPath, MINDOS_MANAGED_MARKER), '', 'utf-8');
  return 'copied';
}

/* ── Matrix read model (spec 4.2) ─────────────────────────────── */

export const MINDOS_SELF_AGENT_KEY = 'mindos';

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
  const baseSkills = options.skills.map(({ name, description, source, origin, path }) => ({ name, description, source, origin, path }));
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
        found.push({ name: entry.name, description, source: 'builtin', origin: 'custom', path: skillFile });
      }
    }
  }
  return found;
}

/* ── One-time migration of legacy copy installs (spec 4.6) ────── */

/**
 * Convert legacy `installedSkillAgents[]` copy installs into symlinks.
 * Content-identical copies are replaced with links; user-modified copies are
 * kept but marked as managed (with a warning). Never throws per record.
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
        // User modified the copy: keep it, but mark it as managed so the
        // matrix and uninstall treat it consistently (spec 4.6 step 4).
        writeFileSync(join(linkPath, MINDOS_MANAGED_MARKER), '', 'utf-8');
        warn(`skill copy at ${linkPath} differs from its body; kept as-is and marked managed`);
        result.marked.push(tag);
      }
    } catch (error) {
      warn(`failed to migrate skill install ${record.agent}/${record.skill}: ${errorMessage(error)}`);
      result.skipped.push({ ...tag, reason: errorMessage(error) });
    }
  }

  return result;
}

/* ── Helpers ──────────────────────────────────────────────────── */

function lstatSafe(path: string): import('node:fs').Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function symlinkTargetIsDirectory(linkPath: string): boolean {
  try {
    return statSync(linkPath).isDirectory();
  } catch {
    return false;
  }
}

/** Compare two directories by relative file set + file contents (marker file ignored). */
function directoriesHaveSameContent(a: string, b: string): boolean {
  const filesA = collectFiles(a);
  const filesB = collectFiles(b);
  if (filesA.size !== filesB.size) return false;
  for (const [relative, absoluteA] of filesA) {
    const absoluteB = filesB.get(relative);
    if (!absoluteB) return false;
    if (!readFileSync(absoluteA).equals(readFileSync(absoluteB))) return false;
  }
  return true;
}

function collectFiles(root: string, prefix = ''): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    if (entry.name === MINDOS_MANAGED_MARKER) continue;
    const relative = prefix ? join(prefix, entry.name) : entry.name;
    const absolute = join(root, relative);
    if (entry.isDirectory()) {
      for (const [childRelative, childAbsolute] of collectFiles(root, relative)) {
        files.set(childRelative, childAbsolute);
      }
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      files.set(relative, absolute);
    }
  }
  return files;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
