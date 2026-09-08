import { extname, posix } from 'node:path';
import { collectAllFilesFromMindRoot, readTextFileFromMindRoot } from './runtime.js';

/**
 * Cached link scan for the standalone graph/backlinks handlers. Scanning reads
 * every markdown file in the library; before this cache the Backlinks panel
 * triggered a full re-read on every file open. The snapshot is keyed by the
 * services' `getTreeVersion` function and rebuilt lazily whenever the reported
 * tree version changes (the tree cache bumps it on writes / watcher events).
 */

export type LinkKind = 'wiki' | 'markdown';

export type LinkResolution = 'resolved' | 'unresolved' | 'ambiguous';

export type LinkTargetSubpath = {
  type: 'heading' | 'block';
  value: string;
};

export type LinkHit = {
  source: string;
  target: string;
  snippet: string;
  kind: LinkKind;
  rawTarget: string;
  resolution: LinkResolution;
  displayText?: string;
  targetSubpath?: LinkTargetSubpath;
  line: number;
  column: number;
  candidates?: string[];
};

export type LinkAggregateKind = LinkKind | 'mixed';

export type LinkEdgeAggregate = {
  source: string;
  target: string;
  kind: LinkAggregateKind;
  count: number;
  snippets: string[];
  unresolved: boolean;
  ambiguous: boolean;
  candidates: string[];
  subpaths: LinkTargetSubpath[];
};

export type FileLinkMetadata = {
  title: string;
  tags: string[];
  wordCount: number;
};

export type LinkScanServices = {
  mindRoot?: string;
  collectAllFiles?: () => string[];
  readTextFile?: (path: string) => string;
  /** Optional cheap change signal; when present, link scans are cached per version. */
  getTreeVersion?: () => number;
  /** Optional per-file stats; when present, only changed files are re-read on rebuild. */
  collectFileStats?: () => Array<{ path: string; mtime: number; size: number }>;
};

export type LinkSnapshot = {
  /** Normalized markdown file paths, sorted. */
  files: string[];
  /** Lightweight metadata extracted during the same file scan. */
  fileMetadata: Map<string, FileLinkMetadata>;
  /** Every note-link occurrence with its source line snippet. */
  hits: LinkHit[];
  /** Aggregated source -> target note-link edges, cached per tree version. */
  edgeAggregates: LinkEdgeAggregate[];
  /** Outgoing edge lookup for local graph traversal. */
  outgoingEdgesBySource: Map<string, LinkEdgeAggregate[]>;
  /** Incoming edge lookup for local graph traversal. */
  incomingEdgesByTarget: Map<string, LinkEdgeAggregate[]>;
  /** All markdown files plus unresolved/ambiguous graph targets. */
  nodeIds: Set<string>;
  /** Backlink lookup table: target -> source -> unique snippets. */
  backlinksByTarget: Map<string, Map<string, Set<string>>>;
};

type FileScan = { mtime: number; size: number; metadata: FileLinkMetadata; hits: LinkHit[] };

type CachedSnapshot = LinkSnapshot & { version: number; fileScans: Map<string, FileScan> };

// Keyed by the getTreeVersion function: stable for a long-lived services object
// (standalone server), naturally absent for ad-hoc services (tests, callers
// that build a fresh services literal per request stay uncached unless they
// pass a stable version function).
const snapshotCache = new WeakMap<() => number, CachedSnapshot>();

export function getLinkSnapshot(services: LinkScanServices): LinkSnapshot {
  const versionFn = services.getTreeVersion;
  if (!versionFn) return buildLinkSnapshot(services);

  let version: number;
  try {
    version = versionFn();
  } catch {
    return buildLinkSnapshot(services);
  }

  const cached = snapshotCache.get(versionFn);
  if (cached && cached.version === version) return cached;

  const snapshot: CachedSnapshot = { version, ...buildLinkSnapshotIncremental(services, cached) };
  snapshotCache.set(versionFn, snapshot);
  return snapshot;
}

export function buildLinkSnapshot(services: LinkScanServices): LinkSnapshot {
  return buildLinkSnapshotIncremental(services, undefined);
}

