import fs from 'fs';
import path from 'path';
import { collectAllFiles } from './core/tree';
import { readFile } from './core/fs-ops';
import { resolveExistingSafe } from './core/security';
import { extractLinks } from './core/link-index';

// ── Types ──────────────────────────────────────────────────────────

export interface LintStats {
  totalFiles: number;
  orphanFiles: number;
  staleFiles: number;
  emptyFiles: number;
  brokenLinks: number;
}

export interface OrphanEntry {
  path: string;
  lastModified: string;
}

export interface StaleEntry {
  path: string;
  lastModified: string;
  daysSinceUpdate: number;
}

export interface BrokenLinkEntry {
  source: string;
  target: string;
  line: number;
}

export interface LintReport {
  timestamp: string;
  scope: string;
  stats: LintStats;
  healthScore: number;
  orphans: OrphanEntry[];
  stale: StaleEntry[];
  brokenLinks: BrokenLinkEntry[];
  empty: string[];
}

// ── Constants ──────────────────────────────────────────────────────

const ORPHAN_WHITELIST = new Set([
  'INSTRUCTION.md', 'README.md', 'CONFIG.json',
  '_overview.md', 'CHANGELOG.md', 'TODO.md',
]);

const LINT_EXTENSIONS = new Set(['.md', '.csv']);

const EMPTY_THRESHOLD = 50;

// High proportion of non-printable chars → likely binary embedded in .md
const BINARY_THRESHOLD = 0.1;

