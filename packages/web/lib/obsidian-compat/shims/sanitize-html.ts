/**
 * Obsidian Plugin Compatibility - degraded HTML sanitizer
 *
 * The server tier has no HTML parser and must not grow one ad hoc: parsing
 * untrusted markup is the classic XSS entry point. sanitizeHTMLToDom therefore
 * degrades to text extraction (script/style blocks and comments dropped, tags
 * stripped, common entities decoded) and returns a text-only fragment. The
 * browser tier should replace this with a real sanitizer (DOMPurify) once it
 * mounts a live DOM.
 */

import { createObsidianDocumentFragment } from './dom';

const HTML_ENTITY_DECODINGS: ReadonlyArray<readonly [RegExp, string]> = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&apos;/g, "'"],
  [/&nbsp;/g, ' '],
  [/&amp;/g, '&'],
];

/**
 * Extract the visible text of an HTML string without any structural parsing.
 * Returns an empty string for empty or non-string input.
 */
export function extractSanitizedText(html: string): string {
  if (typeof html !== 'string' || html.length === 0) return '';
  let text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, ' ');
  for (const [pattern, replacement] of HTML_ENTITY_DECODINGS) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s+/g, ' ').trim();
}

export function sanitizeHTMLToDom(html: string): DocumentFragment {
  return createObsidianDocumentFragment(extractSanitizedText(html));
}