/**
 * Rebuilds the snapshot, reusing the per-file scan of every markdown file
 * whose mtime/size is unchanged. Link resolution depends on which files exist
 * (basename matching), so reuse is only attempted when the file list itself is
 * identical; adds, deletes and renames still trigger a full rescan. A single
 * "save then open the next note" used to re-read the whole library.
 */
function buildLinkSnapshotIncremental(
  services: LinkScanServices,
  previous: CachedSnapshot | undefined,
): LinkSnapshot & { fileScans: Map<string, FileScan> } {
  const files = collectMarkdownFiles(services);
  const fileSet = new Set(files);
  const basenameMap = buildBasenameMap(files);
  const fileMetadata = new Map<string, FileLinkMetadata>();
  const hits: LinkHit[] = [];
  const backlinksByTarget = new Map<string, Map<string, Set<string>>>();
  const fileScans = new Map<string, FileScan>();

  const statsByPath = collectStatsByPath(services);
  const reusable = previous && statsByPath && sameFileList(previous.files, files) ? previous.fileScans : null;

  for (const source of files) {
    const stat = statsByPath?.get(source);
    const prior = reusable?.get(source);
    let scan: FileScan;
    if (prior && stat && prior.mtime === stat.mtime && prior.size === stat.size) {
      scan = prior;
    } else {
      let content = '';
      try {
        content = readText(services, source);
      } catch {
        // File deleted (or unreadable) between listing and reading — skip it.
        continue;
      }
      scan = {
        mtime: stat?.mtime ?? Number.NaN,
        size: stat?.size ?? Number.NaN,
        metadata: extractFileMetadata(content, source),
        hits: extractLinkHits(content, source, fileSet, basenameMap),
      };
    }
    fileScans.set(source, scan);
    fileMetadata.set(source, scan.metadata);
    for (const hit of scan.hits) {
      hits.push(hit);
      let sources = backlinksByTarget.get(hit.target);
      if (!sources) {
        sources = new Map();
        backlinksByTarget.set(hit.target, sources);
      }
      let snippets = sources.get(hit.source);
      if (!snippets) {
        snippets = new Set();
        sources.set(hit.source, snippets);
      }
      snippets.add(hit.snippet);
    }
  }

  const {
    edgeAggregates,
    outgoingEdgesBySource,
    incomingEdgesByTarget,
    nodeIds,
  } = buildEdgeIndexes(files, hits);

  return {
    files,
    fileMetadata,
    hits,
    edgeAggregates,
    outgoingEdgesBySource,
    incomingEdgesByTarget,
    nodeIds,
    backlinksByTarget,
    fileScans,
  };
}

function collectStatsByPath(services: LinkScanServices): Map<string, { mtime: number; size: number }> | null {
  if (!services.collectFileStats) return null;
  try {
    const map = new Map<string, { mtime: number; size: number }>();
    for (const entry of services.collectFileStats()) {
      const normalized = normalizeTargetPath(entry.path);
      if (normalized) map.set(normalized, { mtime: entry.mtime, size: entry.size });
    }
    return map;
  } catch {
    return null;
  }
}

function sameFileList(previous: string[], current: string[]): boolean {
  if (previous.length !== current.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== current[index]) return false;
  }
  return true;
}

export function normalizeTargetPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let normalized = value.trim();
  if (!normalized) return undefined;

  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep the original value if it is not a valid URI component.
  }

  normalized = normalized.split('#')[0]?.trim() ?? '';
  normalized = normalized.replace(/\\/g, '/').replace(/^\/+/, '');
  normalized = posix.normalize(normalized);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..') return undefined;
  return normalized;
}

function collectMarkdownFiles(services: LinkScanServices): string[] {
  const files = services.collectAllFiles
    ? services.collectAllFiles()
    : services.mindRoot
      ? collectAllFilesFromMindRoot(services.mindRoot)
      : [];
  return files
    .filter((filePath) => extname(filePath).toLowerCase() === '.md')
    .map(normalizeTargetPath)
    .filter((filePath): filePath is string => !!filePath)
    .sort((a, b) => a.localeCompare(b));
}

