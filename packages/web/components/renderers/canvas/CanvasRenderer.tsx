'use client';

/**
 * Read-only JSON Canvas (`.canvas`) viewer.
 *
 * Obsidian publishes the canvas file format as an open spec (jsoncanvas.org),
 * so MindOS can read these files without running any Obsidian plugin code.
 * Parsing lives in `@geminilight/mindos/foundation`; this component only lays
 * out the result.
 *
 * Read-only by design: editing a canvas is a separate feature with its own
 * interaction model, and shipping a half-editable surface over someone's vault
 * risks silent data loss.
 */

import { useMemo, useState } from 'react';
import {
  parseJsonCanvas,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeSide,
} from '@geminilight/mindos/foundation/canvas';
import {
  VaultIndexProvider,
  VaultMarkdown,
  VaultNoteEmbed,
  useVaultIndex,
  type VaultIndex,
} from '@/components/markdown/VaultMarkdown';
import { resolveImagePath } from '@/lib/image';
import { encodePath } from '@/lib/utils';
import type { RendererContext } from '@/lib/renderers/registry';

const PADDING = 48;
const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)$/i;

/** Preset colours map to tokens; explicit hex from the file is honoured as-is. */
function colorOf(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  if (color.startsWith('#')) return color;
  return /^[1-6]$/.test(color) ? `var(--canvas-${color})` : fallback;
}

function anchor(node: CanvasNode, side: CanvasNodeSide): { x: number; y: number } {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  switch (side) {
    case 'top': return { x: cx, y: node.y };
    case 'bottom': return { x: cx, y: node.y + node.height };
    case 'left': return { x: node.x, y: cy };
    case 'right': return { x: node.x + node.width, y: cy };
  }
}

