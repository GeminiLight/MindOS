'use client';

import { useState, useEffect, useMemo, memo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { RendererContext } from '@/lib/renderers/registry';
import type { GraphData, GraphDirection, GraphNode, GraphScope } from '@/app/api/graph/route';
import { apiFetch } from '@/lib/api';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';

interface Pos { x: number; y: number }

interface WikiNodeData {
  id: string;
  label: string;
  path: string;
  isCurrent: boolean;
  isMissing: boolean;
  dimmed: boolean;
  matched: boolean;
  degree: number;
  inDegree: number;
  outDegree: number;
  [key: string]: unknown;
}

type Depth = 1 | 2;

const GRAPH_WIDTH = 1040;
const GRAPH_HEIGHT = 680;
const CENTER: Pos = { x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 };

const WikiNode = memo(function WikiNode({ data }: NodeProps) {
  const smoothPush = useSmoothRouterPush();
  const {
    label,
    path,
    isCurrent,
    isMissing,
    dimmed,
    matched,
    degree,
    inDegree,
    outDegree,
  } = data as WikiNodeData;

  const handleClick = useCallback(() => {
    if (isMissing) return;
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    smoothPush('/view/' + encoded);
  }, [isMissing, path, smoothPush]);

  const scale = Math.min(1.45, 0.86 + Math.log2(Math.max(degree, 1) + 1) * 0.12);

  return (
    <div
      onClick={handleClick}
      title={`${path} / ${inDegree} in / ${outDegree} out`}
      className="font-display"
      style={{
        fontSize: 10 * scale,
        padding: `${4 * scale}px ${11 * scale}px`,
        borderRadius: 999,
        cursor: isMissing ? 'default' : 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        maxWidth: 240,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        opacity: dimmed ? 0.22 : isMissing ? 0.58 : 1,
        background: isCurrent ? 'var(--amber)' : matched ? 'var(--accent)' : 'var(--card)',
        color: isCurrent ? 'var(--amber-foreground)' : isMissing ? 'var(--muted-foreground)' : 'var(--foreground)',
        border: `1.5px solid ${isCurrent || matched ? 'var(--amber)' : isMissing ? 'var(--muted-foreground)' : 'var(--border)'}`,
        boxShadow: isCurrent ? '0 0 0 2px var(--amber-dim)' : 'none',
        transition: 'opacity 0.16s ease, background 0.16s ease, border-color 0.16s ease',
        zIndex: isCurrent ? 20 : matched ? 10 : 1,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      {isMissing ? '? ' : ''}
      {label}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
});

export function GraphRenderer({ filePath }: RendererContext) {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<GraphScope>('local');
  const [depth, setDepth] = useState<Depth>(1);
  const [direction, setDirection] = useState<GraphDirection>('both');
  const [includeUnresolved, setIncludeUnresolved] = useState(true);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      scope,
      includeUnresolved: String(includeUnresolved),
    });
    if (scope === 'local') {
      params.set('path', filePath);
      params.set('depth', String(depth));
      params.set('direction', direction);
    }

    setLoading(true);
    setError(null);
    apiFetch<GraphData>(`/api/graph?${params.toString()}`, { signal: controller.signal })
      .then((data) => {
        setGraphData(data);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setGraphData(null);
        setError(err instanceof Error ? err.message : 'Unable to load graph');
        setLoading(false);
      });

    return () => controller.abort();
  }, [depth, direction, filePath, includeUnresolved, scope]);

  const activeNodeIds = useMemo(() => {
    if (!graphData || !hoveredNodeId) return null;
    const ids = new Set<string>([hoveredNodeId]);
    for (const edge of graphData.edges) {
      if (edge.source === hoveredNodeId) ids.add(edge.target);
      if (edge.target === hoveredNodeId) ids.add(edge.source);
    }
    return ids;
  }, [graphData, hoveredNodeId]);

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const matchedNodeIds = useMemo(() => {
    if (!graphData || !normalizedSearch) return null;
    return new Set(
      graphData.nodes
        .filter((node) =>
          node.label.toLowerCase().includes(normalizedSearch) ||
          node.path.toLowerCase().includes(normalizedSearch) ||
          node.tags.some((tag) => tag.toLowerCase().includes(normalizedSearch)),
        )
        .map((node) => node.id),
    );
  }, [graphData, normalizedSearch]);

  const focusedNode = useMemo(() => {
    if (!graphData) return null;
    return graphData.nodes.find((node) => node.id === hoveredNodeId) ??
      graphData.nodes.find((node) => node.id === filePath) ??
      graphData.nodes[0] ??
      null;
  }, [filePath, graphData, hoveredNodeId]);

  const { rfNodes, rfEdges } = useMemo(() => {
    if (!graphData || graphData.nodes.length === 0) return { rfNodes: [], rfEdges: [] };
    const layout = buildStableLayout(graphData.nodes, graphData.edges, filePath, scope, direction);

    const rfNodes = graphData.nodes.map((node) => {
      const matched = matchedNodeIds?.has(node.id) ?? false;
      const dimmedByHover = activeNodeIds ? !activeNodeIds.has(node.id) : false;
      const dimmedBySearch = matchedNodeIds ? !matched : false;
      return {
        id: node.id,
        type: 'wiki' as const,
        position: layout[node.id] ?? CENTER,
        data: {
          id: node.id,
          label: node.label,
          path: node.path,
          isCurrent: Boolean(node.id === filePath || node.isCurrent),
          isMissing: node.isMissing,
          dimmed: dimmedByHover || dimmedBySearch,
          matched,
          degree: node.degree,
          inDegree: node.inDegree,
          outDegree: node.outDegree,
        } satisfies WikiNodeData,
      };
    });

    const rfEdges = graphData.edges.map((edge) => {
      const isDirectCurrentEdge = edge.source === filePath || edge.target === filePath;
      const isActive = activeNodeIds ? activeNodeIds.has(edge.source) && activeNodeIds.has(edge.target) : true;
      const isSearchVisible = matchedNodeIds ? matchedNodeIds.has(edge.source) || matchedNodeIds.has(edge.target) : true;
      const dimmed = !isActive || !isSearchVisible;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'default' as const,
        markerEnd: {
          type: 'arrowclosed' as const,
          color: edge.unresolved ? 'var(--muted-foreground)' : isDirectCurrentEdge ? 'var(--amber)' : 'var(--border)',
        },
        style: {
          stroke: edge.unresolved ? 'var(--muted-foreground)' : isDirectCurrentEdge ? 'var(--amber)' : 'var(--border)',
          strokeDasharray: edge.unresolved || edge.ambiguous ? '4 4' : undefined,
          strokeWidth: Math.min(2.4, 1 + Math.log2(edge.count + 1) * 0.25),
          opacity: dimmed ? 0.14 : isDirectCurrentEdge ? 0.82 : 0.44,
        },
        animated: isDirectCurrentEdge && !dimmed,
      };
    });

    return { rfNodes, rfEdges };
  }, [activeNodeIds, direction, filePath, graphData, matchedNodeIds, scope]);

  const nodeTypes = useMemo(() => ({ wiki: WikiNode }), []);

  if (!mounted || loading) {
    return <GraphStatus message="Building graph..." />;
  }

  if (error) {
    return <GraphStatus message={error} />;
  }

  if (!graphData) {
    return <GraphStatus message="No graph data available." />;
  }

  return (
    <div style={{ width: '100%', position: 'relative', zIndex: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 10,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <SegmentedControl
            value={scope}
            options={[
              { id: 'local', label: 'Local' },
              { id: 'global', label: 'Global' },
            ]}
            onChange={(value) => setScope(value as GraphScope)}
          />

          {scope === 'local' ? (
            <>
              <SegmentedControl
                value={String(depth)}
                options={[
                  { id: '1', label: '1 hop' },
                  { id: '2', label: '2 hops' },
                ]}
                onChange={(value) => setDepth(value === '2' ? 2 : 1)}
              />
              <SegmentedControl
                value={direction}
                options={[
                  { id: 'both', label: 'Both' },
                  { id: 'incoming', label: 'In' },
                  { id: 'outgoing', label: 'Out' },
                ]}
                onChange={(value) => setDirection(value as GraphDirection)}
              />
            </>
          ) : null}

          <label
            className="font-display"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              color: 'var(--muted-foreground)',
            }}
          >
            <input
              type="checkbox"
              checked={includeUnresolved}
              onChange={(event) => setIncludeUnresolved(event.target.checked)}
            />
            Missing links
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search graph"
            className="font-display"
            style={{
              height: 26,
              width: 160,
              borderRadius: 999,
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--foreground)',
              outline: 'none',
              padding: '0 10px',
              fontSize: 11,
            }}
          />
          <span className="font-display" style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>
            {graphData.stats.nodeCount} nodes / {graphData.stats.edgeCount} edges
            {graphData.stats.unresolvedCount ? ` / ${graphData.stats.unresolvedCount} missing` : ''}
          </span>
        </div>
      </div>

      <div
        className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(180px,240px)]"
        style={{ alignItems: 'stretch' }}
      >
        <div style={{ width: '100%', height: 'calc(100vh - 174px)', minHeight: 440 }}>
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            proOptions={{ hideAttribution: true }}
            onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
            onNodeMouseLeave={() => setHoveredNodeId(null)}
            style={{
              background: 'var(--background)',
              borderRadius: 12,
              border: '1px solid var(--border)',
            }}
          >
            <Background color="var(--border)" gap={24} size={1} variant={BackgroundVariant.Dots} />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(node) => {
                const data = node.data as WikiNodeData;
                if (data.isCurrent) return 'var(--amber)';
                if (data.isMissing) return 'var(--muted-foreground)';
                return 'var(--foreground)';
              }}
            />
          </ReactFlow>
        </div>

        <GraphDetails node={focusedNode} data={graphData} />
      </div>
    </div>
  );
}

