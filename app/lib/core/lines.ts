import fs from 'fs';
import path from 'path';
import { readFile, writeFile } from './fs-ops';
import { MindOSError, ErrorCodes } from '@/lib/errors';
import { resolveSafe } from './security';

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
  if (start < 0 || end < 0) throw new MindOSError(ErrorCodes.INVALID_RANGE, 'Invalid line index: indices must be >= 0', { start, end });
  if (start > end) throw new MindOSError(ErrorCodes.INVALID_RANGE, `Invalid range: start (${start}) > end (${end})`, { start, end });
  if (start >= totalLines) throw new MindOSError(ErrorCodes.INVALID_RANGE, `Invalid line index: start (${start}) >= total lines (${totalLines})`, { start, totalLines });
}

/**
 * Inserts lines after the given 0-based index.
 * Use afterIndex = -1 to prepend at the start.
 */
export function insertLines(mindRoot: string, filePath: string, afterIndex: number, lines: string[]): void {
  const existing = readLines(mindRoot, filePath);
  if (afterIndex >= existing.length) {
    throw new MindOSError(ErrorCodes.INVALID_RANGE, `Invalid after_index: ${afterIndex} >= total lines (${existing.length})`, { afterIndex, totalLines: existing.length });
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
 * Appends content to the end of a file using fs.appendFileSync.
 * Only reads the last 2 bytes to determine separator — avoids reading the entire file.
 * This is O(1) instead of O(file-size) for the common append-to-log/journal use case.
 */
export function appendToFile(mindRoot: string, filePath: string, content: string): void {
  const absPath = resolveSafe(mindRoot, filePath);
  try {
    const stat = fs.statSync(absPath);
    if (stat.size === 0) {
      // Empty file — just write content directly
      fs.appendFileSync(absPath, content, 'utf-8');
      return;
    }
    // Read last few bytes to determine if we need a newline separator.
    // Read 8 bytes to handle multi-byte UTF-8 chars (CJK = 3 bytes each).
    const readLen = Math.min(8, stat.size);
    const fd = fs.openSync(absPath, 'r');
    try {
      const buf = Buffer.alloc(readLen);
      fs.readSync(fd, buf, 0, readLen, Math.max(0, stat.size - readLen));
      const tail = buf.toString('utf-8');
      const separator = tail.endsWith('\n\n') ? '' : '\n';
      fs.appendFileSync(absPath, separator + content, 'utf-8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    // Fallback to read-write for edge cases (e.g., file doesn't exist yet)
    const existing = readFile(mindRoot, filePath);
    const separator = existing.length > 0 && !existing.endsWith('\n\n') ? '\n' : '';
    writeFile(mindRoot, filePath, existing + separator + content);
  }
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
  if (idx === -1) throw new MindOSError(ErrorCodes.HEADING_NOT_FOUND, `Heading not found: "${heading}"`, { heading });
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
  if (idx === -1) throw new MindOSError(ErrorCodes.HEADING_NOT_FOUND, `Heading not found: "${heading}"`, { heading });

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
