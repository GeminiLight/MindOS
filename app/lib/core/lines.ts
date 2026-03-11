import { readFile, writeFile } from './fs-ops';

/**
 * Reads a file and returns its content split into lines.
 */
export function readLines(mindRoot: string, filePath: string): string[] {
  return readFile(mindRoot, filePath).split('\n');
}

/**
 * Validates line indices are within bounds.
 */
function validateLineRange(totalLines: number, start: number, end: number): void {
  if (start < 0 || end < 0) throw new Error('Invalid line index: indices must be >= 0');
  if (start > end) throw new Error(`Invalid range: start (${start}) > end (${end})`);
  if (start >= totalLines) throw new Error(`Invalid line index: start (${start}) >= total lines (${totalLines})`);
}

/**
 * Inserts lines after the given 0-based index.
 * Use afterIndex = -1 to prepend at the start.
 */
export function insertLines(mindRoot: string, filePath: string, afterIndex: number, lines: string[]): void {
  const existing = readLines(mindRoot, filePath);
  if (afterIndex >= existing.length) {
    throw new Error(`Invalid after_index: ${afterIndex} >= total lines (${existing.length})`);
  }
  const insertAt = afterIndex < 0 ? 0 : afterIndex + 1;
  existing.splice(insertAt, 0, ...lines);
  writeFile(mindRoot, filePath, existing.join('\n'));
}

/**
 * Replaces lines from startIndex to endIndex (inclusive) with newLines.
 */
export function updateLines(mindRoot: string, filePath: string, startIndex: number, endIndex: number, newLines: string[]): void {
  const existing = readLines(mindRoot, filePath);
  validateLineRange(existing.length, startIndex, endIndex);
  existing.splice(startIndex, endIndex - startIndex + 1, ...newLines);
  writeFile(mindRoot, filePath, existing.join('\n'));
}

/**
 * Appends content to the end of a file, adding a newline separator if needed.
 */
export function appendToFile(mindRoot: string, filePath: string, content: string): void {
  const existing = readFile(mindRoot, filePath);
  const separator = existing.length > 0 && !existing.endsWith('\n\n') ? '\n' : '';
  writeFile(mindRoot, filePath, existing + separator + content);
}

/**
 * Inserts content after the first occurrence of a Markdown heading.
 */
export function insertAfterHeading(mindRoot: string, filePath: string, heading: string, content: string): void {
  const lines = readLines(mindRoot, filePath);
  const idx = lines.findIndex(l => {
    const trimmed = l.trim();
    return trimmed === heading || trimmed.replace(/^#+\s*/, '') === heading.replace(/^#+\s*/, '');
  });
  if (idx === -1) throw new Error(`Heading not found: "${heading}"`);
  let insertAt = idx + 1;
  while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++;
  insertLines(mindRoot, filePath, insertAt - 1, ['', content]);
}

/**
 * Replaces the content of a Markdown section identified by its heading.
 */
export function updateSection(mindRoot: string, filePath: string, heading: string, newContent: string): void {
  const lines = readLines(mindRoot, filePath);
  const idx = lines.findIndex(l => {
    const trimmed = l.trim();
    return trimmed === heading || trimmed.replace(/^#+\s*/, '') === heading.replace(/^#+\s*/, '');
  });
  if (idx === -1) throw new Error(`Heading not found: "${heading}"`);

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
  updateLines(mindRoot, filePath, idx + 1, sectionEnd, ['', newContent]);
}
