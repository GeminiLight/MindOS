/**
 * JSONC helpers for the CLI — the JS mirror of
 * `packages/mindos/src/foundation/shared/utils/jsonc.ts` (bin/lib cannot import
 * from dist/). Both sit on `jsonc-parser`, which resolves from the product
 * package's own dependencies like `chokidar` does for the sync daemon.
 *
 * VS Code-based editors (Cursor, Windsurf, Cline, Kilo) use JSONC for config
 * files; Windows editors (Notepad) may prepend a UTF-8 BOM (﻿). Reads
 * tolerate comments, trailing commas and a BOM; writes edit the original text
 * in place so user comments and formatting survive.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Bun standalone executables (the published platform packages) extract bin/,
 * dist/ and node_modules/ into ~/.mindos/runtime-cache but cannot resolve bare
 * npm specifiers from those files: `import 'jsonc-parser'`, `require()` and
 * createRequire all fail with "Cannot find package". Exact file paths do load,
 * so walk up from this file to the nearest node_modules copy and import the
 * package's ESM entry by path; plain Node keeps the ordinary bare import.
 * tests/bun-single-binary-contract.test.ts forbids static bare imports here.
 */
async function loadJsoncParser() {
  try {
    return await import('jsonc-parser');
  } catch (bareError) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (let dir = here; ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, 'node_modules', 'jsonc-parser', 'lib', 'esm', 'main.js');
      if (existsSync(candidate)) return import(pathToFileURL(candidate).href);
      if (path.dirname(dir) === dir) break;
    }
    throw bareError;
  }
}

const { applyEdits, modify, parse, printParseErrorCode } = await loadJsoncParser();

const FORMATTING = { insertSpaces: true, tabSize: 2, eol: '\n' };

export function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

/** Parse without throwing: `{ value, errors }` where errors are readable strings. */
export function parseJsoncDocument(text) {
  const errors = [];
  const value = parse(stripBom(text), errors, { allowTrailingComma: true, disallowComments: false });
  return {
    value,
    errors: errors.map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`),
  };
}

function isCommentOnly(text) {
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return withoutComments.trim() === '';
}

/** Strict object parse; blank / comment-only text yields `{}`, anything invalid throws. */
export const parseJsonc = (text) => {
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
  return value;
};

function ensureTrailingNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}

/** Set `path` (array of keys) to `value` in place, preserving comments and formatting. */
export function setJsoncValue(text, path, value) {
  const source = stripBom(text);
  return ensureTrailingNewline(applyEdits(source, modify(source, path, value, { formattingOptions: FORMATTING })));
}

/** Remove `path` in place; returns the input unchanged when the path is missing. */
export function removeJsoncValue(text, path) {
  const source = stripBom(text);
  const edits = modify(source, path, undefined, { formattingOptions: FORMATTING });
  if (edits.length === 0) return text;
  return ensureTrailingNewline(applyEdits(source, edits));
}
