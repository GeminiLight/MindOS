import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { queryValue, type MindosRequestQuery } from '../context.js';
import {
  getLinkSnapshot,
  normalizeTargetPath,
  type LinkAggregateKind,
  type LinkEdgeAggregate,
  type LinkScanServices,
  type LinkTargetSubpath,
} from '../link-index.js';
import { json, revalidateCacheHeaders, type MindosServerResponse } from '../response.js';

export type GraphScope = 'global' | 'local';
export type GraphDirection = 'both' | 'incoming' | 'outgoing';
export type GraphNodeType = 'note' | 'missing';
export type GraphEdgeKind = LinkAggregateKind;

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
  isAmbiguous: boolean;
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
  candidates: string[];
  subpaths: LinkTargetSubpath[];
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
  return json(graph, { headers: revalidateCacheHeaders(generateETag(graph)) });
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

  return json(backlinks, { headers: revalidateCacheHeaders(generateETag(backlinks)) });
}

type ParsedGraphOptions = {
  scope: GraphScope;
  path?: string;
  depth: number;
  direction: GraphDirection;
  includeUnresolved: boolean;
  includeOrphans: boolean;
};

function buildGraphData(services: GraphHandlerServices, options: ParsedGraphOptions): GraphData {
  const snapshot = getLinkSnapshot(services);
  const fileSet = new Set(snapshot.files);
  const allEdges = snapshot.edgeAggregates
    .filter((edge) => isGraphEdgeVisible(edge, options.includeUnresolved))
    .map(toGraphEdge)
    .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.kind.localeCompare(b.kind));

  const allNodeIds = options.includeUnresolved ? new Set(snapshot.nodeIds) : new Set(snapshot.files);
  for (const edge of allEdges) {
    allNodeIds.add(edge.source);
    allNodeIds.add(edge.target);
  }

  const scopedNodeIds = options.scope === 'local' && options.path
    ? buildLocalNodeIds(options.path, options.depth, options.direction, options.includeUnresolved, snapshot)
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

function isGraphEdgeVisible(edge: LinkEdgeAggregate, includeUnresolved: boolean): boolean {
  if (edge.source === edge.target) return false;
  if (!includeUnresolved && (edge.unresolved || edge.ambiguous)) return false;
  return true;
}

function toGraphEdge(edge: LinkEdgeAggregate): GraphEdge {
  return {
    id: `${edge.source}\0${edge.target}`,
    source: edge.source,
    target: edge.target,
    kind: edge.kind,
    count: edge.count,
    snippets: edge.snippets.slice(0, 3),
    unresolved: edge.unresolved,
    ambiguous: edge.ambiguous,
    candidates: edge.candidates,
    subpaths: edge.subpaths,
  };
}

function buildLocalNodeIds(
  rootPath: string,
  depth: number,
  direction: GraphDirection,
  includeUnresolved: boolean,
  snapshot: ReturnType<typeof getLinkSnapshot>,
): Set<string> {
  const visited = new Set<string>([rootPath]);
  const queue: Array<{ id: string; depth: number }> = [{ id: rootPath, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= depth) continue;
    for (const neighbor of getAdjacentNodeIds(current.id, direction, includeUnresolved, snapshot)) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push({ id: neighbor, depth: current.depth + 1 });
    }
  }
  return visited;
}

function getAdjacentNodeIds(
  nodeId: string,
  direction: GraphDirection,
  includeUnresolved: boolean,
  snapshot: ReturnType<typeof getLinkSnapshot>,
): string[] {
  const ids = new Set<string>();

  if (direction === 'both' || direction === 'outgoing') {
    for (const edge of snapshot.outgoingEdgesBySource.get(nodeId) ?? []) {
      if (!isGraphEdgeVisible(edge, includeUnresolved)) continue;
      ids.add(edge.target);
    }
  }

  if (direction === 'both' || direction === 'incoming') {
    for (const edge of snapshot.incomingEdgesByTarget.get(nodeId) ?? []) {
      if (!isGraphEdgeVisible(edge, includeUnresolved)) continue;
      ids.add(edge.source);
    }
  }

  return [...ids].sort((a, b) => a.localeCompare(b));
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
  const isAmbiguous = edges.some((edge) => edge.target === id && edge.ambiguous);
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
    isAmbiguous,
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
