import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { queryValue, type MindosRequestQuery } from '../context.js';
import {
  getLinkSnapshot,
  normalizeTargetPath,
  type LinkHit,
  type LinkKind,
  type LinkScanServices,
} from '../link-index.js';
import { json, publicCacheHeaders, type MindosServerResponse } from '../response.js';

export type GraphScope = 'global' | 'local';
export type GraphDirection = 'both' | 'incoming' | 'outgoing';
export type GraphNodeType = 'note' | 'missing';
export type GraphEdgeKind = LinkKind | 'mixed';

export interface GraphNode {
  id: string;
  path: string;
  label: string;
  folder: string;
  type: GraphNodeType;
  tags: string[];
  wordCount: number;
  inDegree: number;
  outDegree: number;
  degree: number;
  isMissing: boolean;
  isCurrent?: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  count: number;
  snippets: string[];
  unresolved: boolean;
  ambiguous: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
}

export interface GraphStats {
  scope: GraphScope;
  depth: number | null;
  direction: GraphDirection;
  nodeCount: number;
  edgeCount: number;
  totalNodeCount: number;
  totalEdgeCount: number;
  orphanCount: number;
  unresolvedCount: number;
  ambiguousCount: number;
  treeVersion: number | null;
}

export interface BacklinkItem {
  filePath: string;
  snippets: string[];
}

export type GraphHandlerServices = LinkScanServices;

export function handleGraph(services: GraphHandlerServices): MindosServerResponse<GraphData>;
export function handleGraph(
  query: MindosRequestQuery | undefined,
  services: GraphHandlerServices,
): MindosServerResponse<GraphData | { error: string }>;
export function handleGraph(
  queryOrServices: MindosRequestQuery | GraphHandlerServices | undefined,
  maybeServices?: GraphHandlerServices,
): MindosServerResponse<GraphData | { error: string }> {
  const query = maybeServices ? (queryOrServices as MindosRequestQuery | undefined) : undefined;
  const services = maybeServices ?? (queryOrServices as GraphHandlerServices);
  const options = parseGraphOptions(query);
  if (options.scope === 'local' && !options.path) {
    return json({ error: 'path required for local graph' }, { status: 400 });
  }

  const graph = buildGraphData(services, options);
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

  const snippets = getLinkSnapshot(services).backlinksByTarget.get(target) ?? new Map<string, Set<string>>();

  const backlinks = [...snippets.entries()]
    .map(([filePath, lines]) => ({
      filePath,
      snippets: [...lines],
    }))
    .sort((a, b) => a.filePath.localeCompare(b.filePath));

  return json(backlinks, { headers: publicCacheHeaders(300, generateETag(backlinks)) });
}

type ParsedGraphOptions = {
  scope: GraphScope;
  path?: string;
  depth: number;
  direction: GraphDirection;
  includeUnresolved: boolean;
  includeOrphans: boolean;
};

type EdgeAggregate = {
  source: string;
  target: string;
  kind: GraphEdgeKind;
  count: number;
  snippets: Set<string>;
  unresolved: boolean;
  ambiguous: boolean;
};

function buildGraphData(services: GraphHandlerServices, options: ParsedGraphOptions): GraphData {
  const snapshot = getLinkSnapshot(services);
  const fileSet = new Set(snapshot.files);
  const edgeMap = new Map<string, EdgeAggregate>();
  for (const hit of snapshot.hits) {
    if (hit.source === hit.target) continue;
    if (!options.includeUnresolved && hit.resolution !== 'resolved') continue;
    aggregateEdge(edgeMap, hit);
  }

  const allEdges = [...edgeMap.values()]
    .map(toGraphEdge)
    .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.kind.localeCompare(b.kind));

  const allNodeIds = new Set(snapshot.files);
  for (const edge of allEdges) {
    allNodeIds.add(edge.source);
    allNodeIds.add(edge.target);
  }

  const scopedNodeIds = options.scope === 'local' && options.path
    ? buildLocalNodeIds(options.path, options.depth, options.direction, allEdges)
    : allNodeIds;
  if (options.scope === 'local' && options.path) scopedNodeIds.add(options.path);

  let scopedEdges = allEdges.filter((edge) => scopedNodeIds.has(edge.source) && scopedNodeIds.has(edge.target));
  let nodes = [...scopedNodeIds]
    .map((nodeId) => buildGraphNode(nodeId, snapshot.fileMetadata.get(nodeId), fileSet, scopedEdges, options.path))
    .sort((a, b) => a.id.localeCompare(b.id));

  if (!options.includeOrphans) {
    const connected = new Set<string>();
    for (const edge of scopedEdges) {
      connected.add(edge.source);
      connected.add(edge.target);
    }
    if (options.path) connected.add(options.path);
    nodes = nodes.filter((node) => connected.has(node.id));
    const remaining = new Set(nodes.map((node) => node.id));
    scopedEdges = scopedEdges.filter((edge) => remaining.has(edge.source) && remaining.has(edge.target));
  }

  const stats = buildStats({
    options,
    nodes,
    edges: scopedEdges,
    totalNodeCount: allNodeIds.size,
    totalEdgeCount: allEdges.length,
    treeVersion: readTreeVersion(services),
  });

  return { nodes, edges: scopedEdges, stats };
}

