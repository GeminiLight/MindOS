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
