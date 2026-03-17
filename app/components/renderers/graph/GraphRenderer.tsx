'use client';

import { useState, useEffect, useMemo, memo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
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
import type { GraphData, GraphNode, GraphEdge } from '@/app/api/graph/route';
import { apiFetch } from '@/lib/api';

// ─── Force Layout ──────────────────────────────────────────────────────────────

interface Pos { x: number; y: number }

function forceLayout(
  nodeIds: string[],
  edges: { source: string; target: string }[],
  iterations?: number,
): Record<string, Pos> {
  const n = nodeIds.length;
  if (n === 0) return {};

  const iters = iterations ?? (n > 100 ? 80 : 150);
  const width = 1200;
  const height = 900;
  // k is the "ideal" distance between nodes
  const k = Math.sqrt((width * height) / Math.max(n, 1)) * 0.6;
  const pos: Record<string, Pos> = {};

  // Initialize in a more spread-out circle or random
  nodeIds.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / n;
    const radius = Math.min(width, height) * 0.4 * Math.random();
    pos[id] = {
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
    };
  });

  const disp: Record<string, Pos> = {};
  const initTemp = width * 0.1;

  for (let iter = 0; iter < iters; iter++) {
    const temp = initTemp * (1 - iter / iters);

    for (const id of nodeIds) disp[id] = { x: 0, y: 0 };

    // Repulsion (nodes push each other away)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const u = nodeIds[i], v = nodeIds[j];
        const dx = pos[u].x - pos[v].x;
        const dy = pos[u].y - pos[v].y;
        const distSq = dx * dx + dy * dy || 0.01;
        const dist = Math.sqrt(distSq);
        const force = (k * k) / dist;
        disp[u].x += (dx / dist) * force;
        disp[u].y += (dy / dist) * force;
        disp[v].x -= (dx / dist) * force;
        disp[v].y -= (dy / dist) * force;
      }
    }

    // Attraction (edges pull nodes together)
    for (const e of edges) {
      const u = e.source, v = e.target;
      if (!pos[u] || !pos[v]) continue;
      const dx = pos[u].x - pos[v].x;
      const dy = pos[u].y - pos[v].y;
      const distSq = dx * dx + dy * dy || 0.01;
      const dist = Math.sqrt(distSq);
      const force = (dist * dist) / k;
      disp[u].x -= (dx / dist) * force;
      disp[u].y -= (dy / dist) * force;
      disp[v].x += (dx / dist) * force;
      disp[v].y += (dy / dist) * force;
    }

    // Gravity (pull towards center to avoid drifting)
    for (const id of nodeIds) {
      const dx = pos[id].x - width / 2;
      const dy = pos[id].y - height / 2;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = 0.05 * dist; // Gentle pull
      disp[id].x -= (dx / dist) * force;
      disp[id].y -= (dy / dist) * force;
    }

    // Apply displacements
    for (const id of nodeIds) {
      const d = disp[id];
      const dlen = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
      pos[id].x += (d.x / dlen) * Math.min(dlen, temp);
      pos[id].y += (d.y / dlen) * Math.min(dlen, temp);
      
      // Softer clamping
      pos[id].x = Math.max(0, Math.min(width, pos[id].x));
      pos[id].y = Math.max(0, Math.min(height, pos[id].y));
    }
  }

  return pos;
}

// ─── WikiNode ──────────────────────────────────────────────────────────────────

interface WikiNodeData {
  label: string;
  id: string;
  isCurrent: boolean;
  isOrphan: boolean;
  [key: string]: unknown;
}