/** When a file omits a side, pick the one facing the other node. */
function inferSide(from: CanvasNode, to: CanvasNode): CanvasNodeSide {
  const dx = (to.x + to.width / 2) - (from.x + from.width / 2);
  const dy = (to.y + to.height / 2) - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

function controlOffset(side: CanvasNodeSide, distance: number): { x: number; y: number } {
  const d = Math.max(40, Math.min(distance / 2, 160));
  switch (side) {
    case 'top': return { x: 0, y: -d };
    case 'bottom': return { x: 0, y: d };
    case 'left': return { x: -d, y: 0 };
    case 'right': return { x: d, y: 0 };
  }
}

/**
 * JSON Canvas stores a file node's subpath as `#Heading` or `#^block-id`;
 * the embed expects the `heading:` / `block:` form the remark plugin stamps.
 */
function toEmbedSubpath(subpath: string | undefined): string | undefined {
  const value = subpath?.replace(/^#/, '');
  if (!value) return undefined;
  return value.startsWith('^') ? `block:${value.slice(1)}` : `heading:${value}`;
}

function FileNodeBody({ node, vaultIndex }: {
  node: Extract<CanvasNode, { type: 'file' }>;
  vaultIndex: VaultIndex;
}) {
  if (IMAGE_RE.test(node.file)) {
    // Canvas file paths are vault-absolute; without the leading slash
    // `resolveImagePath` leaves them relative and the browser 404s.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={resolveImagePath(`/${node.file}`)} alt={node.file} className="h-full w-full object-contain" />;
  }
  // Obsidian shows the referenced note's content inside a file node, not just
  // its name. Reuse the reading-view embed so a canvas and a note render the
  // same note identically (and inherit its single-level, no-recursion rule).
  if (/\.md$/i.test(node.file)) {
    return (
      <div className="prose canvas-node-prose" style={{ height: '100%', overflow: 'auto', padding: 8 }}>
        <VaultNoteEmbed target={node.file} subpath={toEmbedSubpath(node.subpath)} vaultIndex={vaultIndex} />
      </div>
    );
  }
  const name = node.file.split('/').pop() ?? node.file;
  const href = `/view/${encodePath(node.file)}`;
  return (
    <div className="flex h-full flex-col gap-1 overflow-hidden p-3">
      <a href={href} className="truncate text-sm font-medium text-[var(--amber-text)] hover:underline">{name}</a>
      {node.subpath && <span className="truncate text-xs text-muted-foreground">{node.subpath}</span>}
    </div>
  );
}

function NodeBody({ node, vaultIndex, sourcePath }: { node: CanvasNode; vaultIndex: VaultIndex; sourcePath: string }) {
  switch (node.type) {
    case 'text':
      return (
        <div className="prose canvas-node-prose" style={{ height: '100%', overflow: 'hidden', padding: 12 }}>
          {/* Same renderer as the reading view; embeds off so a card stays a card. */}
          <VaultMarkdown content={node.text} sourcePath={sourcePath} embeds={false} />
        </div>
      );
    case 'file':
      return <FileNodeBody node={node} vaultIndex={vaultIndex} />;
    case 'link':
      return (
        <div className="flex h-full items-start overflow-hidden p-3">
          <a href={node.url} target="_blank" rel="noopener noreferrer" className="truncate text-sm text-[var(--amber-text)] hover:underline">
            {node.url}
          </a>
        </div>
      );
    case 'group':
      return null;
  }
}

export function CanvasRenderer({ content, filePath }: RendererContext) {
  const [fit, setFit] = useState(true);
  const result = useMemo(() => parseJsonCanvas(content), [content]);

  // One index for the whole board, shared with every text and file node below
  // through the provider, so N cards cost one load and one basename map.
  const vaultIndex = useVaultIndex();

  if (!result.ok || !result.canvas) {
    return (
      <div className="rounded-lg border border-[var(--border)] p-6">
        <p className="text-sm text-error">无法读取这个 canvas 文件。</p>
        <p className="mt-1 text-xs text-muted-foreground">{result.error}</p>
      </div>
    );
  }

  const { nodes, edges, bounds } = result.canvas;
  if (nodes.length === 0) {
    return <div className="rounded-lg border border-[var(--border)] p-6 text-sm text-muted-foreground">这个 canvas 还没有内容。</div>;
  }

  const width = bounds.maxX - bounds.minX + PADDING * 2;
  const height = bounds.maxY - bounds.minY + PADDING * 2;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  // Groups sit behind everything else regardless of their order in the file.
  const groups = nodes.filter((node) => node.type === 'group');
  const items = nodes.filter((node) => node.type !== 'group');

  const shift = (node: CanvasNode) => ({ left: node.x - bounds.minX + PADDING, top: node.y - bounds.minY + PADDING });

  const edgePath = (edge: CanvasEdge): { d: string; mid: { x: number; y: number } } | null => {
    const from = byId.get(edge.fromNode);
    const to = byId.get(edge.toNode);
    if (!from || !to) return null;
    const fromSide = edge.fromSide ?? inferSide(from, to);
    const toSide = edge.toSide ?? inferSide(to, from);
    const a = anchor(from, fromSide);
    const b = anchor(to, toSide);
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const ca = controlOffset(fromSide, dist);
    const cb = controlOffset(toSide, dist);
    const ox = -bounds.minX + PADDING;
    const oy = -bounds.minY + PADDING;
    return {
      d: `M ${a.x + ox} ${a.y + oy} C ${a.x + ca.x + ox} ${a.y + ca.y + oy}, ${b.x + cb.x + ox} ${b.y + cb.y + oy}, ${b.x + ox} ${b.y + oy}`,
      mid: { x: (a.x + b.x) / 2 + ox, y: (a.y + b.y) / 2 + oy },
    };
  };

  return (
    <VaultIndexProvider value={vaultIndex}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => setFit((value) => !value)}
            className="rounded-md border border-[var(--border)] px-2 py-1 transition-colors hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {fit ? '实际大小' : '适应宽度'}
          </button>
          <span>{nodes.length} 个节点 · {edges.length} 条连线{result.skipped > 0 ? ` · ${result.skipped} 项无法读取已跳过` : ''} · 只读</span>
        </div>

        <div
          className="rounded-lg border border-[var(--border)]"
          style={{ overflow: 'auto', maxHeight: '75vh', border: '1px solid var(--border)', borderRadius: 8 }}
        >
          <div
            className="origin-top-left"
            style={{ position: 'relative', width, height, ...(fit ? { transform: 'scale(var(--canvas-scale, 1))' } : {}) }}
            ref={(el) => {
              if (!el || !fit) return;
              const available = el.parentElement?.clientWidth ?? width;
              el.style.setProperty('--canvas-scale', String(Math.min(1, available / width)));
            }}
          >
            {groups.map((group) => (
              <div
                key={group.id}
                className="rounded-lg border-2 border-dashed"
                style={{
                  position: 'absolute', ...shift(group), width: group.width, height: group.height,
                  borderColor: colorOf(group.color, 'var(--border)'),
                  borderWidth: 2, borderStyle: 'dashed', borderRadius: 8,
                }}
              >
                {group.type === 'group' && group.label && (
                  <span
                    className="text-xs font-medium"
                    style={{ position: 'absolute', top: -22, left: 0, fontSize: 12, color: colorOf(group.color, 'var(--muted-foreground)') }}
                  >
                    {group.label}
                  </span>
                )}
              </div>
            ))}

            <svg
              width={width}
              height={height}
              aria-hidden="true"
              style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
            >
              <defs>
                <marker id="canvas-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
                </marker>
              </defs>
              {edges.map((edge) => {
                const path = edgePath(edge);
                if (!path) return null;
                const stroke = colorOf(edge.color, 'var(--muted-foreground)');
                return (
                  <g key={edge.id}>
                    <path
                      d={path.d}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={2}
                      markerEnd={edge.toEnd === 'arrow' ? 'url(#canvas-arrow)' : undefined}
                      markerStart={edge.fromEnd === 'arrow' ? 'url(#canvas-arrow)' : undefined}
                    />
                    {edge.label && (
                      <text x={path.mid.x} y={path.mid.y - 6} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">
                        {edge.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            {items.map((node) => (
              <div
                key={node.id}
                className="overflow-hidden rounded-lg border bg-[var(--background)] shadow-sm"
                style={{
                  position: 'absolute', ...shift(node), width: node.width, height: node.height,
                  borderColor: colorOf(node.color, 'var(--border)'),
                  borderWidth: 1, borderStyle: 'solid', borderRadius: 8,
                  background: 'var(--background)', overflow: 'hidden',
                }}
              >
                <NodeBody node={node} vaultIndex={vaultIndex} sourcePath={filePath} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </VaultIndexProvider>
  );
}

export default CanvasRenderer;
