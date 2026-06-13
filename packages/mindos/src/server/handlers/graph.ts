import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { queryValue, type MindosRequestQuery } from '../context.js';
import { getLinkSnapshot, normalizeTargetPath, type LinkScanServices } from '../link-index.js';
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

export type GraphHandlerServices = LinkScanServices;

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
  for (const hit of getLinkSnapshot(services).hits) {
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
  const snapshot = getLinkSnapshot(services);
  const nodes = snapshot.files.map((filePath) => ({
    id: filePath,
    label: posix.basename(filePath, '.md'),
    folder: posix.dirname(filePath),
  }));

  const edgeKeys = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const hit of snapshot.hits) {
    if (hit.source === hit.target) continue;
    const key = `${hit.source}\0${hit.target}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ source: hit.source, target: hit.target });
  }

  edges.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  return { nodes, edges };
}

function generateETag(value: unknown): string {
  return `"${createHash('sha1').update(JSON.stringify(value)).digest('hex')}"`;
}
