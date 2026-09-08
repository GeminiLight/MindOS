import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGlobMatcher, isGlobPattern, toPosixPath } from '../foundation/shared/utils/glob.js';

export const MINDOS_IGNORE_FILE = '.mindosignore';

export type MindosSearchIgnoreMatcher = (relativePath: string) => boolean;

function normalizePosixPath(input: string): string {
  return toPosixPath(input).replace(/\/+/g, '/');
}

function normalizeSearchIgnoredPath(input: string): string | null {
  let value = normalizePosixPath(input.trim());
  if (!value || value.startsWith('#')) return null;
  // Negation is intentionally unsupported for the first MindOS ignore format.
  // Treating it as a literal path would surprise users more than skipping it.
  if (value.startsWith('!')) return null;
  value = value.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!value || value === '.' || value === '..') return null;
  if (value.split('/').includes('..')) return null;
  return value;
}

export function normalizeSearchIgnoredPaths(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const normalized = normalizeSearchIgnoredPath(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function parseMindosIgnoreContent(content: string): string[] {
  return normalizeSearchIgnoredPaths(content.split(/\r?\n/));
}

export function readMindosIgnoreFile(mindRoot: string): string[] {
  try {
    return parseMindosIgnoreContent(readFileSync(join(mindRoot, MINDOS_IGNORE_FILE), 'utf-8'));
  } catch {
    return [];
  }
}

export function writeMindosIgnoreFile(mindRoot: string, ignoredPaths: string[]): string[] {
  const normalized = normalizeSearchIgnoredPaths(ignoredPaths);
  const content = [
    '# MindOS search ignored paths',
    '# One directory name, relative path, or simple glob per line.',
    ...normalized,
    '',
  ].join('\n');
  mkdirSync(mindRoot, { recursive: true });
  writeFileSync(join(mindRoot, MINDOS_IGNORE_FILE), content, 'utf-8');
  return normalized;
}

function createPatternMatcher(rule: string): MindosSearchIgnoreMatcher {
  if (isGlobPattern(rule)) {
    // Slash-less globs behave like .gitignore: they match the basename at
    // any depth. Patterns with a slash are anchored at the mind root.
    const matches = createGlobMatcher(rule, { matchBase: !rule.includes('/') });
    const deepPrefix = rule.endsWith('/**') ? rule.slice(0, -3) : '';
    return (relativePath) => {
      const normalized = normalizePosixPath(relativePath).replace(/^\/+/, '');
      if (deepPrefix && (normalized === deepPrefix || normalized.startsWith(`${deepPrefix}/`))) return true;
      return matches(normalized);
    };
  }

  if (rule.includes('/')) {
    return (relativePath) => {
      const normalized = normalizePosixPath(relativePath).replace(/^\/+/, '').replace(/\/+$/, '');
      return normalized === rule || normalized.startsWith(`${rule}/`);
    };
  }

  return (relativePath) => {
    const normalized = normalizePosixPath(relativePath).replace(/^\/+/, '');
    return normalized.split('/').includes(rule);
  };
}

/**
 * Pure matcher over an explicit rule list (no `.mindosignore` read). Used by
 * callers that already hold the parsed rules, e.g. the Web embedding index.
 */
export function createMindosIgnoreRuleMatcher(
  ignoredDirs: Set<string>,
  rules: unknown,
): MindosSearchIgnoreMatcher {
  const customMatchers = normalizeSearchIgnoredPaths(rules).map(createPatternMatcher);
  return (relativePath: string) => {
    const normalized = normalizePosixPath(relativePath).replace(/^\/+/, '').replace(/\/+$/, '');
    if (!normalized || normalized === '.') return false;
    if (normalized.split('/').some((segment) => ignoredDirs.has(segment))) return true;
    return customMatchers.some((matcher) => matcher(normalized));
  };
}

export function createMindosSearchIgnoreMatcher(
  mindRoot: string,
  ignoredDirs: Set<string>,
  extraIgnoredPaths: string[] = [],
): MindosSearchIgnoreMatcher {
  return createMindosIgnoreRuleMatcher(ignoredDirs, [
    ...readMindosIgnoreFile(mindRoot),
    ...extraIgnoredPaths,
  ]);
}

// The matcher re-reads .mindosignore; watcher events and incremental index
// updates run once per fs event, and a git pull touching thousands of files
// would otherwise re-read it thousands of times on the event loop. Cache per
// root, keyed by the ignore file's mtime + size.
const ignoreMatcherCache = new Map<string, { key: string; matcher: MindosSearchIgnoreMatcher }>();

export function createCachedMindosSearchIgnoreMatcher(
  mindRoot: string,
  ignoredDirs: Set<string>,
): MindosSearchIgnoreMatcher {
  let key = 'missing';
  try {
    const stat = statSync(join(mindRoot, MINDOS_IGNORE_FILE));
    key = `${stat.mtimeMs}:${stat.size}`;
  } catch {
    // No ignore file: only the built-in directory list applies.
  }
  const cacheKey = `${mindRoot}\0${[...ignoredDirs].join(',')}`;
  const cached = ignoreMatcherCache.get(cacheKey);
  if (cached && cached.key === key) return cached.matcher;
  const matcher = createMindosSearchIgnoreMatcher(mindRoot, ignoredDirs);
  ignoreMatcherCache.set(cacheKey, { key, matcher });
  return matcher;
}
