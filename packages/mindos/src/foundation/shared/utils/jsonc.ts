/**
 * JSONC helpers shared by the product server handlers, the Web adapters and
 * the CLI (`bin/lib/jsonc.js` mirrors this module through `jsonc-parser`).
 *
 * VS Code-family editors (Cursor, Windsurf, Cline, Kilo) keep MCP settings in
 * JSONC: comments, trailing commas and sometimes a UTF-8 BOM. Reads must
 * tolerate all of that, and writes must edit the document in place so the
 * user's comments and formatting survive — `JSON.stringify` round-trips are
 * exactly what used to force the `.bak` backups.
 */

import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
  type JSONPath,
  type ParseError,
} from 'jsonc-parser';

const FORMATTING = { insertSpaces: true, tabSize: 2, eol: '\n' } as const;

export type JsoncDocument = {
  /** Parsed value (best effort; `undefined` when nothing could be recovered). */
  value: unknown;
  /** Human-readable parse issues such as `CloseBraceExpected at offset 6`. */
  errors: string[];
};

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function describeErrors(errors: ParseError[]): string[] {
  return errors.map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`);
}

/** Parse JSONC without throwing; callers decide how strict they need to be. */
export function parseJsoncDocument(text: string): JsoncDocument {
  const errors: ParseError[] = [];
  const value = parse(stripBom(text), errors, { allowTrailingComma: true, disallowComments: false }) as unknown;
  return { value, errors: describeErrors(errors) };
}

/**
 * Strict object parse: comments / BOM / trailing commas are fine, anything
 * that is not a syntactically valid object throws like `JSON.parse` did.
 * Blank or comment-only text yields `{}` (an empty config file).
 */
export function parseJsonc(text: string): Record<string, unknown> {
  const stripped = stripBom(text);
  const { value, errors } = parseJsoncDocument(stripped);
  if (value === undefined) {
    if (errors.length === 0 || isCommentOnly(stripped)) return {};
    throw new SyntaxError(`Invalid JSONC: ${errors.join('; ')}`);
  }
  if (errors.length > 0) throw new SyntaxError(`Invalid JSONC: ${errors.join('; ')}`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SyntaxError('Invalid JSONC: expected an object at the document root');
  }
  return value as Record<string, unknown>;
}

function isCommentOnly(text: string): boolean {
  // jsonc-parser reports "ValueExpected" for a document that only holds
  // comments/whitespace; treat that as an empty config rather than an error.
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return withoutComments.trim() === '';
}

/**
 * Set `path` to `value`, creating intermediate objects, and return the new
 * text. Existing comments, key order and indentation are preserved; an empty
 * document becomes a fresh 2-space JSON object with a trailing newline.
 */
export function setJsoncValue(text: string, path: JSONPath, value: unknown): string {
  const source = stripBom(text);
  const edits = modify(source, path, value, { formattingOptions: FORMATTING });
  return ensureTrailingNewline(applyEdits(source, edits));
}

/** Remove `path` (no-op when it does not exist) and return the new text. */
export function removeJsoncValue(text: string, path: JSONPath): string {
  const source = stripBom(text);
  const edits = modify(source, path, undefined, { formattingOptions: FORMATTING });
  if (edits.length === 0) return text;
  return ensureTrailingNewline(applyEdits(source, edits));
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}