function readText(services: LinkScanServices, filePath: string): string {
  if (services.readTextFile) return services.readTextFile(filePath);
  if (services.mindRoot) return readTextFileFromMindRoot(services.mindRoot, filePath);
  throw new Error('readTextFile service required');
}

function buildBasenameMap(files: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const filePath of files) {
    const key = posix.basename(filePath).toLowerCase();
    const values = map.get(key) ?? [];
    values.push(filePath);
    map.set(key, values);
  }
  return map;
}

function extractLinkHits(
  content: string,
  source: string,
  fileSet: Set<string>,
  basenameMap: Map<string, string[]>,
): LinkHit[] {
  const hits: LinkHit[] = [];
  const sourceDir = posix.dirname(source);
  const lines = collectScannableLines(content);

  for (const line of lines) {
    const snippet = line.original.trim();
    if (!snippet) continue;

    const wikiRe = /!?\[\[([^\]\n]+)\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = wikiRe.exec(line.text)) !== null) {
      const parsed = parseWikiTarget(match[1]);
      const target = parsed.targetText
        ? resolveLinkTarget(parsed.targetText, sourceDir, fileSet, basenameMap, false, 'wiki')
        : { target: source, resolution: 'resolved' as const };
      if (target) {
        hits.push({
          source,
          snippet,
          kind: 'wiki',
          rawTarget: parsed.targetText,
          displayText: parsed.displayText,
          targetSubpath: parsed.subpath,
          line: line.number,
          column: match.index + 1,
          ...target,
        });
      }
    }

    const markdownRe = /!?\[([^\]\n]*)\]\(([^)\n]+)\)/g;
    while ((match = markdownRe.exec(line.text)) !== null) {
      if (match[0].startsWith('!')) continue;
      const parsed = parseMarkdownTarget(match[1], match[2]);
      const target = resolveLinkTarget(parsed.targetText, sourceDir, fileSet, basenameMap, true, 'markdown');
      if (target) {
        hits.push({
          source,
          snippet,
          kind: 'markdown',
          rawTarget: parsed.targetText,
          displayText: parsed.displayText,
          targetSubpath: parsed.subpath,
          line: line.number,
          column: match.index + 1,
          ...target,
        });
      }
    }
  }

  return hits;
}

type ScannableLine = {
  original: string;
  text: string;
  number: number;
};

