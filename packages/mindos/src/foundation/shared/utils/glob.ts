/**
 * Glob matching shared by `.mindosignore` rules, permission rules and the Web
 * tree walker. One `picomatch` configuration replaces three hand-written
 * `globToRegExp` copies that disagreed on `?`, `**` and character classes.
 */

import picomatch from 'picomatch';

const GLOB_CHARS = /[*?[\]{}()!+@]/;

export type GlobMatcher = (candidate: string) => boolean;

export type GlobMatcherOptions = {
  /** Match slash-less patterns against the basename as well (like `.gitignore`). */
  matchBase?: boolean;
};

export function toPosixPath(input: string): string {
  return input.replace(/\\/g, '/');
}

export function isGlobPattern(rule: string): boolean {
  return GLOB_CHARS.test(rule);
}

/**
 * Build a matcher for a POSIX-style glob. `dot: true` keeps the historical
 * MindOS behaviour where `*` also matches dotfiles; input paths may use
 * either separator.
 */
export function createGlobMatcher(pattern: string, options: GlobMatcherOptions = {}): GlobMatcher {
  const isMatch = picomatch(toPosixPath(pattern), {
    dot: true,
    nobrace: true,
    matchBase: options.matchBase === true,
  });
  return (candidate: string) => {
    const normalized = toPosixPath(candidate);
    return normalized !== '' && isMatch(normalized);
  };
}
