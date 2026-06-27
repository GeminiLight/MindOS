import path from 'path';
import { normalizeObsidianTag, parseFrontMatterTagValues } from './shims/tags';
import type {
  CachedMetadata,
  HeadingCache,
  IMetadataCache,
  IVault,
  LinkCache,
  Pos,
  TFile,
} from './types';

export const OBSIDIAN_NATIVE_QUERY_INDEX_PROOF_SUMMARY = [
  'MindOS native query index can read public Markdown notes, YAML frontmatter,',
  'Obsidian tags, links, headings, and read-only task records for limited',
  'Dataview/Tasks-style query proofs.',
].join(' ');

export interface BuildObsidianNativeQueryIndexInput {
  vault: IVault;
  metadataCache: IMetadataCache;
}

export interface ObsidianNativeQueryHeadingRecord {
  heading: string;
  level: number;
  line: number;
}

export interface ObsidianNativeQueryLinkRecord {
  link: string;
  original: string;
  displayText?: string;
  line: number;
}

export interface ObsidianNativeQueryTaskRecord {
  path: string;
  basename: string;
  line: number;
  status: string;
  completed: boolean;
  text: string;
  rawText: string;
  blockId?: string;
  tags: string[];
  noteTags: string[];
  effectiveTags: string[];
  frontmatter?: Record<string, unknown>;
  position: Pos;
}

export interface ObsidianNativeQueryNoteRecord {
  path: string;
  basename: string;
  name: string;
  frontmatter?: Record<string, unknown>;
  frontmatterTags: string[];
  bodyTags: string[];
  tags: string[];
  links: ObsidianNativeQueryLinkRecord[];
  embeds: ObsidianNativeQueryLinkRecord[];
  headings: ObsidianNativeQueryHeadingRecord[];
  tasks: ObsidianNativeQueryTaskRecord[];
}

export interface ObsidianNativeQueryIndex {
  schemaVersion: 1;
  notes: ObsidianNativeQueryNoteRecord[];
  tasks: ObsidianNativeQueryTaskRecord[];
  stats: {
    noteCount: number;
    taskCount: number;
    completedTaskCount: number;
    incompleteTaskCount: number;
  };
  proof: {
    status: 'native-replacement';
    summary: string;
    supportedSubset: string[];
    limitations: string[];
  };
}

export interface ObsidianNativeQueryNoteFilter {
  pathPrefix?: string;
  tag?: string;
  tags?: string[];
  frontmatter?: Record<string, unknown>;
}

export interface ObsidianNativeQueryTaskFilter extends ObsidianNativeQueryNoteFilter {
  completed?: boolean;
  textIncludes?: string;
}

