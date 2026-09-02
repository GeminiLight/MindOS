// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ContextInspectorContent from '@/components/studio/ContextInspectorContent';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/lib/stores/locale-store', () => ({ useLocale: () => ({ locale: 'en' }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const assets = [
  {
    id: 'asset-alpha', kind: 'knowledge', status: 'active', title: 'Alpha guide', path: 'notes/Alpha 指南.md',
    contentHash: 'a'.repeat(64), version: 2, source: { kind: 'file', ref: 'notes/Alpha 指南.md' },
    createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-02T10:00:00.000Z',
  },
  {
    id: 'asset-beta', kind: 'echo-playbook', status: 'draft', title: 'Beta playbook', path: 'playbooks/beta.md',
    contentHash: 'b'.repeat(64), version: 1, source: { kind: 'echo-card', ref: 'echo-beta' },
    createdAt: '2026-09-02T08:00:00.000Z', updatedAt: '2026-09-02T08:00:00.000Z',
  },
];

const receipts = [
  {
    schemaVersion: 1, id: 'receipt-selected', queryHash: 'c'.repeat(64), queryPreview: 'alpha launch', strategy: 'hybrid',
    outcome: 'selected', startedAt: '2026-09-02T11:00:00.000Z', completedAt: '2026-09-02T11:00:00.120Z', durationMs: 120,
    budget: { maxTokens: 2000, maxFiles: 5, minScore: 0.4, timeoutMs: 3000 },
    scope: { preferredPaths: ['notes'], excludePaths: [] }, candidates: [],
    selections: [{ assetId: 'asset-alpha', path: 'notes/Alpha 指南.md', score: 0.91, estimatedTokens: 320, truncated: false, reason: 'Top semantic match' }],
    totals: { candidateCount: 3, selectedCount: 1, usedTokens: 320 }, metadata: { chatSessionId: 'chat-1' },
  },
  {
    schemaVersion: 1, id: 'receipt-error', queryHash: 'd'.repeat(64), queryPreview: 'beta failure', strategy: 'hybrid',
    outcome: 'error', startedAt: '2026-09-02T09:00:00.000Z', completedAt: '2026-09-02T09:00:01.000Z', durationMs: 1000,
    budget: { maxTokens: 1000, maxFiles: 3, minScore: 0.5, timeoutMs: 1000 },
    scope: { preferredPaths: [], excludePaths: [] }, candidates: [], selections: [],
    totals: { candidateCount: 0, selectedCount: 0, usedTokens: 0 }, error: 'Search unavailable',
  },
];

let host: HTMLDivElement;
let root: Root | null;

async function renderInspector() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<ContextInspectorContent />); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('ContextInspectorContent', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/api/context-assets')) return Response.json({ schemaVersion: 1, assets, summary: { total: 2, active: 1, draft: 1, deprecated: 0 } });
      if (url.includes('/api/retrieval-receipts')) return Response.json({ schemaVersion: 1, receipts, summary: { total: 2, selected: 1, empty: 0, failed: 1 } });
      return Response.json({ error: 'not found' }, { status: 404 });
    }));
  });

  afterEach(async () => {
    if (root) await act(async () => { root?.unmount(); });
    root = null;
    host?.remove();
    vi.unstubAllGlobals();
  });

  it('shows inspectable assets and navigates both directions between assets and receipts', async () => {
    await renderInspector();

    expect(host.textContent).toContain('Context Inspector');
    expect(host.textContent).toContain('Alpha guide');
    expect(host.textContent).toContain('2 assets');
    const alpha = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Alpha guide'));
    await act(async () => { alpha?.click(); });
    expect(host.textContent).toContain('Top semantic match');
    expect(host.textContent).toContain('receipt-selected');
    expect(host.querySelector('a[href="/view/notes/Alpha%20%E6%8C%87%E5%8D%97.md"]')).not.toBeNull();

    const linkedReceipt = host.querySelector('button[aria-label="Inspect receipt receipt-selected"]') as HTMLButtonElement;
    await act(async () => { linkedReceipt.click(); });
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Receipts');
    expect(host.textContent).toContain('alpha launch');

    const linkedAsset = host.querySelector('button[aria-label="Inspect asset asset-alpha"]') as HTMLButtonElement;
    await act(async () => { linkedAsset.click(); });
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Assets');
    expect(host.textContent).toContain('Alpha guide');
  });

  it('filters receipts and exposes failure details without hiding empty results', async () => {
    await renderInspector();
    const receiptsTab = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Receipts');
    await act(async () => { receiptsTab?.click(); });
    const search = host.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(search, 'failure');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.textContent).toContain('receipt-error');
    expect(host.textContent).toContain('Search unavailable');
    expect(host.textContent).not.toContain('receipt-selected');

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(search, 'does-not-exist');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.textContent).toContain('No receipts match these filters.');
  });

  it('shows a recoverable error when either inspector endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'offline' }, { status: 503 })));
    await renderInspector();
    expect(host.textContent).toContain('Could not load context observability data.');
    expect(host.textContent).toContain('Try again');
  });
});
