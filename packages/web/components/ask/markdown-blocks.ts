/**
 * Streaming-markdown block splitter.
 *
 * Splits a markdown source into stable top-level blocks on blank-line
 * boundaries so each completed block can be rendered through a memoized
 * ReactMarkdown instance — during streaming only the growing tail block
 * re-parses, turning per-chunk render cost from O(L) (full re-parse) into
 * O(tail).
 *
 * Correctness rule: a wrong split changes rendering; a missed split only
 * costs performance. All heuristics therefore err on the side of NOT
 * splitting:
 *  - never split inside a fenced code block (``` / ~~~, any indentation —
 *    more liberal than CommonMark on purpose);
 *  - never split a loose list (blank lines between items) or a list item's
 *    indented continuation content;
 *  - an unclosed fence swallows the rest of the source into one block,
 *    which matches how the full-document parse renders it anyway.
 *
 * Known limitation: reference-style link definitions (`[ref]: url`) only
 * resolve within their own block. Chat output essentially always uses inline
 * links, and the alternative (full-document parse per chunk) is the exact
 * O(L²) cost this module removes.
 */

/** Opening/closing code fence: optional indent, ``` or ~~~, then info string. */
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})(.*)$/;
/** Top-level bullet or ordered list item marker. */
const LIST_ITEM_RE = /^[ \t]{0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
/** Indented continuation line (list item content or indented code). */
const INDENTED_RE = /^(?: {2,}|\t)/;
/** Line containing only whitespace (CR tolerated for CRLF input). */
const BLANK_RE = /^[ \t\r]*$/;

interface FenceState {
  marker: string;
  length: number;
}

function tryOpenFence(content: string): FenceState | null {
  const match = FENCE_RE.exec(content);
  if (!match) return null;
  // A backtick fence's info string cannot contain backticks (CommonMark);
  // such lines are inline code inside a paragraph, not a fence.
  if (match[1][0] === '`' && match[2].includes('`')) return null;
  return { marker: match[1][0], length: match[1].length };
}

function closesFence(content: string, fence: FenceState): boolean {
  const match = FENCE_RE.exec(content);
  return Boolean(
    match
    && match[1][0] === fence.marker
    && match[1].length >= fence.length
    && match[2].trim() === '',
  );
}

/**
 * Split markdown into top-level blocks safe to render independently.
 * Blank lines between blocks are dropped (they render nothing); blank lines
 * inside a block (fences, loose lists) are preserved verbatim.
 */
export function splitMarkdownBlocks(source: string): string[] {
  if (!source) return [];

  const lines = source.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let blankRun: string[] = [];
  let fence: FenceState | null = null;
  let currentHasList = false;

  const flush = () => {
    if (current.length > 0) {
      blocks.push(current.join('\n'));
      current = [];
      currentHasList = false;
    }
  };

  for (const line of lines) {
    // Strip the CR so CRLF input matches the same patterns as LF input.
    const content = line.endsWith('\r') ? line.slice(0, -1) : line;

    if (fence) {
      current.push(line);
      if (closesFence(content, fence)) fence = null;
      continue;
    }

    if (BLANK_RE.test(content)) {
      // Defer the decision: the next content line tells us whether this is a
      // block boundary or interior whitespace (loose list, continuation).
      if (current.length > 0) blankRun.push(line);
      continue;
    }

    if (blankRun.length > 0) {
      // Candidate boundary. Merge instead of splitting when the next line is
      // indented continuation content, or continues a loose list. Merging is
      // always render-safe; splitting here would change semantics.
      const continuesList = currentHasList
        && (LIST_ITEM_RE.test(content) || INDENTED_RE.test(content));
      const isIndentedContinuation = INDENTED_RE.test(content);
      if (continuesList || isIndentedContinuation) {
        current.push(...blankRun);
      } else {
        flush();
      }
      blankRun = [];
    }

    fence = tryOpenFence(content);
    if (LIST_ITEM_RE.test(content)) currentHasList = true;
    current.push(line);
  }

  flush();
  return blocks;
}
