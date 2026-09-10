/**
 * Shared identifier / path-segment validation for plugin-shaped installs.
 *
 * Two call sites used to carry their own rules: the agent runtime extension
 * manifest parser (`SAFE_ID_RE` in `agent/runtime/extension-manifest.ts`) and
 * the Obsidian compat path layer (`assertSafeObsidianPluginId` in
 * `web/lib/obsidian-compat/plugin-paths.ts`). Both now delegate here so an id
 * that becomes a directory name is validated with one table: dot segments,
 * separators, Windows drives and reserved names, prototype keys, control
 * characters, unicode, and a length cap.
 */

export type SafePluginIdentifierIssue =
  | 'empty'
  | 'too-long'
  | 'control-char'
  | 'path-separator'
  | 'windows-reserved'
  | 'dot-segment'
  | 'prototype-key'
  | 'invalid-first-char'
  | 'invalid-char';

export interface SafePluginIdentifierOptions {
  /** Maximum accepted length in code points. Default 64 (Obsidian community plugin id cap). */
  maxLength?: number;
  /**
   * Allow `.` as an inner character (ids like `ext.buddy`). Dot *segments*
   * (`.`, `..`, `a..b`, trailing dot) are rejected either way. Default true.
   */
  allowDots?: boolean;
}

const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const WINDOWS_DRIVE_RE = /^[A-Za-z]:/;
const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/;
const DEFAULT_MAX_LENGTH = 64;

/**
 * Validate an identifier that may be used as a single path segment below a
 * managed plugin/extension root. Returns the issue code for the first failed
 * rule, or `undefined` when the value is safe.
 */
export function safePluginIdentifierIssue(
  raw: unknown,
  options: SafePluginIdentifierOptions = {},
): SafePluginIdentifierIssue | undefined {
  if (typeof raw !== 'string') return 'empty';
  const value = raw.trim();
  if (!value) return 'empty';

  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  if ([...value].length > maxLength) return 'too-long';
  if (CONTROL_CHARS_RE.test(value)) return 'control-char';
  if (value.includes('/') || value.includes('\\')) return 'path-separator';
  if (WINDOWS_DRIVE_RE.test(value) || WINDOWS_RESERVED_NAME_RE.test(value)) return 'windows-reserved';
  if (value === '.' || value === '..' || value.includes('..') || value.endsWith('.')) return 'dot-segment';
  if (PROTOTYPE_KEYS.has(value)) return 'prototype-key';

  const allowDots = options.allowDots !== false;
  const bodyPattern = allowDots ? '[A-Za-z0-9._-]*' : '[A-Za-z0-9_-]*';
  if (!/^[A-Za-z0-9]/.test(value)) return 'invalid-first-char';
  if (!new RegExp(`^[A-Za-z0-9]${bodyPattern}$`).test(value)) return 'invalid-char';
  return undefined;
}

export function isSafePluginIdentifier(
  raw: unknown,
  options?: SafePluginIdentifierOptions,
): raw is string {
  return typeof raw === 'string' && safePluginIdentifierIssue(raw, options) === undefined;
}

/**
 * Assert-style helper for call sites that throw on unsafe ids. `context` is
 * embedded in the message so each layer keeps its own vocabulary.
 */
export function assertSafePluginIdentifier(
  raw: unknown,
  options: SafePluginIdentifierOptions & { context?: string } = {},
): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const issue = safePluginIdentifierIssue(value, options);
  if (issue) {
    const context = options.context ?? 'plugin identifier';
    throw new Error(`Unsafe ${context} "${value}" (${issue}).`);
  }
  return value;
}
