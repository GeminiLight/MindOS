'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { RendererContext } from '@/lib/renderers/registry';
import type { GraphData, GraphDirection, GraphNode, GraphScope } from '@/app/api/graph/route';
import { apiFetch } from '@/lib/api';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import { GraphDetails } from './GraphDetails';
import { WikiGraphNode } from './GraphNode';
import { GraphToolbar } from './GraphToolbar';
import { buildStableLayout, CENTER } from './graph-layout';
import type { Depth, WikiNodeData } from './graph-types';
import { RendererPageShell, RendererStatus } from '../renderer-primitives';

export function GraphRenderer({ filePath }: RendererContext) {
  const smoothPush = useSmoothRouterPush();
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<GraphScope>('local');
  const [depth, setDepth] = useState<Depth>(1);
  const [direction, setDirection] = useState<GraphDirection>('both');
  const [includeUnresolved, setIncludeUnresolved] = useState(true);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(filePath);
  const [searchTerm, setSearchTerm] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    setSelectedNodeId(filePath);
  }, [filePath]);

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
    return graphData.nodes.find((node) => node.id === selectedNodeId) ??
      graphData.nodes.find((node) => node.id === hoveredNodeId) ??
      graphData.nodes.find((node) => node.id === filePath) ??
      graphData.nodes[0] ??
      null;
  }, [filePath, graphData, hoveredNodeId, selectedNodeId]);

  const { rfNodes, rfEdges } = useMemo(() => {
    if (!graphData || graphData.nodes.length === 0) return { rfNodes: [], rfEdges: [] };
    const layout = buildStableLayout(graphData.nodes, graphData.edges, filePath, scope, direction);

    const rfNodes = graphData.nodes.map((node) => {
      const matched = matchedNodeIds?.has(node.id) ?? false;
      const dimmedByHover = activeNodeIds ? !activeNodeIds.has(node.id) : false;
      const dimmedBySearch = matchedNodeIds ? !matched : false;
      const selected = node.id === selectedNodeId;
      const hovered = node.id === hoveredNodeId;
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
          isAmbiguous: node.isAmbiguous,
          dimmed: dimmedByHover || dimmedBySearch,
          matched,
          selected,
          hovered,
          degree: node.degree,
          inDegree: node.inDegree,
          outDegree: node.outDegree,
        } satisfies WikiNodeData,
      };
    });

    const rfEdges = graphData.edges.map((edge) => {
      const isDirectCurrentEdge = edge.source === filePath || edge.target === filePath;
      const isSelectedEdge = selectedNodeId ? edge.source === selectedNodeId || edge.target === selectedNodeId : false;
      const isActive = activeNodeIds ? activeNodeIds.has(edge.source) && activeNodeIds.has(edge.target) : true;
      const isSearchVisible = matchedNodeIds ? matchedNodeIds.has(edge.source) || matchedNodeIds.has(edge.target) : true;
      const dimmed = !isActive || !isSearchVisible;
      const highlighted = isSelectedEdge || isDirectCurrentEdge;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'default' as const,
        markerEnd: {
          type: 'arrowclosed' as const,
          color: edge.unresolved ? 'var(--muted-foreground)' : highlighted ? 'var(--amber)' : 'var(--border)',
        },
        style: {
          stroke: edge.unresolved ? 'var(--muted-foreground)' : highlighted ? 'var(--amber)' : 'var(--border)',
          strokeDasharray: edge.unresolved || edge.ambiguous ? '4 4' : undefined,
          strokeWidth: highlighted ? 1.9 : Math.min(2.1, 1 + Math.log2(edge.count + 1) * 0.2),
          opacity: dimmed ? 0.12 : highlighted ? 0.78 : 0.36,
        },
        animated: highlighted && !dimmed,
      };
    });

    return { rfNodes, rfEdges };
  }, [activeNodeIds, direction, filePath, graphData, hoveredNodeId, matchedNodeIds, scope, selectedNodeId]);

  const nodeTypes = useMemo<NodeTypes>(() => ({ wiki: WikiGraphNode as NodeTypes[string] }), []);

  const openNode = useCallback((node: GraphNode) => {
    if (node.isMissing) return;
    const encoded = node.path.split('/').map(encodeURIComponent).join('/');
    smoothPush('/view/' + encoded);
  }, [smoothPush]);

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
    <RendererPageShell wide className="relative z-0 py-0">
      <GraphToolbar
        scope={scope}
        depth={depth}
        direction={direction}
        includeUnresolved={includeUnresolved}
        searchTerm={searchTerm}
        stats={graphData.stats}
        onScopeChange={setScope}
        onDepthChange={setDepth}
        onDirectionChange={setDirection}
        onIncludeUnresolvedChange={setIncludeUnresolved}
        onSearchTermChange={setSearchTerm}
      />

      <div className="mt-3 grid items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(210px,260px)]">
        <div className="h-[calc(100vh_-_178px)] min-h-[440px] w-full">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onNodeDoubleClick={(_, node) => {
              const graphNode = graphData.nodes.find((item) => item.id === node.id);
              if (graphNode) openNode(graphNode);
            }}
            onPaneClick={() => setSelectedNodeId(filePath)}
            onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
            onNodeMouseLeave={() => setHoveredNodeId(null)}
            className="rounded-lg border border-border bg-background"
          >
            <Background color="var(--border)" gap={24} size={1} variant={BackgroundVariant.Dots} />
            <Controls showInteractive={false} />
            {scope === 'global' ? (
              <MiniMap
                pannable
                zoomable
                nodeColor={(node) => {
                  const data = node.data as WikiNodeData;
                  if (data.isCurrent) return 'var(--amber)';
                  if (data.isMissing) return 'var(--muted-foreground)';
                  if (data.isAmbiguous) return 'var(--amber)';
                  return 'var(--foreground)';
                }}
                nodeStrokeWidth={2}
              />
            ) : null}
          </ReactFlow>
        </div>

        <GraphDetails node={focusedNode} data={graphData} onOpenNode={openNode} />
      </div>
    </RendererPageShell>
  );
}

function GraphStatus({ message }: { message: string }) {
  return (
    <RendererStatus framed className="h-[calc(100vh_-_160px)] w-full">
      {message}
    </RendererStatus>
  );
}
