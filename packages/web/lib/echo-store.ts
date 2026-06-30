import fs from 'fs';
import path from 'path';
import { resolveSafe } from './core/security';
import type { EchoAssistantId } from './echo-assistants';

export const ECHO_SPACE_DIR = 'Echo';
const ECHO_STATE_DIR = '.mindos/echo';
const ECHO_DRAFT_DIR = `${ECHO_STATE_DIR}/drafts`;
const ECHO_EVENTS_DIR = `${ECHO_STATE_DIR}/events`;
const ECHO_INDEX_PATH = `${ECHO_STATE_DIR}/index.json`;

export const ECHO_STORED_SEGMENTS = ['imprint', 'threads', 'growth', 'practice'] as const;
export type EchoStoredSegment = (typeof ECHO_STORED_SEGMENTS)[number];

export type EchoSavedItem = {
  type: EchoMemoryType;
  segment: EchoStoredSegment;
  title: string;
  path: string;
  date: string;
  updatedAt: string;
  excerpt: string;
  assistantId?: string;
};

export type EchoSavedItemDetail = EchoSavedItem & {
  markdown: string;
};

export type EchoDraft = {
  type: EchoMemoryType;
  segment: EchoStoredSegment;
  title: string;
  markdown: string;
  assistantId?: string;
  status: 'draft';
  createdAt: string;
};

export type EchoIndex = {
  updatedAt: string;
  items: EchoSavedItem[];
};

export type SaveEchoInput = {
  segment: EchoStoredSegment;
  markdown: string;
  assistantId?: EchoAssistantId | string;
  title?: string;
  now?: Date;
};

export type SaveEchoResult = {
  item: EchoSavedItem;
  content: string;
};

type EchoMemoryType = 'echo.imprint' | 'echo.thread' | 'echo.insight' | 'echo.practice';

const SEGMENT_DIR: Record<EchoStoredSegment, string> = {
  imprint: 'Daily',
  threads: 'Threads',
  growth: 'Insights',
  practice: 'Practices',
};

const SEGMENT_TYPE: Record<EchoStoredSegment, EchoMemoryType> = {
  imprint: 'echo.imprint',
  threads: 'echo.thread',
  growth: 'echo.insight',
  practice: 'echo.practice',
};

const DRAFT_KEY: Record<EchoStoredSegment, string> = {
  imprint: 'imprint',
  threads: 'thread',
  growth: 'insight',
  practice: 'practice',
};

const DEFAULT_TITLE: Record<EchoStoredSegment, string> = {
  imprint: 'Echo Imprint',
  threads: 'Echo Thread',
  growth: 'Echo Insight',
  practice: 'Echo Promotion',
};

export function normalizeEchoStoredSegment(value: unknown): EchoStoredSegment | null {
  return typeof value === 'string' && ECHO_STORED_SEGMENTS.includes(value as EchoStoredSegment)
    ? value as EchoStoredSegment
    : null;
}

export function listEchoItems(mindRoot: string, segment?: EchoStoredSegment): EchoIndex {
  const segments = segment ? [segment] : [...ECHO_STORED_SEGMENTS];
  const items = segments.flatMap((entry) => collectSegmentItems(mindRoot, entry));
  items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.title.localeCompare(b.title));
  return {
    updatedAt: new Date().toISOString(),
    items,
  };
}

export function readEchoItemDetail(
  mindRoot: string,
  segment: EchoStoredSegment,
  itemPath: string,
): EchoSavedItemDetail | null {
  const normalizedPath = normalizeEchoItemPath(segment, itemPath);
  if (!normalizedPath) return null;

  const content = readEchoMarkdown(mindRoot, normalizedPath);
  if (content == null) return null;

  const item = echoItemFromMarkdown(mindRoot, segment, normalizedPath, content);
  return {
    ...item,
    markdown: normalizeMarkdownBody(content),
  };
}

export function saveEchoDraft(mindRoot: string, input: SaveEchoInput): EchoDraft {
  const now = input.now ?? new Date();
  const title = extractEchoTitle(input.markdown, input.title, input.segment);
  const draft: EchoDraft = {
    type: SEGMENT_TYPE[input.segment],
    segment: input.segment,
    title,
    markdown: normalizeMarkdownBody(input.markdown),
    ...(input.assistantId ? { assistantId: input.assistantId } : {}),
    status: 'draft',
    createdAt: now.toISOString(),
  };

  writeJson(mindRoot, `${ECHO_DRAFT_DIR}/latest-${DRAFT_KEY[input.segment]}.json`, draft);
  appendEchoEvent(mindRoot, {
    type: `${SEGMENT_TYPE[input.segment]}.drafted`,
    at: now.toISOString(),
    segment: input.segment,
    title,
    assistantId: input.assistantId,
  });
  return draft;
}

