/**
 * Load skill-rules.md and user-rules.md from the user's knowledge base.
 *
 * Files are located at: {mindRoot}/.agents/skills/{skillName}/skill-rules.md
 * These are part of the progressive skill loading system (v4).
 *
 * Designed to be called from route.ts during system prompt assembly.
 * All errors are caught — missing files are normal (not all users have skill rules).
 */
import fs from 'fs';
import path from 'path';
import { truncate } from './tools';

export interface SkillRuleFile {
  ok: boolean;
  content: string;
  truncated: boolean;
  empty: boolean;
  error?: string;
}

export interface SkillRulesResult {
  skillRules: SkillRuleFile;
  userRules: SkillRuleFile;
}

const MAX_SKILL_CHARS = 20_000;

function readSkillFile(absPath: string): SkillRuleFile {
  try {
    const raw = fs.readFileSync(absPath, 'utf-8');
    const isEmpty = raw.trim().length === 0;
    if (raw.length > MAX_SKILL_CHARS) {
      return {
        ok: true,
        content: truncate(raw),
        truncated: true,
        empty: false,
      };
    }
    return {
      ok: true,
      content: raw,
      truncated: false,
      empty: isEmpty,
    };
  } catch (err) {
    return {
      ok: false,
      content: '',
      truncated: false,
      empty: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Load skill-rules.md and user-rules.md from {mindRoot}/.agents/skills/{skillName}/
 *
 * @param mindRoot - Absolute path to the knowledge base root
 * @param skillName - 'mindos' or 'mindos-zh'
 */
export function loadSkillRules(mindRoot: string, skillName: string): SkillRulesResult {
  const skillDir = path.join(mindRoot, '.agents', 'skills', skillName);
  return {
    skillRules: readSkillFile(path.join(skillDir, 'skill-rules.md')),
    userRules: readSkillFile(path.join(skillDir, 'user-rules.md')),
  };
}