function GraphStatus({ message }: { message: string }) {
  return (
    <div
      style={{
        width: '100%',
        height: 'calc(100vh - 160px)',
        minHeight: 400,
        borderRadius: 12,
        background: 'var(--muted)',
        border: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span className="font-display" style={{ color: 'var(--muted-foreground)', fontSize: 12 }}>
        {message}
      </span>
    </div>
  );
}

function SegmentedControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 2,
        padding: 3,
        borderRadius: 8,
        background: 'var(--muted)',
      }}
    >
      {options.map((option) => (
        <button
          key={option.id}
          onClick={() => onChange(option.id)}
          className="font-display"
          style={{
            padding: '3px 10px',
            borderRadius: 5,
            fontSize: 11,
            cursor: 'pointer',
            border: 'none',
            outline: 'none',
            background: value === option.id ? 'var(--card)' : 'transparent',
            color: value === option.id ? 'var(--foreground)' : 'var(--muted-foreground)',
            boxShadow: 'none',
            transition: 'background 0.12s ease, color 0.12s ease',
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function GraphDetails({ node, data }: { node: GraphNode | null; data: GraphData }) {
  const relatedEdges = useMemo(() => {
    if (!node) return [];
    return data.edges.filter((edge) => edge.source === node.id || edge.target === node.id).slice(0, 5);
  }, [data.edges, node]);

  return (
    <aside
      style={{
        border: '1px solid var(--border)',
        borderRadius: 12,
        background: 'var(--card)',
        padding: 12,
        minHeight: 160,
        color: 'var(--foreground)',
        overflow: 'hidden',
      }}
    >
      {node ? (
        <>
          <div className="font-display" style={{ fontSize: 13, lineHeight: 1.3, marginBottom: 4 }}>
            {node.label}
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: 10,
              color: 'var(--muted-foreground)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginBottom: 10,
            }}
            title={node.path}
          >
            {node.path}
          </div>
          <div className="font-display" style={{ display: 'grid', gap: 5, fontSize: 11, color: 'var(--muted-foreground)' }}>
            <span>{node.inDegree} incoming / {node.outDegree} outgoing</span>
            <span>{node.wordCount} words</span>
            {node.isMissing ? <span>Missing target</span> : null}
            {node.tags.length ? <span>{node.tags.slice(0, 4).map((tag) => `#${tag}`).join(' ')}</span> : null}
          </div>
          {relatedEdges.length ? (
            <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
              {relatedEdges.map((edge) => (
                <div
                  key={edge.id}
                  className="font-display"
                  style={{
                    borderTop: '1px solid var(--border)',
                    paddingTop: 6,
                    fontSize: 10,
                    color: 'var(--muted-foreground)',
                    lineHeight: 1.35,
                  }}
                >
                  <div>{edge.source === node.id ? 'to' : 'from'} {edge.source === node.id ? edge.target : edge.source}</div>
                  {edge.snippets[0] ? <div style={{ marginTop: 3 }}>{edge.snippets[0]}</div> : null}
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <span className="font-display" style={{ color: 'var(--muted-foreground)', fontSize: 12 }}>
          Hover a node to inspect links.
        </span>
      )}
    </aside>
  );
}

function buildStableLayout(
  nodes: GraphNode[],
  edges: GraphData['edges'],
  currentPath: string,
  scope: GraphScope,
  direction: GraphDirection,
): Record<string, Pos> {
  if (scope === 'global') return buildGlobalLayout(nodes);

  const directIncoming = new Set(edges.filter((edge) => edge.target === currentPath).map((edge) => edge.source));
  const directOutgoing = new Set(edges.filter((edge) => edge.source === currentPath).map((edge) => edge.target));
  const layout: Record<string, Pos> = { [currentPath]: CENTER };
  const current = nodes.find((node) => node.id === currentPath);
  if (current && !layout[current.id]) layout[current.id] = CENTER;

  const incoming = nodes.filter((node) => directIncoming.has(node.id)).sort(compareGraphNodes);
  const outgoing = nodes.filter((node) => directOutgoing.has(node.id)).sort(compareGraphNodes);
  const placed = new Set<string>([currentPath, ...incoming.map((node) => node.id), ...outgoing.map((node) => node.id)]);

  if (direction !== 'outgoing') placeColumn(layout, incoming, CENTER.x - 310, CENTER.y);
  if (direction !== 'incoming') placeColumn(layout, outgoing, CENTER.x + 310, CENTER.y);
  if (direction === 'incoming') placeColumn(layout, incoming, CENTER.x - 260, CENTER.y);
  if (direction === 'outgoing') placeColumn(layout, outgoing, CENTER.x + 260, CENTER.y);

  const secondary = nodes.filter((node) => !placed.has(node.id)).sort(compareGraphNodes);
  placeRing(layout, secondary, CENTER, 300);
  return layout;
}

function buildGlobalLayout(nodes: GraphNode[]): Record<string, Pos> {
  const sorted = [...nodes].sort(compareGraphNodes);
  const layout: Record<string, Pos> = {};
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  sorted.forEach((node, index) => {
    const radius = 70 + Math.sqrt(index + 1) * 42;
    const angle = index * goldenAngle + (stableHash(node.id) % 360) * (Math.PI / 180) * 0.03;
    layout[node.id] = {
      x: CENTER.x + Math.cos(angle) * radius,
      y: CENTER.y + Math.sin(angle) * radius,
    };
  });
  return layout;
}

function placeColumn(layout: Record<string, Pos>, nodes: GraphNode[], x: number, centerY: number): void {
  if (!nodes.length) return;
  const gap = Math.max(58, Math.min(88, 420 / Math.max(nodes.length - 1, 1)));
  const startY = centerY - ((nodes.length - 1) * gap) / 2;
  nodes.forEach((node, index) => {
    layout[node.id] = { x, y: startY + index * gap };
  });
}

function placeRing(layout: Record<string, Pos>, nodes: GraphNode[], center: Pos, radius: number): void {
  if (!nodes.length) return;
  nodes.forEach((node, index) => {
    const angle = (2 * Math.PI * index) / nodes.length - Math.PI / 2;
    layout[node.id] = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  });
}

function compareGraphNodes(a: GraphNode, b: GraphNode): number {
  return b.degree - a.degree || a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
}

function stableHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}