export function saveEchoItem(mindRoot: string, input: SaveEchoInput): SaveEchoResult {
  const now = input.now ?? new Date();
  const title = extractEchoTitle(input.markdown, input.title, input.segment);
  const date = dateParts(now).date;
  const pathInMind = uniqueEchoPath(mindRoot, input.segment, title, now);
  const content = formatEchoMarkdown({
    segment: input.segment,
    title,
    markdown: input.markdown,
    assistantId: input.assistantId,
    now,
  });

  ensureEchoSpace(mindRoot);
  writeTextExclusive(mindRoot, pathInMind, content);

  const stat = fs.statSync(resolveSafe(mindRoot, pathInMind));
  const item: EchoSavedItem = {
    type: SEGMENT_TYPE[input.segment],
    segment: input.segment,
    title,
    path: pathInMind,
    date,
    updatedAt: stat.mtime.toISOString(),
    excerpt: excerptFromMarkdown(content),
    ...(input.assistantId ? { assistantId: input.assistantId } : {}),
  };

  appendEchoEvent(mindRoot, {
    type: `${SEGMENT_TYPE[input.segment]}.saved`,
    at: now.toISOString(),
    segment: input.segment,
    title,
    path: pathInMind,
    assistantId: input.assistantId,
  });
  writeEchoIndex(mindRoot, listEchoItems(mindRoot));

  return { item, content };
}

function ensureEchoSpace(mindRoot: string): void {
  writeTextIfMissing(
    mindRoot,
    `${ECHO_SPACE_DIR}/README.md`,
    '# Echo\n\nEcho stores reviewable reflections generated from MindOS activity and user-confirmed assistant drafts.\n',
  );
  writeTextIfMissing(
    mindRoot,
    `${ECHO_SPACE_DIR}/INSTRUCTION.md`,
    '# Echo Instructions\n\nKeep Echo notes concrete, reviewable, and grounded in visible user context. Do not treat drafts as durable memory until the user saves them.\n',
  );
}

function collectSegmentItems(mindRoot: string, segment: EchoStoredSegment): EchoSavedItem[] {
  const dir = segmentRoot(segment);
  const absDir = resolveSafe(mindRoot, dir);
  if (!fs.existsSync(absDir)) return [];

  const files: string[] = [];
  walk(absDir, (absPath) => {
    if (!absPath.endsWith('.md')) return;
    const rel = toRelativeMindPath(mindRoot, absPath);
    if (rel.endsWith('/README.md') || rel.endsWith('/INSTRUCTION.md')) return;
    files.push(rel);
  });

  return files.flatMap((filePath) => {
    const content = readEchoMarkdown(mindRoot, filePath);
    if (content == null) return [];
    try {
      return [echoItemFromMarkdown(mindRoot, segment, filePath, content)];
    } catch {
      return [];
    }
  });
}

function echoItemFromMarkdown(
  mindRoot: string,
  segment: EchoStoredSegment,
  filePath: string,
  content: string,
): EchoSavedItem {
  const abs = resolveSafe(mindRoot, filePath);
  const meta = parseFrontmatter(content);
  const stat = fs.statSync(abs);
  const title = String(meta.title || firstMarkdownHeading(content) || path.basename(filePath, '.md'));
  const date = String(meta.date || stat.mtime.toISOString().slice(0, 10));
  return {
    type: SEGMENT_TYPE[segment],
    segment,
    title,
    path: filePath,
    date,
    updatedAt: stat.mtime.toISOString(),
    excerpt: excerptFromMarkdown(content),
    ...(typeof meta.assistantId === 'string' ? { assistantId: meta.assistantId } : {}),
  };
}

function readEchoMarkdown(mindRoot: string, filePath: string): string | null {
  try {
    const abs = resolveSafe(mindRoot, filePath);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return fs.readFileSync(abs, 'utf-8');
  } catch {
    return null;
  }
}

function normalizeEchoItemPath(segment: EchoStoredSegment, itemPath: string): string | null {
  const normalized = path.posix.normalize(itemPath.replace(/\\/g, '/').replace(/^\/+/, ''));
  const root = `${segmentRoot(segment)}/`;
  if (!normalized.startsWith(root)) return null;
  if (!normalized.endsWith('.md')) return null;
  if (normalized.endsWith('/README.md') || normalized.endsWith('/INSTRUCTION.md')) return null;
  return normalized;
}

