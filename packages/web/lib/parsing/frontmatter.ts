import yaml from 'js-yaml';

export type FrontmatterScalar = string | number | boolean | null;
export type FrontmatterValue =
  | FrontmatterScalar
  | Date
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

export interface FrontmatterEntry {
  key: string;
  value: FrontmatterValue;
}

export interface MarkdownFrontmatter {
  raw: string;
  /** Original leading `--- ... ---` block, including the closing fence newline. */
  block: string;
  /** Original separator between the frontmatter block and the markdown body. */
  bodySeparator: string;
  entries: FrontmatterEntry[];
}

export interface SplitMarkdownFrontmatterResult {
  body: string;
  frontmatter: MarkdownFrontmatter | null;
}

const OPENING_FENCE_RE = /^\uFEFF?---[ \t]*(?:\r?\n)/;
const CLOSING_FENCE_RE = /^---[ \t]*(?:\r?\n|$)/gm;

interface FrontmatterFenceBounds {
  openingEnd: number;
  closingStart: number;
  closingEnd: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function normalizeValue(value: unknown, seen = new WeakSet<object>()): FrontmatterValue {
  if (value === null) return null;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    return value.map((item) => normalizeValue(item, seen));
  }
  if (isRecord(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, normalizeValue(nested, seen)]),
    );
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  return String(value);
}

function trimSerializableValue(value: FrontmatterValue | undefined): FrontmatterValue | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => trimSerializableValue(item))
      .filter((item): item is FrontmatterValue => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value as { [key: string]: FrontmatterValue })
      .map(([key, nested]) => [key, trimSerializableValue(nested)] as const)
      .filter((entry): entry is readonly [string, FrontmatterValue] => entry[1] !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
  return value;
}

function findFrontmatterFenceBounds(content: string): FrontmatterFenceBounds | null {
  const opening = content.match(OPENING_FENCE_RE);
  if (!opening?.[0]) return null;

  // Use a fresh stateful regexp so callers never share lastIndex across renders.
  const closingFenceRe = new RegExp(CLOSING_FENCE_RE.source, CLOSING_FENCE_RE.flags);
  closingFenceRe.lastIndex = opening[0].length;
  const closing = closingFenceRe.exec(content);
  if (!closing) return null;

  return {
    openingEnd: opening[0].length,
    closingStart: closing.index,
    closingEnd: closing.index + closing[0].length,
  };
}

/**
 * Cheap guard for editor routing. It intentionally does not parse YAML: callers
 * combine this with splitMarkdownFrontmatter when they need to distinguish
 * safe properties from malformed frontmatter-like markdown.
 */
export function hasMarkdownFrontmatterFence(content: string): boolean {
  return findFrontmatterFenceBounds(content) !== null;
}

export function splitMarkdownFrontmatter(content: string): SplitMarkdownFrontmatterResult {
  const bounds = findFrontmatterFenceBounds(content);
  if (!bounds) return { body: content, frontmatter: null };

  const raw = content.slice(bounds.openingEnd, bounds.closingStart).replace(/\r?\n$/, '');
  const block = content.slice(0, bounds.closingEnd);
  const afterBlock = content.slice(bounds.closingEnd);
  const bodySeparator = afterBlock.startsWith('\r\n')
    ? '\r\n'
    : afterBlock.startsWith('\n')
      ? '\n'
      : '';
  const body = content.slice(bounds.closingEnd + bodySeparator.length);

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    return { body: content, frontmatter: null };
  }

  if (parsed == null) {
    return { body, frontmatter: { raw, block, bodySeparator, entries: [] } };
  }

  if (!isRecord(parsed)) {
    return { body: content, frontmatter: null };
  }

  return {
    body,
    frontmatter: {
      raw,
      block,
      bodySeparator,
      entries: Object.entries(parsed).map(([key, value]) => ({
        key,
        value: normalizeValue(value),
      })),
    },
  };
}

export function composeMarkdownFrontmatter(frontmatter: MarkdownFrontmatter, body: string): string {
  return `${frontmatter.block}${frontmatter.bodySeparator}${body}`;
}

export function serializeMarkdownFrontmatter(fields: Record<string, FrontmatterValue | undefined>): string {
  const cleaned = Object.fromEntries(
    Object.entries(fields)
      .map(([key, value]) => [key, trimSerializableValue(value)] as const)
      .filter((entry): entry is readonly [string, FrontmatterValue] => entry[1] !== undefined),
  );

  if (Object.keys(cleaned).length === 0) return '';

  const serialized = yaml.dump(cleaned, {
    lineWidth: -1,
    noRefs: true,
    schema: yaml.JSON_SCHEMA,
    sortKeys: false,
  }).trimEnd();

  return `---\n${serialized}\n---\n`;
}