const WikiNode = memo(function WikiNode({ data }: NodeProps) {
  const router = useRouter();
  const { label, id, isCurrent, isOrphan, size = 1 } = data as WikiNodeData & { size?: number };

  const handleClick = useCallback(() => {
    const encoded = (id as string).split('/').map(encodeURIComponent).join('/');
    router.push('/view/' + encoded);
  }, [id, router]);

  const scale = 0.8 + Math.min(size * 0.1, 1.2);

  return (
    <div
      onClick={handleClick}
      title={id as string}
      className="group font-display"
      style={{
        fontSize: 10 * scale,
        padding: `${4 * scale}px ${12 * scale}px`,
        borderRadius: 999, // Pill shape
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        maxWidth: 240,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        opacity: isOrphan ? 0.4 : 1,
        background: isCurrent ? 'var(--amber)' : 'var(--card)',
        color: isCurrent ? 'var(--amber-foreground)' : 'var(--foreground)',
        border: `1.5px solid ${isCurrent ? 'var(--amber)' : 'var(--border)'}`,
        boxShadow: isCurrent 
          ? '0 0 20px var(--amber-dim), 0 0 0 2px var(--amber-dim)' 
          : '0 2px 4px rgba(0,0,0,0.1)',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        zIndex: isCurrent ? 10 : 1,
      }}
      onMouseEnter={e => {
        if (!isCurrent) {
          e.currentTarget.style.borderColor = 'var(--amber)';
          e.currentTarget.style.background = 'var(--accent)';
        }
      }}
      onMouseLeave={e => {
        if (!isCurrent) {
          e.currentTarget.style.borderColor = 'var(--border)';
          e.currentTarget.style.background = 'var(--card)';
        }
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      {label as string}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
});

// ─── GraphRenderer ─────────────────────────────────────────────────────────────

type Scope = 'global' | 'local';

export function GraphRenderer({ filePath }: RendererContext) {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<Scope>('local');
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    apiFetch<GraphData>('/api/graph')
      .then((data) => { setGraphData(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Degree calculation (for node sizing)
  const degrees = useMemo(() => {
    if (!graphData) return new Map<string, number>();
    const d = new Map<string, number>();
    for (const e of graphData.edges) {
      d.set(e.source, (d.get(e.source) || 0) + 1);
      d.set(e.target, (d.get(e.target) || 0) + 1);
    }
    return d;
  }, [graphData]);

  // Build adjacency for BFS (local scope)
  const adjacency = useMemo(() => {
    if (!graphData) return null;
    const adj = new Map<string, Set<string>>();
    for (const e of graphData.edges) {
      if (!adj.has(e.source)) adj.set(e.source, new Set());
      if (!adj.has(e.target)) adj.set(e.target, new Set());
      adj.get(e.source)!.add(e.target);
      adj.get(e.target)!.add(e.source);
    }
    return adj;
  }, [graphData]);

  // Scope filter
  const { filteredNodes, filteredEdges } = useMemo(() => {
    if (!graphData) return { filteredNodes: [], filteredEdges: [] };

    let nodeSubset: GraphNode[];
    let edgeSubset: GraphEdge[];

    if (scope === 'global') {
      nodeSubset = graphData.nodes;
      edgeSubset = graphData.edges;
    } else {
      // local: BFS 2 hops
      const visited = new Set<string>();
      const queue: Array<{ id: string; depth: number }> = [{ id: filePath, depth: 0 }];
      visited.add(filePath);
      while (queue.length > 0) {
        const { id, depth } = queue.shift()!;
        if (depth >= 2) continue;
        const neighbors = adjacency?.get(id) ?? new Set<string>();
        for (const nb of neighbors) {
          if (!visited.has(nb)) {
            visited.add(nb);
            queue.push({ id: nb, depth: depth + 1 });
          }
        }
      }
      nodeSubset = graphData.nodes.filter(n => visited.has(n.id));
      const nodeIds = new Set(nodeSubset.map(n => n.id));
      edgeSubset = graphData.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
    }

    return { filteredNodes: nodeSubset, filteredEdges: edgeSubset };
  }, [graphData, scope, filePath, adjacency]);

  // Orphan detection (nodes with no edges in the current subset)
  const connectedIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of filteredEdges) {
      s.add(e.source);
      s.add(e.target);
    }
    return s;
  }, [filteredEdges]);

  // Compute layout + build RF nodes/edges
  const { rfNodes, rfEdges } = useMemo(() => {
    if (filteredNodes.length === 0) return { rfNodes: [], rfEdges: [] };

    const nodeIds = filteredNodes.map(n => n.id);
    const layout = forceLayout(nodeIds, filteredEdges);

    const rfNodes = filteredNodes.map(n => ({
      id: n.id,
      type: 'wiki' as const,
      position: layout[n.id] ?? { x: 0, y: 0 },
      data: {
        label: n.label,
        id: n.id,
        isCurrent: n.id === filePath,
        isOrphan: !connectedIds.has(n.id),
        size: degrees.get(n.id) || 1,
      },
    }));

    const rfEdges = filteredEdges.map((e, i) => {
      const isRelatedToCurrent = e.source === filePath || e.target === filePath;
      return {
        id: `e-${i}`,
        source: e.source,
        target: e.target,
        type: 'default' as const, // Curved default
        markerEnd: { type: 'arrowclosed' as const, color: isRelatedToCurrent ? 'var(--amber)' : 'var(--border)' },
        style: { 
          stroke: isRelatedToCurrent ? 'var(--amber)' : 'var(--border)', 
          strokeWidth: isRelatedToCurrent ? 1.5 : 1,
          opacity: isRelatedToCurrent ? 0.8 : 0.4,
        },
        animated: isRelatedToCurrent,
      };
    });

    return { rfNodes, rfEdges };
  }, [filteredNodes, filteredEdges, filePath, connectedIds, degrees]);

  const nodeTypes = useMemo(() => ({ wiki: WikiNode }), []);

  const scopeButtons: { id: Scope; label: string }[] = [
    { id: 'local', label: 'Local' },
    { id: 'global', label: 'Global' },
  ];

  if (!mounted || loading) {
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
          {loading ? 'Building graph…' : 'Loading…'}
        </span>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', position: 'relative', zIndex: 0 }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 10,
          flexWrap: 'wrap',
        }}
      >
        <span
          className="font-display"
          style={{
            fontSize: 11,
            color: 'var(--muted-foreground)',
          }}
        >
          {filteredNodes.length} nodes · {filteredEdges.length} edges
        </span>

        <div
          style={{
            display: 'flex',
            gap: 2,
            padding: 3,
            borderRadius: 8,
            background: 'var(--muted)',
          }}
        >
          {scopeButtons.map(btn => (
            <button
              key={btn.id}
              onClick={() => setScope(btn.id)}
              className="font-display"
              style={{
                padding: '3px 12px',
                borderRadius: 5,
                fontSize: 11,
                cursor: 'pointer',
                border: 'none',
                outline: 'none',
                background: scope === btn.id ? 'var(--card)' : 'transparent',
                color: scope === btn.id ? 'var(--foreground)' : 'var(--muted-foreground)',
                boxShadow: scope === btn.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.1s',
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* React Flow */}
      <div
        style={{
          width: '100%',
          height: 'calc(100vh - 160px)',
          minHeight: 400,
        }}
      >
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
          style={{
            background: 'var(--background)',
            borderRadius: 12,
            border: '1px solid var(--border)',
          }}
        >
          <Background
            color="var(--border)"
            gap={24}
            size={1}
            variant={BackgroundVariant.Dots}
          />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(n) =>
              (n.data as WikiNodeData)?.isCurrent ? 'var(--amber)' : 'var(--muted-foreground)'
            }
          />
        </ReactFlow>
      </div>
    </div>
  );
}