function writeEchoIndex(mindRoot: string, index: EchoIndex): void {
  writeJson(mindRoot, ECHO_INDEX_PATH, index);
}

function appendEchoEvent(mindRoot: string, event: Record<string, unknown>): void {
  const at = typeof event.at === 'string' ? new Date(event.at) : new Date();
  const { year, month } = dateParts(Number.isNaN(at.getTime()) ? new Date() : at);
  const filePath = `${ECHO_EVENTS_DIR}/${year}-${month}.jsonl`;
  const abs = resolveSafe(mindRoot, filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, `${JSON.stringify(event)}\n`, 'utf-8');
}

function uniqueEchoPath(mindRoot: string, segment: EchoStoredSegment, title: string, now: Date): string {
  const { year, month, date } = dateParts(now);
  const dir = segment === 'imprint'
    ? `${segmentRoot(segment)}/${year}/${month}`
    : segmentRoot(segment);
  const base = segment === 'imprint'
    ? date
    : slugifyTitle(title) || `${DRAFT_KEY[segment]}-${date}`;

  for (let index = 1; index < 1000; index += 1) {
    const suffix = index === 1 ? '' : `-${index}`;
    const candidate = `${dir}/${base}${suffix}.md`;
    if (!fs.existsSync(resolveSafe(mindRoot, candidate))) return candidate;
  }

  return `${dir}/${base}-${Date.now().toString(36)}.md`;
}

function segmentRoot(segment: EchoStoredSegment): string {
  return `${ECHO_SPACE_DIR}/${SEGMENT_DIR[segment]}`;
}

function formatEchoMarkdown({
  segment,
  title,
  markdown,
  assistantId,
  now,
}: {
  segment: EchoStoredSegment;
  title: string;
  markdown: string;
  assistantId?: string;
  now: Date;
}): string {
  const body = normalizeMarkdownBody(markdown);
  return [
    '---',
    `type: ${SEGMENT_TYPE[segment]}`,
    `title: ${quoteYaml(title)}`,
    `date: ${dateParts(now).date}`,
    'source: assistant',
    ...(assistantId ? [`assistantId: ${quoteYaml(assistantId)}`] : []),
    'status: active',
    '---',
    '',
    body,
    '',
  ].join('\n');
}

function normalizeMarkdownBody(markdown: string): string {
  return stripFrontmatter(markdown).trim();
}

function excerptFromMarkdown(markdown: string): string {
  const body = normalizeMarkdownBody(markdown)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[>\s*-]+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return body.slice(0, 180);
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function extractEchoTitle(markdown: string, fallback: string | undefined, segment: EchoStoredSegment): string {
  const title = firstMarkdownHeading(markdown) || fallback?.trim() || DEFAULT_TITLE[segment];
  return title.replace(/\s+/g, ' ').trim().slice(0, 120) || DEFAULT_TITLE[segment];
}

function firstMarkdownHeading(markdown: string): string | null {
  const body = stripFrontmatter(markdown);
  const heading = body.split(/\r?\n/).find((line) => /^#\s+/.test(line.trim()));
  return heading ? heading.replace(/^#\s+/, '').trim() : null;
}

function parseFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const raw = line.slice(colon + 1).trim();
    if (!key) continue;
    meta[key] = unquoteYaml(raw);
  }
  return meta;
}

function slugifyTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
    .replace(/-+$/g, '');
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

function unquoteYaml(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function dateParts(date: Date): { year: string; month: string; date: string } {
  const iso = date.toISOString();
  return {
    year: iso.slice(0, 4),
    month: iso.slice(5, 7),
    date: iso.slice(0, 10),
  };
}

function writeJson(mindRoot: string, relativePath: string, value: unknown): void {
  writeText(mindRoot, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTextIfMissing(mindRoot: string, relativePath: string, content: string): void {
  const abs = resolveSafe(mindRoot, relativePath);
  if (fs.existsSync(abs)) return;
  writeText(mindRoot, relativePath, content);
}

function writeTextExclusive(mindRoot: string, relativePath: string, content: string): void {
  const abs = resolveSafe(mindRoot, relativePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, { encoding: 'utf-8', flag: 'wx' });
}

function writeText(mindRoot: string, relativePath: string, content: string): void {
  const abs = resolveSafe(mindRoot, relativePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function walk(dir: string, visitFile: (absPath: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absPath, visitFile);
    } else if (entry.isFile()) {
      visitFile(absPath);
    }
  }
}

function toRelativeMindPath(mindRoot: string, absPath: string): string {
  return path.relative(path.resolve(mindRoot), absPath).split(path.sep).join('/');
}
