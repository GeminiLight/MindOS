/**
 * Pure Markdown section manipulation functions.
 * Port of packages/web/lib/core/lines.ts logic for CLI use (no server needed).
 */

/**
 * Finds the line index of a heading in a lines array.
 * Matches both exact ("## Foo") and bare ("Foo" matching "## Foo").
 * @returns -1 if not found
 */
export function findHeadingIndex(lines, heading) {
  const bare = heading.replace(/^#+\s*/, '');
  return lines.findIndex(l => {
    const trimmed = l.trim();
    return trimmed === heading || trimmed.replace(/^#+\s*/, '') === bare;
  });
}

/**
 * Replace the body of a markdown section (heading → next same/higher-level heading).
 * @returns new full content, or null if heading not found
 */
export function replaceSection(content, heading, newBody) {
  const lines = content.split('\n');
  const idx = findHeadingIndex(lines, heading);
  if (idx === -1) return null;

  const headingLevel = (lines[idx].match(/^#+/) ?? [''])[0].length;
  let sectionEnd = lines.length - 1;
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= headingLevel) {
      sectionEnd = i - 1;
      break;
    }
  }
  while (sectionEnd > idx && lines[sectionEnd].trim() === '') sectionEnd--;

  const before = lines.slice(0, idx + 1);
  const after = lines.slice(sectionEnd + 1);
  return [...before, '', newBody, ...after].join('\n');
}

/**
 * Insert content after a markdown heading (before existing body).
 * @returns new full content, or null if heading not found
 */
export function insertAfterHeading(content, heading, insertion) {
  const lines = content.split('\n');
  const idx = findHeadingIndex(lines, heading);
  if (idx === -1) return null;

  let insertAt = idx + 1;
  while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++;

  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  return [...before, '', insertion, ...after].join('\n');
}

/**
 * Extract all headings from markdown content.
 * @returns array of heading lines (e.g., ["## A", "### B"])
 */
export function listHeadings(content) {
  return content.split('\n')
    .filter(l => /^#{1,6}\s/.test(l))
    .map(l => l.trim());
}
