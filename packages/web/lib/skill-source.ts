/** Abbreviate the home prefix of an absolute path for display (`/Users/x/…` → `~/…`). */
export function abbreviateHomePath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/)/, '~');
}

/**
 * The folder a skill body lives in — where it ORIGINATES from, independent of
 * any links pointing at it. Derived from the SKILL.md path: strip `/SKILL.md`,
 * then the skill's own directory segment.
 *   /Users/u/.codex/skills/chronicle/SKILL.md → ~/.codex/skills
 */
export function skillSourceFolder(skillMdPath: string | undefined, skillName?: string): string {
  if (!skillMdPath) return '';
  const dir = skillMdPath.replace(/[\\/]SKILL\.md$/, '');
  const parts = dir.split('/');
  if (skillName && parts[parts.length - 1] === skillName) parts.pop();
  return abbreviateHomePath(parts.join('/'));
}

/** Builtin bodies ship inside the MindOS package — their long install path is noise. */
export function isBuiltinSkillOrigin(origin: string | undefined): boolean {
  return origin === 'app-builtin' || origin === 'project-builtin';
}
