/**
 * JSON Canvas (`.canvas`) parsing.
 *
 * JSON Canvas is the open file format Obsidian publishes for its canvas files
 * (jsoncanvas.org). Like the wiki-link parser this module is pure — it only
 * validates and normalises the document, leaving rendering and file resolution
 * to callers.
 *
 * Parsing is deliberately lenient: a single malformed node must not blank out
 * the whole canvas, so unusable entries are counted in `skipped` and dropped
 * rather than aborting. Only a structurally invalid document (bad JSON, or a
 * non-object top level) is reported as `ok: false`.
 */

export type CanvasColor = string;

export type CanvasNodeSide = 'top' | 'right' | 'bottom' | 'left';
export type CanvasEdgeEnd = 'none' | 'arrow';

type CanvasNodeBase = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColor;
};

export type CanvasTextNode = CanvasNodeBase & { type: 'text'; text: string };
export type CanvasFileNode = CanvasNodeBase & { type: 'file'; file: string; subpath?: string };
export type CanvasLinkNode = CanvasNodeBase & { type: 'link'; url: string };
export type CanvasGroupNode = CanvasNodeBase & { type: 'group'; label?: string };

export type CanvasNode = CanvasTextNode | CanvasFileNode | CanvasLinkNode | CanvasGroupNode;

export type CanvasEdge = {
  id: string;
  fromNode: string;
  fromSide?: CanvasNodeSide;
  fromEnd: CanvasEdgeEnd;
  toNode: string;
  toSide?: CanvasNodeSide;
  toEnd: CanvasEdgeEnd;
  color?: CanvasColor;
  label?: string;
};

export type CanvasBounds = { minX: number; minY: number; maxX: number; maxY: number };

export type JsonCanvas = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  /** Bounding box over all nodes; all zeroes for an empty canvas. */
  bounds: CanvasBounds;
};

export type JsonCanvasParseResult = {
  ok: boolean;
  canvas?: JsonCanvas;
  /** Set when the document itself could not be read. */
  error?: string;
  /** Number of nodes/edges dropped because they were unusable. */
  skipped: number;
};

const SIDES: ReadonlySet<string> = new Set(['top', 'right', 'bottom', 'left']);
const ENDS: ReadonlySet<string> = new Set(['none', 'arrow']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readSide(value: unknown): CanvasNodeSide | undefined {
  return typeof value === 'string' && SIDES.has(value) ? (value as CanvasNodeSide) : undefined;
}

function readEnd(value: unknown, fallback: CanvasEdgeEnd): CanvasEdgeEnd {
  return typeof value === 'string' && ENDS.has(value) ? (value as CanvasEdgeEnd) : fallback;
}

function parseNode(raw: unknown): CanvasNode | null {
  if (!isRecord(raw)) return null;

  const id = nonEmptyString(raw.id);
  const x = finiteNumber(raw.x);
  const y = finiteNumber(raw.y);
  const width = finiteNumber(raw.width);
  const height = finiteNumber(raw.height);
  if (id === null || x === null || y === null || width === null || height === null) return null;

  const base: CanvasNodeBase = {
    id,
    x,
    y,
    width,
    height,
    ...(nonEmptyString(raw.color) ? { color: raw.color as string } : {}),
  };

  switch (raw.type) {
    case 'text': {
      const text = typeof raw.text === 'string' ? raw.text : null;
      return text === null ? null : { ...base, type: 'text', text };
    }
    case 'file': {
      const file = nonEmptyString(raw.file);
      if (file === null) return null;
      const subpath = nonEmptyString(raw.subpath);
      return { ...base, type: 'file', file, ...(subpath ? { subpath } : {}) };
    }
    case 'link': {
      const url = nonEmptyString(raw.url);
      return url === null ? null : { ...base, type: 'link', url };
    }
    case 'group': {
      const label = nonEmptyString(raw.label);
      return { ...base, type: 'group', ...(label ? { label } : {}) };
    }
    default:
      return null;
  }
}

function parseEdge(raw: unknown, nodeIds: ReadonlySet<string>): CanvasEdge | null {
  if (!isRecord(raw)) return null;

  const id = nonEmptyString(raw.id);
  const fromNode = nonEmptyString(raw.fromNode);
  const toNode = nonEmptyString(raw.toNode);
  if (id === null || fromNode === null || toNode === null) return null;
  // An edge to a dropped or non-existent node has nothing to draw between.
  if (!nodeIds.has(fromNode) || !nodeIds.has(toNode)) return null;

  const fromSide = readSide(raw.fromSide);
  const toSide = readSide(raw.toSide);
  const label = nonEmptyString(raw.label);
  const color = nonEmptyString(raw.color);

  return {
    id,
    fromNode,
    ...(fromSide ? { fromSide } : {}),
    fromEnd: readEnd(raw.fromEnd, 'none'),
    toNode,
    ...(toSide ? { toSide } : {}),
    toEnd: readEnd(raw.toEnd, 'arrow'),
    ...(color ? { color } : {}),
    ...(label ? { label } : {}),
  };
}

function computeBounds(nodes: readonly CanvasNode[]): CanvasBounds {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  return { minX, minY, maxX, maxY };
}

/** Parse a `.canvas` document. Never throws. */
export function parseJsonCanvas(source: string): JsonCanvasParseResult {
  const trimmed = source.trim();
  if (!trimmed) {
    return { ok: true, canvas: { nodes: [], edges: [], bounds: computeBounds([]) }, skipped: 0 };
  }

  let document: unknown;
  try {
    document = JSON.parse(trimmed);
  } catch (error) {
    return { ok: false, error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`, skipped: 0 };
  }

  if (!isRecord(document)) {
    return { ok: false, error: 'A canvas file must contain a JSON object.', skipped: 0 };
  }

  let skipped = 0;
  const nodes: CanvasNode[] = [];
  const seen = new Set<string>();

  if (Array.isArray(document.nodes)) {
    for (const raw of document.nodes) {
      const node = parseNode(raw);
      // Duplicate ids would make edge endpoints ambiguous; keep the first.
      if (node === null || seen.has(node.id)) {
        skipped += 1;
        continue;
      }
      seen.add(node.id);
      nodes.push(node);
    }
  }

  const edges: CanvasEdge[] = [];
  if (Array.isArray(document.edges)) {
    for (const raw of document.edges) {
      const edge = parseEdge(raw, seen);
      if (edge === null) {
        skipped += 1;
        continue;
      }
      edges.push(edge);
    }
  }

  return { ok: true, canvas: { nodes, edges, bounds: computeBounds(nodes) }, skipped };
}
