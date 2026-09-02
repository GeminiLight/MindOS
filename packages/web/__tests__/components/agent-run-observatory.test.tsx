// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentActivitySection from '@/components/agents/AgentActivitySection';
import { agentRunStatusLabel } from '@/lib/agent-run-observatory';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/lib/stores/locale-store', () => ({ useLocale: () => ({ locale: 'en', t: { agentsContent: {} } }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const agentTrace = {
  id: 'run-root', rootRunId: 'run-root', source: 'agent', title: 'Release research', status: 'failed', coverage: 'live',
  startedAt: Date.parse('2026-09-02T10:00:00.000Z'), completedAt: Date.parse('2026-09-02T10:02:00.000Z'), durationMs: 120_000,
  inputSummary: 'Research the release.', error: 'Reviewer failed.', permissionMode: 'ask', runtimeIds: ['mindos', 'reviewer'],
  model: 'gpt-5.5', thinkingEffort: 'high',
  nodes: [
    { id: 'run-root', rootRunId: 'run-root', agentKind: 'mindos-main', runtimeId: 'mindos', displayName: 'MindOS Agent', status: 'completed', permissionMode: 'ask', inputSummary: 'Research.', startedAt: Date.parse('2026-09-02T10:00:00.000Z'), archive: { sessionId: 'session-1' } },
    { id: 'run-child', rootRunId: 'run-root', parentRunId: 'run-root', agentKind: 'pi-subagent', runtimeId: 'reviewer', displayName: 'Reviewer', status: 'failed', permissionMode: 'read', inputSummary: 'Review.', error: 'Reviewer failed.', startedAt: Date.parse('2026-09-02T10:00:30.000Z') },
  ],
  events: [{ id: 'event-tool', runId: 'run-root', type: 'tool_completed', category: 'tool', ts: Date.parse('2026-09-02T10:01:00.000Z'), status: 'completed', record: {}, data: { kind: 'tool', name: 'search', status: 'completed', outputSummary: '3 matches' } }],
  artifacts: [{ id: 'artifact-1', kind: 'file', status: 'completed', title: 'Release report', path: 'Reports/release.md' }],
  receipts: [{ id: 'receipt-1', outcome: 'selected', queryPreview: 'release research', durationMs: 45, totals: { candidateCount: 3, selectedCount: 1, usedTokens: 120 }, selections: [] }],
  contextAssets: [{ id: 'asset-1', title: 'Source note', path: 'Notes/source.md', kind: 'knowledge', status: 'active' }],
  approvals: [], sessions: [{ runtimeId: 'mindos', sessionId: 'session-1' }],
  counts: { nodes: 2, events: 1, tools: 1, files: 0, approvals: 0, artifacts: 1, receipts: 1 },
};

const automationTrace = {
  id: 'automation-run-1', rootRunId: 'automation-run-1', source: 'automation', automationId: 'studio-radar',
  title: 'Daily radar', status: 'waiting_approval', coverage: 'summary-only', startedAt: Date.parse('2026-09-02T11:00:00.000Z'),
  inputSummary: 'Build the daily radar.', permissionMode: 'ask', runtimeIds: ['codex'], model: 'codex', thinkingEffort: 'high',
  nodes: [{ id: 'automation-run-1', rootRunId: 'automation-run-1', agentKind: 'native-runtime', runtimeId: 'codex', displayName: 'Daily radar', status: 'running', permissionMode: 'ask', inputSummary: 'Build.', startedAt: Date.parse('2026-09-02T11:00:00.000Z') }],
  events: [], artifacts: [], receipts: [],
  contextAssets: [{ id: 'asset-auto', title: 'Daily radar run', path: '.mindos/automations/runs/automation-run-1.md', kind: 'automation-run', status: 'active' }],
  approvals: [{ id: 'approval-1', status: 'pending', runtime: 'codex', toolName: 'apply_patch', resource: 'Notes/plan.md', risk: { level: 'medium', summary: 'Changes a note.' }, delivery: { channel: 'feishu', status: 'sent', attemptedAt: '2026-09-02T11:01:00.000Z' } }],
  sessions: [], counts: { nodes: 1, events: 0, tools: 0, files: 0, approvals: 1, artifacts: 1, receipts: 0 },
};

let host: HTMLDivElement;
let root: Root;

async function renderSection() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<AgentActivitySection />); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('Agent Run Observatory UI', () => {
  it('localizes run status labels without changing the English default', () => {
    expect(agentRunStatusLabel('waiting_approval')).toBe('Waiting for approval');
    expect(agentRunStatusLabel('waiting_approval', 'zh')).toBe('待审批');
    expect(agentRunStatusLabel('timed_out', 'zh')).toBe('已超时');
  });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      runs: [], events: [],
      observatory: {
        schemaVersion: 1,
        generatedAt: '2026-09-02T12:00:00.000Z',
        warnings: ['Context assets are temporarily unavailable.'],
        traces: [automationTrace, agentTrace],
        summary: { totalTraces: 2, agentTraces: 1, automationTraces: 1, active: 0, waitingApproval: 1, completed: 0, failed: 1 },
      },
    })));
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    host?.remove();
    vi.unstubAllGlobals();
  });

  it('shows trace health, selects runs, and explains durable approval and summary-only coverage', async () => {
    await renderSection();

    expect(fetch).toHaveBeenCalledWith('/api/agent-runs?limit=100&includeEvents=1', expect.objectContaining({ cache: 'no-store' }));
    expect(host.textContent).toContain('Run Observatory');
    expect(host.textContent).toContain('2 traces');
    expect(host.textContent).toContain('1 waiting');
    expect(host.textContent).toContain('Daily radar');
    expect(host.textContent).toContain('Waiting for approval');
    expect(host.textContent).toContain('Summary only');
    expect(host.textContent).toContain('apply_patch');
    expect(host.textContent).toContain('Notes/plan.md');
    expect(host.textContent).toContain('Feishu · sent');
    expect(host.textContent).toContain('Context assets are temporarily unavailable.');
    expect(host.querySelector('a[href="/view/.mindos/automations/runs/automation-run-1.md"]')).not.toBeNull();

    const releaseRow = host.querySelector<HTMLButtonElement>('button[aria-label="Inspect run Release research"]');
    await act(async () => { releaseRow?.click(); });
    expect(host.textContent).toContain('Reviewer failed.');
    expect(host.textContent).toContain('MindOS Agent');
    expect(host.textContent).toContain('Reviewer');
    expect(host.textContent).toContain('receipt-1');
    expect(host.querySelector('a[href="/view/Reports/release.md"]')).not.toBeNull();
    expect(host.querySelector('a[href="/view/Notes/source.md"]')).not.toBeNull();
    expect(host.textContent).toContain('session-1');
  });

  it('filters by waiting state and keeps a useful empty filter state', async () => {
    await renderSection();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Filter runs by waiting"]')?.click();
    });
    expect(host.textContent).toContain('Daily radar');
    expect(host.textContent).not.toContain('Release research');

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Filter runs by completed"]')?.click();
    });
    expect(host.textContent).toContain('No runs match this filter.');
  });

  it('shows a retryable error instead of treating transport failure as no history', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'offline' }, { status: 503 })));
    await renderSection();
    expect(host.textContent).toContain('Could not load run observability data.');
    expect(host.textContent).toContain('Try again');
  });
});
