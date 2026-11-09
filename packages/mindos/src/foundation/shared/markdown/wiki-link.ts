/**
 * Obsidian-compatible wiki link parsing.
 *
 * Single source of truth for `[[target]]` syntax across MindOS. Pure — no `fs`,
 * no vault resolution — so it is safe to use in server code, Node CLIs and the
 * browser bundle alike. Turning a parsed `target` into an actual file is the
 * caller's job, because each consumer has a different index available.
 *
 * Semantics follow Obsidian: alias after `|`, subpath after `#` (`#^` for block
 * refs), a leading `!` means embed, and links inside frontmatter, fenced code
 * blocks or inline code are not links at all.
 */

export type WikiLinkSubpath = {
  type: 'heading' | 'block';
  value: string;
};

export type WikiLinkToken = {
  /** The full matched source text, including any leading `!`. */
  raw: string;
  /** Link target with alias/subpath stripped. Empty string means "this file". */
  target: string;
  /** Display text after `|`, when present and non-empty. */
  alias?: string;
  /** Heading or block reference after `#`, when present and non-empty. */
  subpath?: WikiLinkSubpath;
  /** True when the link was written as `![[...]]`. */
  isEmbed: boolean;
  /** 1-indexed line number in the original content. */
  line: number;
  /** 1-indexed column of the match start within its line. */
  column: number;
  /** Absolute offset of the match start in the original content. */
  start: number;
  /** Absolute offset just past the match end in the original content. */
  end: number;
};

export type ScannableLine = {
  /** The line exactly as it appears in the source. */
  original: string;
  /** The line with inline code masked out, safe to run link regexes against. */
  text: string;
  /** 1-indexed line number in the original content. */
  number: number;
  /** Absolute offset of the line start in the original content. */
  offset: number;
};

/**
 * Replace inline code spans with spaces, preserving length so that offsets
 * computed against the masked text still map back to the original.
 */
export function maskInlineCode(line: string): string {
  return line.replace(/`+[^`]*?`+/g, (match) => ' '.repeat(match.length));
}

/**
 * Split content into the lines that may contain links, dropping frontmatter and
 * fenced code blocks and masking inline code.
 */
export function collectScannableLines(content: string): ScannableLine[] {
  const rawLines = content.split(/\r?\n/);
  const lines: ScannableLine[] = [];
  let inFrontmatter = rawLines[0]?.trim() === '---';
  let inFence = false;
  let fenceChar: '`' | '~' | null = null;
  let fenceLength = 0;
  let offset = 0;

  for (let index = 0; index < rawLines.length; index += 1) {
    const original = rawLines[index] ?? '';
    const lineStart = offset;
    // `split` dropped the separator; assume "\n". A "\r\n" source shifts later
    // offsets by one per preceding CRLF, so normalise before parsing if exact
    // offsets matter on CRLF content.
    offset += original.length + 1;

    const trimmed = original.trim();

    if (inFrontmatter) {
      if (index > 0 && trimmed === '---') inFrontmatter = false;
      continue;
    }

    const fenceMatch = original.match(/^\s*(`{3,}|~{3,})/);
    if (inFence) {
      if (fenceMatch && fenceChar && fenceMatch[1]?.startsWith(fenceChar) && fenceMatch[1].length >= fenceLength) {
        inFence = false;
        fenceChar = null;
        fenceLength = 0;
      }
      continue;
    }
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? '';
      fenceChar = marker[0] as '`' | '~';
      fenceLength = marker.length;
      inFence = true;
      continue;
    }

    lines.push({
      original,
      text: maskInlineCode(original),
      number: index + 1,
      offset: lineStart,
    });
  }

  return lines;
}

/** Split `Target#Subpath` into its parts. A `#^` prefix marks a block ref. */
export function splitSubpath(value: string): { targetText: string; subpath?: WikiLinkSubpath } {
  const hashIndex = value.indexOf('#');
  if (hashIndex === -1) return { targetText: value.trim() };

  const targetText = value.slice(0, hashIndex).trim();
  const rawSubpath = value.slice(hashIndex + 1).trim();
  if (!rawSubpath) return { targetText };

  if (rawSubpath.startsWith('^')) {
    const block = rawSubpath.slice(1).trim();
    return block ? { targetText, subpath: { type: 'block', value: block } } : { targetText };
  }

  return { targetText, subpath: { type: 'heading', value: rawSubpath } };
}

/** Split the inside of `[[...]]` into target, alias and subpath. */
export function parseWikiTarget(raw: string | undefined): {
  targetText: string;
  displayText?: string;
  subpath?: WikiLinkSubpath;
} {
  const value = raw?.trim() ?? '';
  const [targetAndSubpath = '', alias] = value.split('|');
  const { targetText, subpath } = splitSubpath(targetAndSubpath.trim());
  return {
    targetText,
    displayText: alias?.trim() || undefined,
    subpath,
  };
}

/**
 * Count the backslashes immediately before `index`. An odd count means the
 * following character is escaped.
 */
function precedingBackslashes(text: string, index: number): number {
  let count = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) count += 1;
  return count;
}

