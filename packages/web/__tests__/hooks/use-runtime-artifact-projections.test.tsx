// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useRuntimeArtifactProjections } from '@/hooks/useRuntimeArtifactProjections';
import type {
  AgentRuntimeArtifactProjection,
  AgentRuntimeArtifactProjectionsPayload,
} from '@/lib/types';

function projection(id: string): AgentRuntimeArtifactProjection {
  return {
    schemaVersion: 1,
    runtimeId: id,
    runtimeName: id === 'codex' ? 'Codex' : 'MindOS Agent',
    runtimeKind: id === 'codex' ? 'codex' : 'mindos',
    runtimeStatus: 'available',
    status: 'ready',
    outputKinds: id === 'codex' ? ['text', 'diff', 'branch', 'pr'] : ['text', 'artifact'],
    reviewableOutputKinds: id === 'codex' ? ['diff', 'branch', 'pr'] : ['artifact'],
    nativeHandoffTargets: id === 'codex' ? ['message', 'diff', 'branch', 'pull-request'] : ['message', 'artifact'],
    nativeReview: {
      supported: true,
      summary: `${id} exposes reviewable output.`,
    },
    artifactIndex: {
      supported: true,
      status: 'ready',
      owner: 'mindos',
      summary: 'MindOS has a unified artifact pointer ledger for this runtime.',
      recordCount: 1,
      recentArtifacts: [
        {
          id: `${id}-artifact`,
          kind: 'file',
          source: 'runtime-output',
          status: 'completed',
          path: `Notes/${id}.md`,
          summary: `${id} artifact summary`,
          updatedAt: Date.UTC(2026, 5, 27, 0, 0, 0),
        },
      ],
    },
    rollback: {
      supported: false,
      source: 'none',
      summary: `${id} does not declare checkpoint output.`,
    },
    branchPr: {
      supported: id === 'codex',
      summary: `${id} branch support.`,
    },
    reasons: [],
  };
}

function payload(projections: AgentRuntimeArtifactProjection[]): AgentRuntimeArtifactProjectionsPayload {
  return {
    schemaVersion: 1,
    projections,
  };
}

function Probe({
  visible,
  onState,
}: {
  visible: boolean;
  onState: (state: ReturnType<typeof useRuntimeArtifactProjections>) => void;
}) {
  const state = useRuntimeArtifactProjections({ visible });
  useEffect(() => {
    onState(state);
  }, [onState, state]);
  return (
    <button
      type="button"
      data-loading={state.loading ? 'true' : 'false'}
      data-projections={state.projections.map((item) => item.runtimeId).join(',')}
      onClick={state.refresh}
    >
      refresh
    </button>
  );
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('useRuntimeArtifactProjections', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('loads artifact projections and filters malformed entries', async () => {
    const onState = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ...payload([projection('mindos'), projection('codex')]),
      projections: [projection('mindos'), { runtimeId: 'bad' }, projection('codex')],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(<Probe visible onState={onState} />);
      await flushAsync();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/agent-runtimes/artifact-projections', expect.objectContaining({
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    }));
    const node = host.querySelector('button') as HTMLButtonElement;
    expect(node.dataset.loading).toBe('false');
    expect(node.dataset.projections).toBe('mindos,codex');
    expect(onState.mock.calls.at(-1)?.[0].projections).toHaveLength(2);
  });

  it('does not fetch while hidden and uses force refresh when requested', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload([projection('mindos')]))));
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(<Probe visible={false} onState={vi.fn()} />);
      await flushAsync();
    });

    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<Probe visible onState={vi.fn()} />);
      await flushAsync();
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/agent-runtimes/artifact-projections', expect.any(Object));

    const node = host.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      node.click();
      await flushAsync();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/agent-runtimes/artifact-projections?force=1', expect.any(Object));
  });
});
