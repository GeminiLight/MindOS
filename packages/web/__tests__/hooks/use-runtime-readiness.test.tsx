// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useRuntimeReadiness } from '@/hooks/useRuntimeReadiness';
import type {
  AgentPermissionMode,
  AgentRuntimeReadinessProjection,
  AgentRuntimeReadinessPayload,
} from '@/lib/types';

function projection(
  runtimeId: string,
  runtimeKind: AgentRuntimeReadinessProjection['runtimeKind'],
): AgentRuntimeReadinessProjection {
  return {
    schemaVersion: 1,
    runtimeId,
    runtimeName: runtimeId,
    runtimeKind,
    runtimeStatus: 'available',
    overallStatus: 'limited',
    summary: `${runtimeId} readiness`,
    recommendations: [],
    useCases: [],
    gaps: [],
  };
}

function payload(permissionMode: AgentPermissionMode, projections: AgentRuntimeReadinessProjection[]): AgentRuntimeReadinessPayload {
  return {
    schemaVersion: 1,
    requestedPermissionMode: permissionMode,
    projections,
  };
}

function Probe({
  visible,
  permissionMode,
  onState,
}: {
  visible: boolean;
  permissionMode: AgentPermissionMode;
  onState: (state: ReturnType<typeof useRuntimeReadiness>) => void;
}) {
  const state = useRuntimeReadiness({ visible, permissionMode });
  useEffect(() => {
    onState(state);
  }, [onState, state]);
  return (
    <div
      data-loading={state.loading ? 'true' : 'false'}
      data-runtimes={Object.keys(state.readinessByRuntimeId).sort().join(',')}
    />
  );
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('useRuntimeReadiness', () => {
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

  it('fetches readiness for the active permission mode and indexes by runtime id and kind', async () => {
    const onState = vi.fn();
    const fetchMock = vi.fn(async (url: string) => {
      const mode = new URL(url, 'http://mindos.local').searchParams.get('permissionMode') as AgentPermissionMode;
      return new Response(JSON.stringify(payload(mode, [projection('codex-app-server', 'codex')])), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(<Probe visible permissionMode="ask" onState={onState} />);
      await flushAsync();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/agent-runtimes/readiness?permissionMode=ask', expect.any(Object));
    const node = host.querySelector('div') as HTMLDivElement;
    expect(node.dataset.loading).toBe('false');
    expect(node.dataset.runtimes).toBe('codex,codex-app-server');

    await act(async () => {
      root.render(<Probe visible permissionMode="full" onState={onState} />);
      await flushAsync();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/agent-runtimes/readiness?permissionMode=full', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not fetch while hidden', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(<Probe visible={false} permissionMode="ask" onState={vi.fn()} />);
      await flushAsync();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    const node = host.querySelector('div') as HTMLDivElement;
    expect(node.dataset.loading).toBe('false');
    expect(node.dataset.runtimes).toBe('');
  });
});
