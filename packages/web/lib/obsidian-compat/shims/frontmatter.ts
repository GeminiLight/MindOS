export interface FrontMatterInfo {
  exists: boolean;
  frontmatter: string;
  from: number;
  to: number;
  contentStart: number;
}

/** Locate the leading YAML block without parsing, normalizing or rewriting it. */
export function getFrontMatterInfo(content: string): FrontMatterInfo {
  if (typeof content !== 'string') throw new TypeError('Frontmatter content must be a string.');
  const absent: FrontMatterInfo = { exists: false, frontmatter: '', from: 0, to: 0, contentStart: 0 };
  const opening = /^\uFEFF?---[\t ]*\r?\n/.exec(content);
  if (!opening) return absent;
  const from = opening[0].length;
  const closingPattern = /^---[\t ]*(?:\r?\n|$)/gm;
  closingPattern.lastIndex = from;
  const closing = closingPattern.exec(content);
  if (!closing) return absent;
  let to = closing.index;
  // The newline before the closing fence is a delimiter, not YAML content.
  if (to > from && content[to - 1] === '\n') to--;
  if (to > from && content[to - 1] === '\r') to--;
  return {
    exists: true,
    frontmatter: content.slice(from, to),
    from, to,
    contentStart: closing.index + closing[0].length,
  };
}

/**
 * Look up a frontmatter entry by exact key or by the first key matching a
 * RegExp, in declaration order. Global regexes are treated as stateless: the
 * `lastIndex` cursor is reset before each key test so repeated calls stay
 * deterministic.
 */
export function parseFrontMatterEntry(
  frontmatter: Record<string, unknown> | null | undefined,
  key: string | RegExp,
): unknown {
  if (!frontmatter) return null;
  if (typeof key === 'string') {
    if (!Object.prototype.hasOwnProperty.call(frontmatter, key)) return null;
    const value = frontmatter[key];
    return value === undefined ? null : value;
  }
  if (key instanceof RegExp) {
    for (const name of Object.keys(frontmatter)) {
      key.lastIndex = 0;
      if (key.test(name)) {
        const value = frontmatter[name];
        return value === undefined ? null : value;
      }
    }
  }
  return null;
}

/**
 * Read a frontmatter entry as a string array: array values are stringified
 * entry by entry, a plain string wraps once (no comma splitting), and any
 * other value reads as null — mirroring `parseFrontMatterAliases`.
 */
export function parseFrontMatterStringArray(
  frontmatter: Record<string, unknown> | null | undefined,
  key: string | RegExp,
): string[] | null {
  const value = parseFrontMatterEntry(frontmatter, key);
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === 'string') {
    return [value];
  }
  return null;
}
