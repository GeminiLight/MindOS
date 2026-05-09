import { createHash } from 'node:crypto';
import { extname, posix } from 'node:path';
import { queryValue, type MindosRequestQuery } from '../context.js';
import { collectAllFilesFromMindRoot, readTextFileFromMindRoot } from '../runtime.js';
import { json, publicCacheHeaders, type MindosServerResponse } from '../response.js';

export interface GraphNode {
  id: string;
  label: string;
  folder: string;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface BacklinkItem {
  filePath: string;
  snippets: string[];
}

export type GraphHandlerServices = {
  mindRoot?: string;
  collectAllFiles?: () => string[];
  readTextFile?: (path: string) => string;
};

type LinkHit = {
  source: string;
  target: string;
  snippet: string;
};

export function handleGraph(services: GraphHandlerServices): MindosServerResponse<GraphData> {
  const graph = buildGraphData(services);
  return json(graph, { headers: publicCacheHeaders(300, generateETag(graph)) });
}

export function handleBacklinks(
  query: MindosRequestQuery | undefined,
  services: GraphHandlerServices,
): MindosServerResponse<BacklinkItem[] | { error: string }> {
  const target = normalizeTargetPath(queryValue(query, 'path'));
  if (!target) {
    return json({ error: 'path required' }, { status: 400 });
  }

  const snippets = new Map<string, string[]>();
  for (const hit of collectLinkHits(services)) {
    if (hit.target !== target) continue;
    const list = snippets.get(hit.source) ?? [];
    list.push(hit.snippet);
    snippets.set(hit.source, list);
  }

  const backlinks = [...snippets.entries()]
    .map(([filePath, lines]) => ({
      filePath,
      snippets: [...new Set(lines)],
    }))
    .sort((a, b) => a.filePath.localeCompare(b.filePath));

  return json(backlinks, { headers: publicCacheHeaders(300, generateETag(backlinks)) });
}

function buildGraphData(services: GraphHandlerServices): GraphData {
  const files = collectMarkdownFiles(services);
  const nodes = files.map((filePath) => ({
    id: filePath,
    label: posix.basename(filePath, '.md'),
    folder: posix.dirname(filePath),
  }));

  const edgeKeys = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const hit of collectLinkHits(services, files)) {
    if (hit.source === hit.target) continue;
    const key = `${hit.source}\0${hit.target}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ source: hit.source, target: hit.target });
  }

  edges.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  return { nodes, edges };
}

function collectLinkHits(services: GraphHandlerServices, markdownFiles = collectMarkdownFiles(services)): LinkHit[] {
  const fileSet = new Set(markdownFiles);
  const basenameMap = buildBasenameMap(markdownFiles);
  const hits: LinkHit[] = [];

  for (const source of markdownFiles) {
    let content = '';
    try {
      content = readText(services, source);
    } catch {
      continue;
    }
    hits.push(...extractLinkHits(content, source, fileSet, basenameMap));
  }

  return hits;
}

function collectMarkdownFiles(services: GraphHandlerServices): string[] {
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

function readText(services: GraphHandlerServices, filePath: string): string {
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

function normalizeTargetPath(value: string | undefined): string | undefined {
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

function generateETag(value: unknown): string {
  return `"${createHash('sha1').update(JSON.stringify(value)).digest('hex')}"`;
}
