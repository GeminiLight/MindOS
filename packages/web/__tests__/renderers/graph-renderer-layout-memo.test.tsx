// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GraphRenderer } from '@/components/renderers/graph/GraphRenderer';
import { buildStableLayout } from '@/components/renderers/graph/graph-layout';

const mockApiFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ apiFetch: mockApiFetch }));
vi.mock('@/hooks/useSmoothRouterPush', () => ({ useSmoothRouterPush: () => vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock('@xyflow/react/dist/style.css', () => ({}));
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, onNodeMouseEnter, onNodeMouseLeave, onNodeClick }: {
    nodes: Array<{ id: string }>;
    onNodeMouseEnter: (event: unknown, node: { id: string }) => void;
    onNodeMouseLeave: () => void;
    onNodeClick: (event: unknown, node: { id: string }) => void;
  }) => (
    <div data-testid="flow">
      <span data-testid="node-count">{nodes.length}</span>
      <button type="button" aria-label="hover first" onClick={() => onNodeMouseEnter(null, nodes[1] ?? nodes[0]!)} />
      <button type="button" aria-label="unhover" onClick={() => onNodeMouseLeave()} />
      <button type="button" aria-label="select first" onClick={() => onNodeClick(null, nodes[1] ?? nodes[0]!)} />
    </div>
  ),
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => null,
  MiniMap: () => null,
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}));
vi.mock('@/components/renderers/graph/graph-layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/renderers/graph/graph-layout')>();
  return { ...actual, buildStableLayout: vi.fn(actual.buildStableLayout) };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function node(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, path: id, label: id.replace(/\.md$/, ''), tags: [], degree: 1, inDegree: 0, outDegree: 1,
    isCurrent: false, isMissing: false, isAmbiguous: false, ...extra,
  };
}

const graphData = {
  nodes: [node('Notes/root.md', { isCurrent: true }), node('Notes/child.md'), node('Notes/other.md')],
  edges: [
    { id: 'e1', source: 'Notes/root.md', target: 'Notes/child.md', count: 1, unresolved: false, ambiguous: false, candidates: [], subpaths: [], snippets: [] },
    { id: 'e2', source: 'Notes/root.md', target: 'Notes/other.md', count: 1, unresolved: false, ambiguous: false, candidates: [], subpaths: [], snippets: [] },
  ],
  stats: { nodeCount: 3, edgeCount: 2, unresolvedCount: 0, orphanCount: 0 },
};

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe('GraphRenderer layout memoization', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockResolvedValue(graphData);
    vi.mocked(buildStableLayout).mockClear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('does not recompute the layout on hover or selection changes', async () => {
    await act(async () => {
      root.render(<GraphRenderer filePath="Notes/root.md" />);
    });
    await flush();
    expect(host.querySelector('[data-testid="node-count"]')?.textContent).toBe('3');
    const layoutCallsAfterLoad = vi.mocked(buildStableLayout).mock.calls.length;
    expect(layoutCallsAfterLoad).toBeGreaterThan(0);

    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="hover first"]')!.click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="select first"]')!.click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="unhover"]')!.click(); });

    expect(vi.mocked(buildStableLayout).mock.calls.length).toBe(layoutCallsAfterLoad);
  });
});
