/**
 * Smart paragraph extraction — when content exceeds a size limit, extract
 * the most query-relevant paragraphs instead of naive head truncation.
 *
 * Algorithm:
 * 1. Split content into paragraphs (double-newline or heading boundaries)
 * 2. Score each paragraph by query term overlap (case-insensitive)
 * 3. Return top-K paragraphs in original order, within budget
 */

/** Split text into paragraphs at blank lines or markdown headings */
export function splitParagraphs(text: string): string[] {
  // Split on double newlines or before headings (# at line start)
  const blocks = text.split(/\n{2,}|\n(?=^#{1,6}\s)/m);
  return blocks.map(b => b.trim()).filter(b => b.length > 0);
}

/** Score a paragraph by how many query terms it contains */
function scoreParagraph(paragraph: string, queryTerms: string[]): number {
  const lower = paragraph.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (!term) continue;
    // Count occurrences
    let idx = 0;
    while ((idx = lower.indexOf(term, idx)) !== -1) {
      score += 1;
      idx += term.length;
    }
  }
  // Bonus for headings (structural importance)
  if (/^#{1,3}\s/.test(paragraph)) score += 2;
  return score;
}

/**
 * Extract the most relevant paragraphs from content for a given query.
 * Returns content within maxChars limit, preserving original order.
 *
 * If no query is provided, falls back to head truncation (keeping the
 * beginning of the file which usually has the most important context).
 */
export function extractRelevantContent(
  content: string,
  maxChars: number,
  query?: string
): { result: string; truncated: boolean } {
  if (content.length <= maxChars) {
    return { result: content, truncated: false };
  }

  // No query → smart head truncation at paragraph boundary
  if (!query || query.trim().length === 0) {
    return headTruncate(content, maxChars);
  }

  const paragraphs = splitParagraphs(content);
  if (paragraphs.length === 0) {
    return headTruncate(content, maxChars);
  }

  // Tokenize query into terms
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);

  // Score and rank paragraphs
  const scored = paragraphs.map((p, idx) => ({
    paragraph: p,
    originalIndex: idx,
    score: scoreParagraph(p, queryTerms),
  }));

  // Always include first paragraph (file title / context), but cap to budget
  const selected: typeof scored = [];
  let usedChars = 0;

  // First: include paragraph 0 (title/intro) if it fits in budget
  if (scored.length > 0 && scored[0].paragraph.length <= maxChars) {
    selected.push(scored[0]);
    usedChars += scored[0].paragraph.length;
  }

  // Then: add highest-scoring paragraphs that fit in budget
  const ranked = [...scored.slice(1)].sort((a, b) => b.score - a.score);
  for (const item of ranked) {
    if (usedChars + item.paragraph.length + 2 > maxChars) continue;
    selected.push(item);
    usedChars += item.paragraph.length + 2; // +2 for \n\n separator
  }

  // Sort by original order to maintain document flow
  selected.sort((a, b) => a.originalIndex - b.originalIndex);

  const totalParagraphs = paragraphs.length;
  const selectedCount = selected.length;
  const result = selected.map(s => s.paragraph).join('\n\n');
  const suffix = selectedCount < totalParagraphs
    ? `\n\n[...extracted ${selectedCount}/${totalParagraphs} paragraphs by relevance — file is ${content.length} chars]`
    : '';

  return { result: result + suffix, truncated: selectedCount < totalParagraphs };
}

/** Truncate at a natural paragraph boundary */
function headTruncate(content: string, maxChars: number): { result: string; truncated: boolean } {
  // Find the last double-newline before the limit
  let cutoff = content.lastIndexOf('\n\n', maxChars);
  if (cutoff === -1 || cutoff < maxChars * 0.5) {
    cutoff = content.lastIndexOf('\n', maxChars);
  }
  if (cutoff === -1) cutoff = maxChars;

  const totalLines = content.split('\n').length;
  const truncated = content.slice(0, cutoff)
    + `\n\n[...truncated — file is ${content.length} chars (${totalLines} lines), showing first ~${cutoff} chars]`
    + '\n[Use read_file_chunk to read the rest of the file by specifying start_line and end_line]';
  return { result: truncated, truncated: true };
}