const WIKI_LINK_RE = /(!?)\[\[([^\]\n]+)\]\]/g;

/** A wiki link found within a single line, with offsets relative to that line. */
export type WikiLinkMatch = {
  raw: string;
  target: string;
  alias?: string;
  subpath?: WikiLinkSubpath;
  isEmbed: boolean;
  /** 1-indexed column of the `[[` within the line. */
  column: number;
  /** 0-indexed offset of the match start (including `!`) within the line. */
  index: number;
  /** Length of the matched text, including any leading `!`. */
  length: number;
};

/**
 * Parse the wiki links in one already-masked line.
 *
 * `text` should have inline code masked (see {@link maskInlineCode}); pass the
 * unmasked line as `original` when the caller needs `raw` to reflect the source
 * verbatim.
 */
export function parseWikiLinksInLine(text: string, original: string = text): WikiLinkMatch[] {
  const matches: WikiLinkMatch[] = [];
  WIKI_LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = WIKI_LINK_RE.exec(text)) !== null) {
    const bang = match[1] === '!';
    // The `!` is part of the match, so the brackets start one later when present.
    const bracketIndex = match.index + (bang ? 1 : 0);

    // An odd number of backslashes escapes the `[[`. An escaped `!` only demotes
    // the embed — the link itself still stands.
    if (precedingBackslashes(text, bracketIndex) % 2 === 1) continue;
    const isEmbed = bang && precedingBackslashes(text, match.index) % 2 === 0;

    const { targetText, displayText, subpath } = parseWikiTarget(match[2]);
    if (!targetText && !subpath) continue;

    const index = isEmbed ? match.index : bracketIndex;
    const end = match.index + match[0].length;

    matches.push({
      raw: original.slice(index, end),
      target: targetText,
      ...(displayText ? { alias: displayText } : {}),
      ...(subpath ? { subpath } : {}),
      isEmbed,
      column: bracketIndex + 1,
      index,
      length: end - index,
    });
  }

  return matches;
}

/**
 * Parse every wiki link in `content`, in source order.
 *
 * Links in frontmatter, fenced code blocks and inline code are skipped, as are
 * backslash-escaped links. Returns `[]` rather than throwing on malformed input.
 */
export function parseWikiLinks(content: string): WikiLinkToken[] {
  const tokens: WikiLinkToken[] = [];

  for (const line of collectScannableLines(content)) {
    for (const match of parseWikiLinksInLine(line.text, line.original)) {
      const { column, index, length, ...rest } = match;
      tokens.push({
        ...rest,
        line: line.number,
        column,
        start: line.offset + index,
        end: line.offset + index + length,
      });
    }
  }

  return tokens;
}
