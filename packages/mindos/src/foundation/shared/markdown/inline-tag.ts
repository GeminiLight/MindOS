/**
 * Parse Obsidian inline tags (`#tag`).
 *
 * Pure, like the other vault data-format parsers. `link-index.ts` has carried a
 * near-identical regex for the link graph; this is the shared definition so the
 * graph and the reading view agree on what counts as a tag.
 *
 * Obsidian's rules that matter here:
 *  - the `#` must not follow a word character, so `C#`, `item#3` and a URL
 *    fragment like `page#section` are not tags, while `标签：#project`,
 *    `（#tag）` and `"#tag"` are — CJK prose abuts punctuation directly, so a
 *    "preceded by whitespace" rule would miss most Chinese usage;
 *  - `# Heading` is not a tag either: a space follows the hash, so there are no
 *    tag characters to capture;
 *  - a tag may contain letters, digits, `_`, `-` and `/` (nested tags), but may
 *    not be *only* digits — `#1` and `#2024` are prose, not tags.
 */

export type InlineTagMatch = {
  /** Tag text without the leading `#`. */
  tag: string;
  /** Offset of the `#` in the input. */
  index: number;
  /** Length of the whole match, including the `#`. */
  length: number;
};

// `\p{L}` / `\p{N}` keep unicode tags working; the lookbehind rejects a hash
// glued to the end of a word without consuming the preceding character.
const INLINE_TAG_RE = /(?<![\p{L}\p{N}_])#([\p{L}\p{N}_/-]+)/gu;

// A `#` inside `[[...]]` is a wiki-link subpath, and one inside a markdown link
// destination is a url fragment — neither is a tag. Blank them out rather than
// removing them so match offsets still point into the original string.
const NON_TAG_SPANS = [
  /\[\[[^\]\n]*\]\]/g,   // [[Note#Heading]]
  /\]\([^)\n]*\)/g,      // [label](path#frag)
];

function maskNonTagSpans(content: string): string {
  let masked = content;
  for (const pattern of NON_TAG_SPANS) {
    masked = masked.replace(pattern, (span) => ' '.repeat(span.length));
  }
  return masked;
}

function isTagLike(value: string): boolean {
  // Must contain at least one letter/digit, and must not be digits only.
  if (!/[\p{L}\p{N}]/u.test(value)) return false;
  return !/^\p{N}+$/u.test(value);
}

/** Find every inline tag in `content`, in source order. */
export function parseInlineTags(content: string): InlineTagMatch[] {
  const matches: InlineTagMatch[] = [];
  const scannable = maskNonTagSpans(content);
  INLINE_TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_TAG_RE.exec(scannable)) !== null) {
    const tag = match[1]!;
    if (!isTagLike(tag)) continue;
    matches.push({ tag, index: match.index, length: tag.length + 1 });
  }

  return matches;
}
