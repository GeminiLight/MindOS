import { extname, posix } from 'node:path';
import { collectAllFilesFromMindRoot, readTextFileFromMindRoot } from './runtime.js';

/**
 * Cached link scan for the standalone graph/backlinks handlers. Scanning reads
 * every markdown file in the library; before this cache the Backlinks panel
 * triggered a full re-read on every file open. The snapshot is keyed by the
 * services' `getTreeVersion` function and rebuilt lazily whenever the reported
 * tree version changes (the tree cache bumps it on writes / watcher events).
 */

export type LinkHit = {
  source: string;
  target: string;
  snippet: string;
};

export type LinkScanServices = {
  mindRoot?: string;
  collectAllFiles?: () => string[];
  readTextFile?: (path: string) => string;
  /** Optional cheap change signal; when present, link scans are cached per version. */
  getTreeVersion?: () => number;
};

export type LinkSnapshot = {
  /** Normalized markdown file paths, sorted. */
  files: string[];
  /** Every resolved link occurrence with its source line snippet. */
  hits: LinkHit[];
};

type CachedSnapshot = LinkSnapshot & { version: number };

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

  const snapshot: CachedSnapshot = { version, ...buildLinkSnapshot(services) };
  snapshotCache.set(versionFn, snapshot);
  return snapshot;
}

export function buildLinkSnapshot(services: LinkScanServices): LinkSnapshot {
  const files = collectMarkdownFiles(services);
  const fileSet = new Set(files);
  const basenameMap = buildBasenameMap(files);
  const hits: LinkHit[] = [];

  for (const source of files) {
    let content = '';
    try {
      content = readText(services, source);
    } catch {
      // File deleted (or unreadable) between listing and reading — skip it.
      continue;
    }
    hits.push(...extractLinkHits(content, source, fileSet, basenameMap));
  }

  return { files, hits };
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
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const snippet = line.trim();
    if (!snippet) continue;

    const wikiRe = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = wikiRe.exec(line)) !== null) {
      const target = resolveLinkTarget(match[1], sourceDir, fileSet, basenameMap, false);
      if (target) hits.push({ source, target, snippet });
    }

    const markdownRe = /\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g;
    while ((match = markdownRe.exec(line)) !== null) {
      const target = resolveLinkTarget(match[1], sourceDir, fileSet, basenameMap, true);
      if (target) hits.push({ source, target, snippet });
    }
  }

  return hits;
}

function resolveLinkTarget(
  rawTarget: string | undefined,
  sourceDir: string,
  fileSet: Set<string>,
  basenameMap: Map<string, string[]>,
  relativeToSource: boolean,
): string | undefined {
  const target = normalizeTargetPath(rawTarget);
  if (!target || /^(https?:|mailto:|tel:)/i.test(target)) return undefined;

  const candidates = new Set<string>();
  candidates.add(target);
  candidates.add(target.endsWith('.md') ? target : `${target}.md`);

  if (relativeToSource) {
    candidates.add(posix.normalize(posix.join(sourceDir, target)));
    candidates.add(posix.normalize(posix.join(sourceDir, target.endsWith('.md') ? target : `${target}.md`)));
  }

  for (const candidate of candidates) {
    if (fileSet.has(candidate)) return candidate;
  }

  const basename = posix.basename(target.endsWith('.md') ? target : `${target}.md`).toLowerCase();
  const basenameMatches = basenameMap.get(basename);
  if (basenameMatches?.length === 1) return basenameMatches[0];

  return undefined;
}