function generateETag(value: unknown): string {
  return `"${createHash('sha1').update(JSON.stringify(value)).digest('hex')}"`;
}

function parseGraphOptions(query: MindosRequestQuery | undefined): ParsedGraphOptions {
  const scope = parseScope(queryValue(query, 'scope'));
  return {
    scope,
    path: normalizeTargetPath(queryValue(query, 'path')),
    depth: clampInteger(queryValue(query, 'depth'), scope === 'local' ? 1 : 0, 0, 4),
    direction: parseDirection(queryValue(query, 'direction')),
    includeUnresolved: queryValue(query, 'includeUnresolved') !== 'false',
    includeOrphans: queryValue(query, 'includeOrphans') !== 'false',
  };
}

function parseScope(value: string | undefined): GraphScope {
  return value === 'local' ? 'local' : 'global';
}

function parseDirection(value: string | undefined): GraphDirection {
  if (value === 'incoming' || value === 'outgoing') return value;
  return 'both';
}

function clampInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function aggregateEdge(edgeMap: Map<string, EdgeAggregate>, hit: LinkHit): void {
  const key = `${hit.source}\0${hit.target}`;
  const existing = edgeMap.get(key);
  if (!existing) {
    edgeMap.set(key, {
      source: hit.source,
      target: hit.target,
      kind: hit.kind,
      count: 1,
      snippets: new Set(hit.snippet ? [hit.snippet] : []),
      unresolved: hit.resolution === 'unresolved',
      ambiguous: hit.resolution === 'ambiguous',
    });
    return;
  }

  existing.count += 1;
  if (existing.kind !== hit.kind) existing.kind = 'mixed';
  if (hit.snippet) existing.snippets.add(hit.snippet);
  existing.unresolved ||= hit.resolution === 'unresolved';
  existing.ambiguous ||= hit.resolution === 'ambiguous';
}

function toGraphEdge(edge: EdgeAggregate): GraphEdge {
  return {
    id: `${edge.source}\0${edge.target}`,
    source: edge.source,
    target: edge.target,
    kind: edge.kind,
    count: edge.count,
    snippets: [...edge.snippets].slice(0, 3),
    unresolved: edge.unresolved,
    ambiguous: edge.ambiguous,
  };
}

function buildLocalNodeIds(
  rootPath: string,
  depth: number,
  direction: GraphDirection,
  edges: GraphEdge[],
): Set<string> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (direction === 'both' || direction === 'outgoing') {
      addAdjacent(adjacency, edge.source, edge.target);
    }
    if (direction === 'both' || direction === 'incoming') {
      addAdjacent(adjacency, edge.target, edge.source);
    }
  }

  const visited = new Set<string>([rootPath]);
  const queue: Array<{ id: string; depth: number }> = [{ id: rootPath, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= depth) continue;
    for (const neighbor of adjacency.get(current.id) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push({ id: neighbor, depth: current.depth + 1 });
    }
  }
  return visited;
}

function addAdjacent(adjacency: Map<string, Set<string>>, source: string, target: string): void {
  let neighbors = adjacency.get(source);
  if (!neighbors) {
    neighbors = new Set();
    adjacency.set(source, neighbors);
  }
  neighbors.add(target);
}

function buildGraphNode(
  id: string,
  metadata: { title: string; tags: string[]; wordCount: number } | undefined,
  fileSet: Set<string>,
  edges: GraphEdge[],
  currentPath: string | undefined,
): GraphNode {
  let inDegree = 0;
  let outDegree = 0;
  for (const edge of edges) {
    if (edge.source === id) outDegree += 1;
    if (edge.target === id) inDegree += 1;
  }

  const isMissing = !fileSet.has(id);
  return {
    id,
    path: id,
    label: metadata?.title || posix.basename(id, '.md'),
    folder: posix.dirname(id),
    type: isMissing ? 'missing' : 'note',
    tags: metadata?.tags ?? [],
    wordCount: metadata?.wordCount ?? 0,
    inDegree,
    outDegree,
    degree: inDegree + outDegree,
    isMissing,
    isCurrent: id === currentPath,
  };
}

function buildStats(input: {
  options: ParsedGraphOptions;
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalNodeCount: number;
  totalEdgeCount: number;
  treeVersion: number | null;
}): GraphStats {
  return {
    scope: input.options.scope,
    depth: input.options.scope === 'local' ? input.options.depth : null,
    direction: input.options.direction,
    nodeCount: input.nodes.length,
    edgeCount: input.edges.length,
    totalNodeCount: input.totalNodeCount,
    totalEdgeCount: input.totalEdgeCount,
    orphanCount: input.nodes.filter((node) => node.degree === 0).length,
    unresolvedCount: input.nodes.filter((node) => node.isMissing).length,
    ambiguousCount: input.edges.filter((edge) => edge.ambiguous).length,
    treeVersion: input.treeVersion,
  };
}

function readTreeVersion(services: GraphHandlerServices): number | null {
  if (!services.getTreeVersion) return null;
  try {
    return services.getTreeVersion();
  } catch {
    return null;
  }
}
