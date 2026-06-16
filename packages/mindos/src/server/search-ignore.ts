import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MINDOS_IGNORE_FILE = '.mindosignore';

export type MindosSearchIgnoreMatcher = (relativePath: string) => boolean;

function normalizePosixPath(input: string): string {
  return input.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function normalizeSearchIgnoredPath(input: string): string | null {
  let value = normalizePosixPath(input.trim());
  if (!value || value.startsWith('#')) return null;
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

function hasGlob(rule: string): boolean {
  return /[*?[]/.test(rule);
}

function escapeRegexChar(char: string): string {
  return /[\\^$+?.()|{}[\]]/.test(char) ? `\\${char}` : char;
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern.charAt(i);
    const next = pattern.charAt(i + 1);
    if (char === '*' && next === '*') {
      source += '.*';
      i += 1;
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += escapeRegexChar(char);
  }
  source += '$';
  return new RegExp(source);
}

function createPatternMatcher(rule: string): MindosSearchIgnoreMatcher {
  if (hasGlob(rule)) {
    const regex = globToRegExp(rule);
    const basenameRegex = rule.includes('/') ? null : globToRegExp(rule);
    const deepPrefix = rule.endsWith('/**') ? rule.slice(0, -3) : '';
    return (relativePath) => {
      const normalized = normalizePosixPath(relativePath).replace(/^\/+/, '');
      if (deepPrefix && (normalized === deepPrefix || normalized.startsWith(`${deepPrefix}/`))) return true;
      if (regex.test(normalized)) return true;
      if (!basenameRegex) return false;
      const basename = normalized.split('/').pop() ?? normalized;
      return basenameRegex.test(basename);
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

export function createMindosSearchIgnoreMatcher(
  mindRoot: string,
  ignoredDirs: Set<string>,
  extraIgnoredPaths: string[] = [],
): MindosSearchIgnoreMatcher {
  const customRules = normalizeSearchIgnoredPaths([
    ...readMindosIgnoreFile(mindRoot),
    ...extraIgnoredPaths,
  ]);
  const customMatchers = customRules.map(createPatternMatcher);

  return (relativePath: string) => {
    const normalized = normalizePosixPath(relativePath).replace(/^\/+/, '').replace(/\/+$/, '');
    if (!normalized || normalized === '.') return false;
    if (normalized.split('/').some((segment) => ignoredDirs.has(segment))) return true;
    return customMatchers.some((matcher) => matcher(normalized));
  };
}