const TASK_LINE_RE = /^(\s*)([-*+]|\d+[.)])\s+\[([^\]])\]\s+(.+)$/;
const TRAILING_BLOCK_ID_RE = /\s\^([A-Za-z0-9_-]+)\s*$/;
const TAG_RE = /(^|\s)(#([\p{L}\p{N}_/-]+))/gu;

export async function buildObsidianNativeQueryIndex(
  input: BuildObsidianNativeQueryIndexInput,
): Promise<ObsidianNativeQueryIndex> {
  const notes: ObsidianNativeQueryNoteRecord[] = [];

  for (const file of input.vault.getMarkdownFiles().sort(compareFilesByPath)) {
    const cache = input.metadataCache.getFileCache(file);
    if (!cache) continue;

    const content = await input.vault.cachedRead(file);
    const note = buildNoteRecord(file, cache, content);
    notes.push(note);
  }

  const tasks = notes
    .flatMap((note) => note.tasks)
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  const completedTaskCount = tasks.filter((task) => task.completed).length;

  return {
    schemaVersion: 1,
    notes,
    tasks,
    stats: {
      noteCount: notes.length,
      taskCount: tasks.length,
      completedTaskCount,
      incompleteTaskCount: tasks.length - completedTaskCount,
    },
    proof: {
      status: 'native-replacement',
      summary: OBSIDIAN_NATIVE_QUERY_INDEX_PROOF_SUMMARY,
      supportedSubset: [
        'List Markdown notes by path, tag, and exact frontmatter values.',
        'List read-only Markdown task items by completion state, tag, path, and text.',
        'Expose parsed headings, links, embeds, and task line positions from the MindOS metadata cache.',
      ],
      limitations: [
        'Does not execute official Dataview or Tasks plugin runtime code.',
        'Does not parse full Dataview DQL or DataviewJS.',
        'Does not implement Tasks recurrence, priority, due/scheduled parsing, or task mutation semantics.',
        'Does not grant CodeMirror, DOM, network, native, or private vault permissions.',
      ],
    },
  };
}

export function queryObsidianNativeNotes(
  index: ObsidianNativeQueryIndex,
  filter: ObsidianNativeQueryNoteFilter = {},
): ObsidianNativeQueryNoteRecord[] {
  return index.notes.filter((note) => matchesNoteFilter(note, filter));
}

export function queryObsidianNativeTasks(
  index: ObsidianNativeQueryIndex,
  filter: ObsidianNativeQueryTaskFilter = {},
): ObsidianNativeQueryTaskRecord[] {
  const textNeedle = filter.textIncludes?.trim().toLowerCase();
  return index.tasks.filter((task) => {
    if (filter.completed !== undefined && task.completed !== filter.completed) return false;
    if (textNeedle && !task.text.toLowerCase().includes(textNeedle)) return false;
    return matchesTaskNoteFilter(task, filter);
  });
}

function buildNoteRecord(file: TFile, cache: CachedMetadata, content: string): ObsidianNativeQueryNoteRecord {
  const taskLines = new Set(
    (cache.listItems ?? [])
      .filter((item) => item.task !== undefined)
      .map((item) => item.position.start.line),
  );
  const frontmatterTags = uniqueTags(parseFrontMatterTagValues(cache.frontmatter) ?? []);
  const bodyTags = uniqueTags(cache.tags?.map((tag) => tag.tag) ?? []);
  const tags = uniqueTags([...frontmatterTags, ...bodyTags]);
  const taskContextTags = uniqueTags([
    ...frontmatterTags,
    ...(cache.tags ?? [])
      .filter((tag) => !taskLines.has(tag.position.start.line))
      .map((tag) => tag.tag),
  ]);
  const lineTexts = content.split(/\r?\n/);

  return {
    path: file.path,
    basename: file.basename,
    name: file.name,
    ...(cache.frontmatter ? { frontmatter: cache.frontmatter } : {}),
    frontmatterTags,
    bodyTags,
    tags,
    links: linkRecords(cache.links ?? []),
    embeds: linkRecords(cache.embeds ?? []),
    headings: headingRecords(cache.headings ?? []),
    tasks: taskRecords(file, cache, lineTexts, taskContextTags),
  };
}

function headingRecords(headings: HeadingCache[]): ObsidianNativeQueryHeadingRecord[] {
  return headings.map((heading) => ({
    heading: heading.heading,
    level: heading.level,
    line: heading.position.start.line,
  }));
}

function linkRecords(links: LinkCache[]): ObsidianNativeQueryLinkRecord[] {
  return links.map((link) => ({
    link: link.link,
    original: link.original,
    ...(link.displayText ? { displayText: link.displayText } : {}),
    line: link.position.start.line,
  }));
}

function taskRecords(
  file: TFile,
  cache: CachedMetadata,
  lineTexts: string[],
  taskContextTags: string[],
): ObsidianNativeQueryTaskRecord[] {
  return (cache.listItems ?? [])
    .filter((item) => item.task !== undefined)
    .map((item) => {
      const lineText = lineTexts[item.position.start.line] ?? '';
      const match = lineText.match(TASK_LINE_RE);
      const rawText = match?.[4]?.trim() ?? '';
      const text = rawText.replace(TRAILING_BLOCK_ID_RE, '').trim();
      const tags = uniqueTags(extractTags(text));
      const status = String(item.task ?? '');

      return {
        path: file.path,
        basename: file.basename,
        line: item.position.start.line,
        status,
        completed: status.toLowerCase() === 'x',
        text,
        rawText,
        ...(item.id ? { blockId: item.id } : {}),
        tags,
        noteTags: taskContextTags,
        effectiveTags: uniqueTags([...taskContextTags, ...tags]),
        ...(cache.frontmatter ? { frontmatter: cache.frontmatter } : {}),
        position: item.position,
      };
    });
}

function matchesNoteFilter(
  note: ObsidianNativeQueryNoteRecord,
  filter: ObsidianNativeQueryNoteFilter,
): boolean {
  if (filter.pathPrefix && !note.path.startsWith(filter.pathPrefix)) return false;
  if (!tagsMatch(note.tags, filter)) return false;
  if (!frontmatterMatches(note.frontmatter, filter.frontmatter)) return false;
  return true;
}

function matchesTaskNoteFilter(
  task: ObsidianNativeQueryTaskRecord,
  filter: ObsidianNativeQueryTaskFilter,
): boolean {
  if (filter.pathPrefix && !task.path.startsWith(filter.pathPrefix)) return false;
  if (!tagsMatch(task.effectiveTags, filter)) return false;
  if (!frontmatterMatches(task.frontmatter, filter.frontmatter)) return false;
  return true;
}

function tagsMatch(tags: string[], filter: ObsidianNativeQueryNoteFilter): boolean {
  const requiredTags = uniqueTags([
    ...(filter.tag ? [filter.tag] : []),
    ...(filter.tags ?? []),
  ]);
  return requiredTags.every((tag) => tags.includes(tag));
}

function frontmatterMatches(
  frontmatter: Record<string, unknown> | undefined,
  expected: Record<string, unknown> | undefined,
): boolean {
  if (!expected || Object.keys(expected).length === 0) return true;
  if (!frontmatter) return false;
  return Object.entries(expected).every(([key, expectedValue]) => (
    frontmatterValueMatches(frontmatter[key], expectedValue)
  ));
}

function frontmatterValueMatches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && expected.every((expectedItem) => actual.some((actualItem) => actualItem === expectedItem));
  }
  if (Array.isArray(actual)) {
    return actual.some((actualItem) => actualItem === expected);
  }
  return actual === expected;
}

function extractTags(text: string): string[] {
  const tags: string[] = [];
  for (const match of text.matchAll(TAG_RE)) {
    if (match[2]) tags.push(match[2]);
  }
  return tags;
}

function uniqueTags(values: string[]): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeObsidianTag(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    tags.push(normalized);
  }
  return tags;
}

function compareFilesByPath(a: TFile, b: TFile): number {
  return normalizeSortPath(a.path).localeCompare(normalizeSortPath(b.path));
}

function normalizeSortPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}
