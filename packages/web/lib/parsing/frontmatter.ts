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
  entries: FrontmatterEntry[];
}

export interface SplitMarkdownFrontmatterResult {
  body: string;
  frontmatter: MarkdownFrontmatter | null;
}

const OPENING_FENCE_RE = /^\uFEFF?---[ \t]*(?:\r?\n)/;
const CLOSING_FENCE_RE = /^---[ \t]*(?:\r?\n|$)/gm;

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

export function splitMarkdownFrontmatter(content: string): SplitMarkdownFrontmatterResult {
  const opening = content.match(OPENING_FENCE_RE);
  if (!opening?.[0]) {
    return { body: content, frontmatter: null };
  }

  CLOSING_FENCE_RE.lastIndex = opening[0].length;
  const closing = CLOSING_FENCE_RE.exec(content);
  if (!closing) {
    return { body: content, frontmatter: null };
  }

  const raw = content.slice(opening[0].length, closing.index).replace(/\r?\n$/, '');
  const body = content.slice(closing.index + closing[0].length).replace(/^\r?\n/, '');

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch {
    return { body: content, frontmatter: null };
  }

  if (parsed == null) {
    return { body, frontmatter: { raw, entries: [] } };
  }

  if (!isRecord(parsed)) {
    return { body: content, frontmatter: null };
  }

  return {
    body,
    frontmatter: {
      raw,
      entries: Object.entries(parsed).map(([key, value]) => ({
        key,
        value: normalizeValue(value),
      })),
    },
  };
}
