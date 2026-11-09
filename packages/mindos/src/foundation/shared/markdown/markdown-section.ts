/**
 * Extract a section of a Markdown document by Obsidian subpath.
 *
 * Used by note embeds (`![[note#Heading]]`). Pure — content in, slice out — so
 * it sits with the other vault data-format parsers rather than in the plugin
 * host, whose `resolveSubpath` is tied to Obsidian's `CachedMetadata` shape.
 *
 * Heading sections follow Obsidian: a heading owns everything until the next
 * heading of the same or higher level, so embedding `## A` also brings its
 * `### A.1` subsections. Headings and block ids inside fenced code blocks are
 * not structure and are skipped.
 */

import type { WikiLinkSubpath } from './wiki-link.js';

/** Remove a leading YAML frontmatter block, if present. */
export function stripFrontmatter(content: string): string {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return content;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === '---') return lines.slice(index + 1).join('\n');
  }
  // Unterminated frontmatter: the whole document is front matter.
  return '';
}

type Line = { text: string; index: number; inFence: boolean };

function scan(content: string): Line[] {
  const lines: Line[] = [];
  let fence: string | null = null;
  content.split('\n').forEach((text, index) => {
    const marker = text.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (fence) {
      lines.push({ text, index, inFence: true });
      if (marker && marker.startsWith(fence[0]!) && marker.length >= fence.length) fence = null;
      return;
    }
    if (marker) {
      fence = marker;
      lines.push({ text, index, inFence: true });
      return;
    }
    lines.push({ text, index, inFence: false });
  });
  return lines;
}

function headingLevel(text: string): number | null {
  const match = text.match(/^(#{1,6})\s+(.*)$/);
  return match ? match[1]!.length : null;
}

function headingText(text: string): string {
  return text.replace(/^#{1,6}\s+/, '').trim();
}

/** Trim leading and trailing blank lines without touching interior blanks. */
function trimBlankLines(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === '') start += 1;
  while (end > start && lines[end - 1]!.trim() === '') end -= 1;
  return lines.slice(start, end).join('\n');
}

/**
 * Return the slice of `content` named by `subpath`, or the whole body when no
 * subpath is given. Returns null when the target does not exist.
 */
export function extractMarkdownSection(
  content: string,
  subpath: WikiLinkSubpath | undefined,
): string | null {
  const body = stripFrontmatter(content);
  if (!subpath) return body;
  if (!subpath.value) return null;

  const lines = scan(body);
  const raw = body.split('\n');

  if (subpath.type === 'block') {
    const needle = subpath.value.toLowerCase();
    for (const line of lines) {
      if (line.inFence) continue;
      const id = line.text.match(/\s\^([\w-]+)\s*$/)?.[1];
      if (id?.toLowerCase() !== needle) continue;
      // Obsidian hides the `^id` marker when rendering the block.
      return line.text.replace(/\s\^[\w-]+\s*$/, '').trimEnd();
    }
    return null;
  }

  const wanted = subpath.value.trim().toLowerCase();
  const startLine = lines.find((line) => (
    !line.inFence && headingLevel(line.text) !== null && headingText(line.text).toLowerCase() === wanted
  ));
  if (!startLine) return null;

  const level = headingLevel(startLine.text)!;
  let end = raw.length;
  for (const line of lines) {
    if (line.index <= startLine.index || line.inFence) continue;
    const nextLevel = headingLevel(line.text);
    if (nextLevel !== null && nextLevel <= level) {
      end = line.index;
      break;
    }
  }

  return trimBlankLines(raw.slice(startLine.index, end));
}
