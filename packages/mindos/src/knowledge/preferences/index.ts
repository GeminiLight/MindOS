import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { withFileMutationSync } from '../views/file-lock.js';

/**
 * The single write path for `.mindos/user-preferences.md`.
 *
 * This file is the only channel that reaches every agent deterministically: the
 * bootstrap handler ships it as `user_skill_rules` and the web turn runner
 * inlines it. That also makes it the most contended file in the knowledge base —
 * Echo promotion appends to it, the agent appends to it when it captures a
 * preference mid-conversation, and `mindos start` rewrites it whole during
 * migration.
 *
 * Those writers previously had no lock in common. A lock a caller brings with it
 * only protects that caller from itself, so an agent capture landing at the same
 * moment as an Echo approval lost one of the two, and a migration rewrite could
 * drop everything appended since it read the file. Everything that writes this
 * file now goes through here.
 */

export const USER_PREFERENCES_PATH = '.mindos/user-preferences.md';
const PREFERENCES_HEADING = '## Preferences';
const MAX_RULE_CHARS = 1_000;
const MAX_CATEGORY_CHARS = 80;

const TEMPLATE = [
  '# User Skill Rules',
  '<!-- auto-confirm-all: false -->',
  '',
  PREFERENCES_HEADING,
  '',
].join('\n');

export type AppendUserPreferenceInput = {
  /** The rule itself, as the user would read it. Newlines are flattened. */
  rule: string;
  /** Stable id so the same source cannot append twice. */
  marker: string;
  /** Category heading to file the rule under. */
  category?: string;
};

export type AppendUserPreferenceResult = {
  appended: boolean;
  path: string;
};

export function withUserPreferencesLock<T>(mindRoot: string, operation: () => T): T {
  // Deliberately the same lock the file handler takes for an agent write: the
  // agent capturing a preference mid-conversation and an Echo approval both
  // land here, and two correct locks on different paths serialize nothing.
  // withFileMutationSync is itself reentrant, so nesting is safe.
  return withFileMutationSync(mindRoot, USER_PREFERENCES_PATH, operation);
}

/** Returns the file as stored, or null when it has not been created yet. */
export function readUserPreferences(mindRoot: string): string | null {
  try {
    const file = resolveExistingSafe(mindRoot, USER_PREFERENCES_PATH);
    if (!existsSync(file) || !statSync(file).isFile()) return null;
    return readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Replace the whole file. For callers that legitimately own all of it — the
 * startup migration, and an agent doing read-modify-write. Takes the lock so it
 * cannot land between another writer's read and write.
 */
export function writeUserPreferences(mindRoot: string, content: string): void {
  withUserPreferencesLock(mindRoot, () => {
    const file = resolveExistingSafe(mindRoot, USER_PREFERENCES_PATH);
    mkdirSync(path.dirname(file), { recursive: true });
    atomicWrite(file, content.endsWith('\n') ? content : `${content}\n`);
  });
}

/** Delete the file. Used only to roll back a write that created it. */
export function removeUserPreferences(mindRoot: string): void {
  withUserPreferencesLock(mindRoot, () => {
    try {
      unlinkSync(resolveExistingSafe(mindRoot, USER_PREFERENCES_PATH));
    } catch {
      // Already absent is the desired end state.
    }
  });
}

/**
 * Add one rule, once. Returns `appended: false` when `marker` is already
 * present, so repeating an approval is a no-op rather than a duplicate bullet.
 */
export function appendUserPreference(
  mindRoot: string,
  input: AppendUserPreferenceInput,
  now = new Date(),
): AppendUserPreferenceResult {
  const rule = singleLine(input.rule).slice(0, MAX_RULE_CHARS);
  if (!rule) throw new Error('User preference rule is required.');
  const marker = validateMarker(input.marker);
  const category = singleLine(input.category ?? 'Echo agreements').slice(0, MAX_CATEGORY_CHARS) || 'Echo agreements';
  const bullet = `- ${rule} — _${now.toISOString().slice(0, 10)}_ <!-- ${marker} -->`;

  return withUserPreferencesLock(mindRoot, () => {
    const previous = readUserPreferences(mindRoot);
    if (previous !== null && previous.includes(`<!-- ${marker} -->`)) {
      return { appended: false, path: USER_PREFERENCES_PATH };
    }
    const file = resolveExistingSafe(mindRoot, USER_PREFERENCES_PATH);
    mkdirSync(path.dirname(file), { recursive: true });
    atomicWrite(file, insertPreferenceBullet(previous, bullet, category));
    return { appended: true, path: USER_PREFERENCES_PATH };
  });
}

/**
 * Place `bullet` under `## Preferences` › `### {category}`, creating only the
 * headings that are missing. Hand-written content is never rewritten or
 * reordered: someone who edited this file by hand keeps exactly what they typed.
 */
export function insertPreferenceBullet(previous: string | null, bullet: string, category: string): string {
  const heading = `### ${category}`;
  const base = (previous ?? '').replace(/\s+$/, '');
  if (!base) return `${TEMPLATE}\n${heading}\n${bullet}\n`;

  const lines = base.split('\n');
  const categoryIndex = lines.findIndex((line) => line.trim() === heading);
  if (categoryIndex >= 0) {
    lines.splice(endOfBlockIndex(lines, categoryIndex), 0, bullet);
    return `${lines.join('\n')}\n`;
  }

  const preferencesIndex = lines.findIndex((line) => line.trim() === PREFERENCES_HEADING);
  if (preferencesIndex >= 0) {
    lines.splice(endOfBlockIndex(lines, preferencesIndex), 0, '', heading, bullet);
    return `${lines.join('\n')}\n`;
  }

  // Unexpected shape — hand-written notes, or a truncated file. Append the
  // structure bootstrap expects instead of rewriting what is already there.
  return `${base}\n\n${PREFERENCES_HEADING}\n\n${heading}\n${bullet}\n`;
}

/** Index just past the Markdown block that starts at `headingIndex`. */
function endOfBlockIndex(lines: string[], headingIndex: number): number {
  const depth = headingLevel(lines[headingIndex]);
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const level = headingLevel(lines[index]);
    if (level > 0 && level <= depth) return trimBackBlankLines(lines, index);
  }
  return trimBackBlankLines(lines, lines.length);
}

function headingLevel(line: string | undefined): number {
  return line?.match(/^(#{1,6})\s/)?.[1]?.length ?? 0;
}

function trimBackBlankLines(lines: string[], index: number): number {
  let cursor = index;
  while (cursor > 0 && (lines[cursor - 1] ?? '').trim() === '') cursor -= 1;
  return cursor;
}

/** `-->` inside the marker would close the comment early and corrupt the file. */
function validateMarker(value: unknown): string {
  const marker = typeof value === 'string' ? value.trim() : '';
  if (!marker || marker.includes('-->') || marker.includes('<!--') || /[\r\n]/.test(marker)) {
    throw new Error('User preference marker must be a single line without comment delimiters.');
  }
  return marker.slice(0, 200);
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function atomicWrite(file: string, content: string): void {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temp, content, { encoding: 'utf-8', mode: 0o600 });
    renameSync(temp, file);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* best-effort cleanup */ }
    throw error;
  }
}
