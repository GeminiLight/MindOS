import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { MindosSkillInfo, MindosSkillRoot } from './skills.js';

/**
 * Process-wide memo of the skill scan behind `/api/skills`,
 * `/api/skills/matrix`, `/api/skills/runtime-matches` and the MindOS row of
 * `/api/mcp/agents`. Each of those used to walk every skill root and parse
 * every `SKILL.md` on every request.
 *
 * The scan is keyed by the ordered list of roots and validated by a
 * signature built from `stat` calls only: each root directory's mtime (adding
 * or removing a skill directory changes it), each skill directory's mtime and
 * the mtime + size of its `SKILL.md` (edits to the frontmatter change those).
 * A missing root or file is encoded as -1 so it appearing later invalidates
 * the entry. `disabledSkills` is applied outside the memo, so toggling a
 * skill never needs a rescan.
 */

type SkillsIndexEntry = {
  signature: string;
  skills: MindosSkillInfo[];
};

const indexes = new Map<string, SkillsIndexEntry>();
let scanCount = 0;

/** Test hooks. */
export function resetSkillsIndexForTests(): void {
  indexes.clear();
  scanCount = 0;
}

export function skillsIndexStats(): { entries: number; scans: number } {
  return { entries: indexes.size, scans: scanCount };
}

/** Roots as a stable key: path plus origin (the same path may be registered under two origins). */
function rootsKey(roots: MindosSkillRoot[]): string {
  return roots.map((root) => `${root.origin}:${root.path}`).join('\n');
}

function statSignature(path: string): string {
  try {
    const stat = statSync(path);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return '-1';
  }
}

/** Direct children of `root` that can be skills (directories or symlinks), or nothing when unreadable. */
function childSkillDirs(root: string, readDir: SkillsIndexReadDir): string[] {
  try {
    return readDir(root)
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith('.'))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

export type SkillsIndexReadDir = (path: string) => Array<{ name: string; isDirectory(): boolean; isSymbolicLink(): boolean }>;

/** Stat-only fingerprint of every root: root dir, root SKILL.md, each skill dir and its SKILL.md. */
export function computeSkillsIndexSignature(roots: MindosSkillRoot[], readDir: SkillsIndexReadDir): string {
  const parts: string[] = [];
  for (const root of roots) {
    parts.push(`${root.path}=${statSignature(root.path)}|${statSignature(join(root.path, 'SKILL.md'))}`);
    for (const name of childSkillDirs(root.path, readDir)) {
      const dir = join(root.path, name);
      parts.push(`${name}=${statSignature(dir)}|${statSignature(join(dir, 'SKILL.md'))}`);
    }
  }
  return parts.join('\n');
}

/**
 * The scanned skills for `roots`, reusing the previous scan while the
 * signature is unchanged. `scan` runs the real walk (and its result is
 * frozen: callers must copy before mutating).
 */
export function getSkillsIndex(
  roots: MindosSkillRoot[],
  readDir: SkillsIndexReadDir,
  scan: (roots: MindosSkillRoot[]) => MindosSkillInfo[],
): MindosSkillInfo[] {
  const key = rootsKey(roots);
  const signature = computeSkillsIndexSignature(roots, readDir);
  const cached = indexes.get(key);
  if (cached && cached.signature === signature) return cached.skills;
  scanCount += 1;
  const skills = scan(roots);
  indexes.set(key, { signature, skills });
  return skills;
}