// WikiLinks: [[target]] or [[target|alias]] or [[target#section]]
const WIKI_LINK_RE = /\[\[([^\]|#]+)(?:[|#][^\]]*)?/g;
// Markdown links: [text](relative/path.md)
const MD_LINK_RE = /\[[^\]]+\]\(([^)]+\.md)(?:#[^)]*)?\)/g;

// ── Shared per-run context ─────────────────────────────────────────

/**
 * One lint run shares a single recursive walk of mindRoot and reads every
 * file at most once. Each check used to walk (and, for links, re-read) the
 * whole knowledge base independently, so a `/api/lint` request cost five
 * walks plus two full markdown reads.
 */
interface LintContext {
  mindRoot: string;
  /** Every file collectAllFiles() reports for mindRoot (one walk). */
  allFiles: string[];
  /** allFiles narrowed to the requested space, or allFiles when unscoped. */
  scopedFiles: string[];
  /** Read a file at most once; null when it cannot be read. */
  readContent(filePath: string): string | null;
  /** Stat a file at most once; null when it cannot be stat'ed. */
  statOf(filePath: string): fs.Stats | null;
}

function createLintContext(mindRoot: string, space?: string): LintContext {
  const allFiles = collectAllFiles(mindRoot);
  const scopedFiles = filterBySpace(allFiles, space);
  const contents = new Map<string, string | null>();
  const stats = new Map<string, fs.Stats | null>();
  return {
    mindRoot,
    allFiles,
    scopedFiles,
    readContent(filePath) {
      const cached = contents.get(filePath);
      if (cached !== undefined) return cached;
      let content: string | null;
      try { content = readFile(mindRoot, filePath); } catch { content = null; }
      contents.set(filePath, content);
      return content;
    },
    statOf(filePath) {
      const cached = stats.get(filePath);
      if (cached !== undefined) return cached;
      let stat: fs.Stats | null;
      try { stat = fs.statSync(resolveExistingSafe(mindRoot, filePath)); } catch { stat = null; }
      stats.set(filePath, stat);
      return stat;
    },
  };
}

// ── Core Analysis Functions ────────────────────────────────────────

/**
 * Find orphan files — files with zero inbound links.
 * System files (README.md, INSTRUCTION.md, etc.) are excluded.
 */
export function findOrphans(mindRoot: string, space?: string): OrphanEntry[] {
  return collectOrphans(createLintContext(mindRoot, space));
}

/**
 * Find files not modified within the threshold (in days).
 * Only checks .md and .csv files.
 */
export function findStaleFiles(mindRoot: string, thresholdDays: number, space?: string): StaleEntry[] {
  return collectStaleFiles(createLintContext(mindRoot, space), thresholdDays);
}

/**
 * Find broken links — wikilinks or markdown links pointing to non-existent files.
 */
export function findBrokenLinks(mindRoot: string, space?: string): BrokenLinkEntry[] {
  return collectBrokenLinks(createLintContext(mindRoot, space));
}

/**
 * Find files with content shorter than the empty threshold (50 chars).
 * Only checks .md and .csv files.
 */
export function findEmptyFiles(mindRoot: string, space?: string): string[] {
  return collectEmptyFiles(createLintContext(mindRoot, space));
}

/**
 * Compute a health score (0–100) from lint stats.
 *
 * Penalty weights:
 * - orphan: -2 each (cap -30)
 * - stale: -1 each (cap -20)
 * - broken link: -3 each (cap -30)
 * - empty: -1 each (cap -20)
 */
export function computeHealthScore(stats: LintStats): number {
  const orphanPenalty = Math.min(stats.orphanFiles * 2, 30);
  const stalePenalty = Math.min(stats.staleFiles * 1, 20);
  const brokenPenalty = Math.min(stats.brokenLinks * 3, 30);
  const emptyPenalty = Math.min(stats.emptyFiles * 1, 20);

  return Math.max(0, 100 - orphanPenalty - stalePenalty - brokenPenalty - emptyPenalty);
}

// ── Integration ────────────────────────────────────────────────────

/**
 * Run a full lint analysis on the knowledge base.
 * @param mindRoot  Absolute path to the knowledge base root
 * @param space     Optional space name to scope the analysis
 */
export function runLint(mindRoot: string, space?: string): LintReport {
  const ctx = createLintContext(mindRoot, space);
  const orphans = collectOrphans(ctx);
  const stale = collectStaleFiles(ctx, 90);
  const brokenLinks = collectBrokenLinks(ctx);
  const empty = collectEmptyFiles(ctx);

  const stats: LintStats = {
    totalFiles: ctx.scopedFiles.length,
    orphanFiles: orphans.length,
    staleFiles: stale.length,
    emptyFiles: empty.length,
    brokenLinks: brokenLinks.length,
  };

  return {
    timestamp: new Date().toISOString(),
    scope: space ?? 'all',
    stats,
    healthScore: computeHealthScore(stats),
    orphans,
    stale,
    brokenLinks,
    empty,
  };
}

// ── Context-based checks ───────────────────────────────────────────

function collectOrphans(ctx: LintContext): OrphanEntry[] {
  const mdFiles = ctx.scopedFiles.filter(f => f.endsWith('.md'));
  if (mdFiles.length === 0) return [];

  const backlinks = buildBacklinks(ctx);

  const orphans: OrphanEntry[] = [];
  for (const filePath of mdFiles) {
    if (isWhitelisted(filePath)) continue;

    if ((backlinks.get(filePath)?.size ?? 0) === 0) {
      const stat = ctx.statOf(filePath);
      orphans.push({
        path: filePath,
        lastModified: stat ? stat.mtime.toISOString() : new Date().toISOString(),
      });
    }
  }

  return orphans;
}

function collectStaleFiles(ctx: LintContext, thresholdDays: number): StaleEntry[] {
  const lintableFiles = ctx.scopedFiles.filter(f => LINT_EXTENSIONS.has(path.extname(f).toLowerCase()));

  const now = Date.now();
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  const stale: StaleEntry[] = [];

  for (const filePath of lintableFiles) {
    const stat = ctx.statOf(filePath);
    if (!stat) continue;

    const age = now - stat.mtimeMs;
    if (age > thresholdMs) {
      stale.push({
        path: filePath,
        lastModified: stat.mtime.toISOString(),
        daysSinceUpdate: Math.floor(age / (24 * 60 * 60 * 1000)),
      });
    }
  }

  return stale;
}

function collectBrokenLinks(ctx: LintContext): BrokenLinkEntry[] {
  // Link targets may live outside the scoped space, so resolve against all files.
  const fileSet = new Set(ctx.allFiles.filter(f => f.endsWith('.md')));
  const filesToScan = ctx.scopedFiles.filter(f => f.endsWith('.md'));

  const broken: BrokenLinkEntry[] = [];

  for (const filePath of filesToScan) {
    const content = ctx.readContent(filePath);
    if (content === null) continue;

    if (isBinaryContent(content)) continue;

    const lines = content.split('\n');
    const sourceDir = path.dirname(filePath);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check wikilinks
      let m: RegExpExecArray | null;
      WIKI_LINK_RE.lastIndex = 0;
      while ((m = WIKI_LINK_RE.exec(line)) !== null) {
        const raw = m[1].trim();
        if (!raw) continue;
        if (!resolveLink(raw, fileSet)) {
          broken.push({ source: filePath, target: raw, line: i + 1 });
        }
      }

      // Check markdown links
      MD_LINK_RE.lastIndex = 0;
      while ((m = MD_LINK_RE.exec(line)) !== null) {
        const raw = m[1].trim();
        if (!raw || raw.startsWith('http')) continue;
        const resolved = path.normalize(path.join(sourceDir, raw));
        if (!fileSet.has(resolved)) {
          // Try URL-decoded version
          try {
            const decoded = path.normalize(path.join(sourceDir, decodeURIComponent(raw)));
            if (fileSet.has(decoded)) continue;
          } catch { /* malformed URI */ }
          broken.push({ source: filePath, target: raw, line: i + 1 });
        }
      }
    }
  }

  return broken;
}

function collectEmptyFiles(ctx: LintContext): string[] {
  const lintableFiles = ctx.scopedFiles.filter(f => LINT_EXTENSIONS.has(path.extname(f).toLowerCase()));

  const empty: string[] = [];
  for (const filePath of lintableFiles) {
    const content = ctx.readContent(filePath);
    if (content === null) continue;
    if (content.trim().length < EMPTY_THRESHOLD) {
      empty.push(filePath);
    }
  }

  return empty;
}

// ── Helpers ────────────────────────────────────────────────────────

function filterBySpace(all: string[], space?: string): string[] {
  if (!space) return all;
  return all.filter(f => f.startsWith(space + '/') || f.startsWith(space + path.sep));
}

function isWhitelisted(filePath: string): boolean {
  const basename = path.basename(filePath);
  return ORPHAN_WHITELIST.has(basename);
}

/**
 * Try to resolve a wikilink target to an existing file.
 * Returns true if the link resolves.
 */
function resolveLink(raw: string, fileSet: Set<string>): boolean {
  if (fileSet.has(raw)) return true;
  const withMd = raw.endsWith('.md') ? raw : raw + '.md';
  if (fileSet.has(withMd)) return true;

  // Try URL-decoded version (handles %20 → space, etc.)
  try {
    const decoded = decodeURIComponent(withMd);
    if (decoded !== withMd && fileSet.has(decoded)) return true;
  } catch { /* malformed URI — skip */ }

  // Basename match (for short links like [[Identity]])
  const lowerTarget = path.basename(withMd).toLowerCase();
  for (const f of fileSet) {
    if (path.basename(f).toLowerCase() === lowerTarget) return true;
  }

  return false;
}

/**
 * Detect likely binary content embedded in a .md file.
 * Uses the same heuristic as git: any NUL byte → binary.
 * Also checks for high proportion of control chars in a sample.
 */
function isBinaryContent(content: string): boolean {
  if (content.length === 0) return false;
  const sampleSize = Math.min(content.length, 32768);
  let nonPrintable = 0;
  for (let i = 0; i < sampleSize; i++) {
    const code = content.charCodeAt(i);
    if (code === 0) return true;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      nonPrintable++;
    }
  }
  return nonPrintable / sampleSize > BINARY_THRESHOLD;
}

/**
 * Build target → sources backlink sets for every markdown file in the
 * knowledge base, using the same link extraction as the app's LinkIndex
 * (LinkIndex.rebuild would walk mindRoot again and re-read every file).
 */
function buildBacklinks(ctx: LintContext): Map<string, Set<string>> {
  const allMd = ctx.allFiles.filter(f => f.endsWith('.md'));
  const fileSet = new Set(allMd);
  const basenameMap = new Map<string, string[]>();
  for (const f of allMd) {
    const key = path.basename(f).toLowerCase();
    if (!basenameMap.has(key)) basenameMap.set(key, []);
    basenameMap.get(key)!.push(f);
  }

  const backlinks = new Map<string, Set<string>>();
  for (const filePath of allMd) {
    const content = ctx.readContent(filePath);
    if (content === null) continue;
    for (const target of extractLinks(content, filePath, fileSet, basenameMap)) {
      if (target === filePath) continue; // skip self-links
      let sources = backlinks.get(target);
      if (!sources) { sources = new Set(); backlinks.set(target, sources); }
      sources.add(filePath);
    }
  }
  return backlinks;
}
