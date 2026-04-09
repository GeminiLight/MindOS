import fs from 'fs';
import path from 'path';

/**
 * Candidate skill directories, ordered by priority.
 * Used for SKILL.md resolution AND reference file fallback.
 */
export function skillDirCandidates(
  skillName: string,
  projectRoot: string,
  mindRoot: string,
): string[] {
  return [
    path.join(projectRoot, 'app', 'data', 'skills', skillName),
    path.join(projectRoot, 'skills', skillName),
    path.join(mindRoot, '.skills', skillName),
    path.join(process.env.HOME || '/root', '.mindos', 'skills', skillName),
  ];
}

/**
 * Result of reading an absolute file.
 */
export interface ReadFileResult {
  ok: boolean;
  content: string;
  truncated: boolean;
  error?: string;
}

/**
 * In-memory cache for absolute file reads (SKILL.md, etc).
 * Keyed by absPath. Re-reads only when file mtime changes.
 * Avoids redundant disk IO on every agent request (~5-10ms saved per call).
 */
const _absFileCache = new Map<string, { mtimeMs: number; result: ReadFileResult }>();

/**
 * Read a file from absolute path with mtime-based caching.
 * Truncates content if >20KB.
 */
export function readAbsoluteFile(absPath: string): ReadFileResult {
  try {
    const stat = fs.statSync(absPath);
    const cached = _absFileCache.get(absPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.result;
    }

    const raw = fs.readFileSync(absPath, 'utf-8');
    let result: ReadFileResult;
    if (raw.length > 20_000) {
      result = { ok: true, content: truncateContent(raw), truncated: true };
    } else {
      result = { ok: true, content: raw, truncated: false };
    }
    _absFileCache.set(absPath, { mtimeMs: stat.mtimeMs, result });
    return result;
  } catch (err) {
    _absFileCache.delete(absPath);
    return {
      ok: false,
      content: '',
      truncated: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Truncate content to a reasonable size for agent context.
 */
function truncateContent(content: string, maxChars = 20_000): string {
  // Simple truncation — can be enhanced with smarter extraction
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + '\n... (truncated)';
}

/**
 * Resolve skill file from multiple fallback locations.
 * Tries in order: app/data/skills → skills → {mindRoot}/.skills → ~/.mindos/skills
 * Returns { path, result } where result is the file content or error.
 */
export function resolveSkillFile(
  skillName: string,
  projectRoot: string,
  mindRoot: string,
): { path: string; result: ReadFileResult } {
  const dirs = skillDirCandidates(skillName, projectRoot, mindRoot);
  const locations = dirs.map(d => path.join(d, 'SKILL.md'));

  for (const absPath of locations) {
    const result = readAbsoluteFile(absPath);
    if (result.ok) {
      return { path: absPath, result };
    }
  }

  return {
    path: locations[locations.length - 1],
    result: {
      ok: false,
      content: '',
      truncated: false,
      error: `Skill not found: tried ${locations.length} locations`,
    },
  };
}

/**
 * Resolve a skill reference file (e.g. references/write-supplement.md) with
 * multi-location fallback. First tries relative to the found SKILL.md, then
 * falls back to all other candidate directories.
 */
export function resolveSkillReference(
  relPath: string,
  skillInfo: { path: string },
  skillName: string,
  projectRoot: string,
  mindRoot: string,
): ReadFileResult {
  const primaryDir = path.dirname(skillInfo.path);
  const primaryPath = path.join(primaryDir, relPath);
  const primaryResult = readAbsoluteFile(primaryPath);
  if (primaryResult.ok) return primaryResult;

  for (const dir of skillDirCandidates(skillName, projectRoot, mindRoot)) {
    if (dir === primaryDir) continue;
    const result = readAbsoluteFile(path.join(dir, relPath));
    if (result.ok) return result;
  }

  return primaryResult;
}

/**
 * Clear the absolute file cache (for testing or refresh).
 */
export function clearAbsoluteFileCache(): void {
  _absFileCache.clear();
}