function collectScannableLines(content: string): ScannableLine[] {
  const rawLines = content.split(/\r?\n/);
  const lines: ScannableLine[] = [];
  let inFrontmatter = rawLines[0]?.trim() === '---';
  let inFence = false;
  let fenceChar: '`' | '~' | null = null;
  let fenceLength = 0;

  for (let index = 0; index < rawLines.length; index += 1) {
    const original = rawLines[index] ?? '';
    const trimmed = original.trim();

    if (inFrontmatter) {
      if (index > 0 && trimmed === '---') inFrontmatter = false;
      continue;
    }

    const fenceMatch = original.match(/^\s*(`{3,}|~{3,})/);
    if (inFence) {
      if (fenceMatch && fenceChar && fenceMatch[1]?.startsWith(fenceChar) && fenceMatch[1].length >= fenceLength) {
        inFence = false;
        fenceChar = null;
        fenceLength = 0;
      }
      continue;
    }
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? '';
      fenceChar = marker[0] as '`' | '~';
      fenceLength = marker.length;
      inFence = true;
      continue;
    }

    lines.push({
      original,
      text: maskInlineCode(original),
      number: index + 1,
    });
  }

  return lines;
}

function maskInlineCode(line: string): string {
  return line.replace(/`+[^`]*?`+/g, (match) => ' '.repeat(match.length));
}

type ParsedTarget = {
  targetText: string;
  displayText?: string;
  subpath?: LinkTargetSubpath;
};

function parseWikiTarget(raw: string | undefined): ParsedTarget {
  const value = raw?.trim() ?? '';
  const [targetAndSubpath = '', alias] = value.split('|');
  const { targetText, subpath } = splitSubpath(targetAndSubpath.trim());
  return {
    targetText,
    displayText: alias?.trim() || undefined,
    subpath,
  };
}

function parseMarkdownTarget(label: string | undefined, rawDestination: string | undefined): ParsedTarget {
  let destination = rawDestination?.trim() ?? '';
  const bracketed = destination.match(/^<([^>]+)>$/)?.[1];
  if (bracketed) destination = bracketed.trim();
  destination = destination.replace(/\s+["'][^"']*["']\s*$/, '').trim();

  const { targetText, subpath } = splitSubpath(destination);
  return {
    targetText,
    displayText: label?.trim() || undefined,
    subpath,
  };
}

function splitSubpath(value: string): { targetText: string; subpath?: LinkTargetSubpath } {
  const hashIndex = value.indexOf('#');
  if (hashIndex === -1) return { targetText: value.trim() };

  const targetText = value.slice(0, hashIndex).trim();
  const rawSubpath = value.slice(hashIndex + 1).trim();
  if (!rawSubpath) return { targetText };

  if (rawSubpath.startsWith('^')) {
    const block = rawSubpath.slice(1).trim();
    return block ? { targetText, subpath: { type: 'block', value: block } } : { targetText };
  }

  return { targetText, subpath: { type: 'heading', value: rawSubpath } };
}

type ResolvedLinkTarget = {
  target: string;
  resolution: LinkResolution;
  candidates?: string[];
};

function resolveLinkTarget(
  rawTarget: string | undefined,
  sourceDir: string,
  fileSet: Set<string>,
  basenameMap: Map<string, string[]>,
  relativeToSource: boolean,
  kind: LinkKind,
): ResolvedLinkTarget | undefined {
  const target = normalizeTargetPath(rawTarget);
  if (!target || /^(https?:|mailto:|tel:)/i.test(target)) return undefined;

  const targetExt = extname(target).toLowerCase();
  if (kind === 'markdown' && targetExt && targetExt !== '.md') return undefined;

  const candidates = new Set<string>();
  candidates.add(target);
  candidates.add(target.endsWith('.md') ? target : `${target}.md`);

  if (relativeToSource) {
    candidates.add(posix.normalize(posix.join(sourceDir, target)));
    candidates.add(posix.normalize(posix.join(sourceDir, target.endsWith('.md') ? target : `${target}.md`)));
  }

  for (const candidate of candidates) {
    if (fileSet.has(candidate)) return { target: candidate, resolution: 'resolved' };
  }

  const basename = posix.basename(target.endsWith('.md') ? target : `${target}.md`).toLowerCase();
  const basenameMatches = basenameMap.get(basename);
  if (basenameMatches?.length === 1) {
    const match = basenameMatches[0];
    if (match) return { target: match, resolution: 'resolved' };
  }
  if (basenameMatches && basenameMatches.length > 1) {
    return {
      target: toProbableMarkdownTarget(target, sourceDir, relativeToSource),
      resolution: 'ambiguous',
      candidates: [...basenameMatches].sort((a, b) => a.localeCompare(b)),
    };
  }

  return { target: toProbableMarkdownTarget(target, sourceDir, relativeToSource), resolution: 'unresolved' };
}

function buildEdgeIndexes(files: string[], hits: LinkHit[]): {
  edgeAggregates: LinkEdgeAggregate[];
  outgoingEdgesBySource: Map<string, LinkEdgeAggregate[]>;
  incomingEdgesByTarget: Map<string, LinkEdgeAggregate[]>;
  nodeIds: Set<string>;
} {
  const edgeMap = new Map<string, LinkEdgeAggregate>();
  const nodeIds = new Set(files);

  for (const hit of hits) {
    nodeIds.add(hit.source);
    nodeIds.add(hit.target);
    const key = `${hit.source}\0${hit.target}`;
    const existing = edgeMap.get(key);
    if (!existing) {
      edgeMap.set(key, {
        source: hit.source,
        target: hit.target,
        kind: hit.kind,
        count: 1,
        snippets: hit.snippet ? [hit.snippet] : [],
        unresolved: hit.resolution === 'unresolved',
        ambiguous: hit.resolution === 'ambiguous',
        candidates: hit.candidates ? [...hit.candidates] : [],
        subpaths: hit.targetSubpath ? [hit.targetSubpath] : [],
      });
      continue;
    }

    existing.count += 1;
    if (existing.kind !== hit.kind) existing.kind = 'mixed';
    if (hit.snippet && !existing.snippets.includes(hit.snippet) && existing.snippets.length < 3) {
      existing.snippets.push(hit.snippet);
    }
    existing.unresolved ||= hit.resolution === 'unresolved';
    existing.ambiguous ||= hit.resolution === 'ambiguous';
    if (hit.candidates) {
      for (const candidate of hit.candidates) {
        if (!existing.candidates.includes(candidate)) existing.candidates.push(candidate);
      }
      existing.candidates.sort((a, b) => a.localeCompare(b));
    }
    if (hit.targetSubpath && !existing.subpaths.some((subpath) => (
      subpath.type === hit.targetSubpath?.type && subpath.value === hit.targetSubpath.value
    ))) {
      existing.subpaths.push(hit.targetSubpath);
    }
  }

  const edgeAggregates = [...edgeMap.values()]
    .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.kind.localeCompare(b.kind));
  const outgoingEdgesBySource = new Map<string, LinkEdgeAggregate[]>();
  const incomingEdgesByTarget = new Map<string, LinkEdgeAggregate[]>();

  for (const edge of edgeAggregates) {
    addEdgeIndex(outgoingEdgesBySource, edge.source, edge);
    addEdgeIndex(incomingEdgesByTarget, edge.target, edge);
  }

  return { edgeAggregates, outgoingEdgesBySource, incomingEdgesByTarget, nodeIds };
}

function addEdgeIndex(
  index: Map<string, LinkEdgeAggregate[]>,
  key: string,
  edge: LinkEdgeAggregate,
): void {
  const values = index.get(key) ?? [];
  values.push(edge);
  index.set(key, values);
}

function toProbableMarkdownTarget(target: string, sourceDir: string, relativeToSource: boolean): string {
  const withMarkdownExtension = target.endsWith('.md') ? target : `${target}.md`;
  return relativeToSource ? posix.normalize(posix.join(sourceDir, withMarkdownExtension)) : withMarkdownExtension;
}

function extractFileMetadata(content: string, filePath: string): FileLinkMetadata {
  const title = extractTitle(content) ?? posix.basename(filePath, '.md');
  return {
    title,
    tags: extractTags(content),
    wordCount: countWords(content),
  };
}

function extractTitle(content: string): string | undefined {
  const heading = content.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  return heading || undefined;
}

function extractTags(content: string): string[] {
  const tags = new Set<string>();
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontmatterBody = frontmatter?.[1] ?? '';
  const inlineTags = frontmatterBody.match(/^tags:\s*\[([^\]]*)\]\s*$/m)?.[1];
  if (inlineTags) {
    for (const value of inlineTags.split(',')) addTag(tags, value);
  }

  const tagList = frontmatterBody.match(/^tags:\s*\r?\n((?:\s*-\s*.+\r?\n?)+)/m)?.[1];
  if (tagList) {
    for (const line of tagList.split(/\r?\n/)) addTag(tags, line.replace(/^\s*-\s*/, ''));
  }

  if (!inlineTags && !tagList) {
    const singleTag = frontmatterBody.match(/^tags:\s*([^\r\n]+)$/m)?.[1];
    if (singleTag) addTag(tags, singleTag);
  }

  const scannableContent = collectScannableLines(content).map((line) => line.text).join('\n');
  const inlineTagRe = /(^|\s)#([\p{L}\p{N}_/-]+)/gu;
  let match: RegExpExecArray | null;
  while ((match = inlineTagRe.exec(scannableContent)) !== null) addTag(tags, match[2]);

  return [...tags].sort((a, b) => a.localeCompare(b));
}

function addTag(tags: Set<string>, value: string | undefined): void {
  const normalized = value?.trim().replace(/^#/, '').replace(/^['"]|['"]$/g, '');
  if (normalized) tags.add(normalized);
}

function countWords(content: string): number {
  const tokens = content
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .match(/[\p{L}\p{N}_-]+/gu);
  return tokens?.length ?? 0;
}
