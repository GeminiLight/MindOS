// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useRuntimeCatalog } from '@/hooks/useRuntimeCatalog';
import type {
  AgentRuntimeCatalogEntry,
  AgentRuntimeCatalogPayload,
  AgentRuntimeDescriptor,
} from '@/lib/types';

const runtimeCapabilities = {
  ownsModelSelection: false,
  supportsResume: true,
  supportsFreshSession: true,
  supportsListSessions: true,
  supportsAttachExisting: true,
  supportsFork: true,
  supportsArchive: true,
  supportsInterrupt: true,
  supportsModelList: false,
  supportsApprovals: true,
  supportsUserInput: true,
  supportsToolEvents: true,
  supportsRuntimeStatus: true,
  supportsDiffs: true,
  supportsCheckpoints: false,
  supportsBackgroundRuns: false,
  supportsMcpConfig: false,
};

const lifecycle = {
  schemaVersion: 1 as const,
  stages: {} as AgentRuntimeDescriptor['lifecycle']['stages'],
  remote: { supported: true, mode: 'local-only' as const, unattended: 'limited' as const, summary: 'local' },
  coordination: {
    role: 'primary' as const,
    supportsSharedContext: true,
    supportsMailbox: false,
    supportsTaskBoard: false,
    summary: 'primary',
  },
};

const compatibility = {
  schemaVersion: 1 as const,
  summary: 'compatible',
  scenarios: {} as AgentRuntimeDescriptor['compatibility']['scenarios'],
};

function descriptor(id: string): AgentRuntimeDescriptor {
  return {
    id,
    name: id,
    kind: id === 'codex' ? 'codex' : 'mindos',
    adapter: id === 'codex' ? 'codex-app-server' : 'mindos',
    modelOwner: id === 'codex' ? 'external' : 'mindos',
    authOwner: id === 'codex' ? 'external' : 'mindos',
    permissionOwner: id === 'codex' ? 'external' : 'mindos',
    sessionOwner: id === 'codex' ? 'external' : 'mindos',
    status: 'available',
    capabilities: runtimeCapabilities,
    lifecycle,
    compatibility,
    adapterContract: {
      schemaVersion: 1,
      connection: { kind: 'internal', owner: 'mindos', summary: 'internal' },
      configuration: {
        modelSelection: id === 'codex' ? 'runtime-native' : 'mindos-settings',
        credentials: id === 'codex' ? 'runtime-native' : 'mindos-settings',
        settings: id === 'codex' ? 'runtime-native' : 'mindos-settings',
        summary: 'configured',
      },
      health: { mode: 'mindos-native', owner: 'mindos', summary: 'healthy' },
      commands: { discovery: 'mindos-skills', commands: [], summary: 'commands' },
      protocol: {
        supportsStreaming: true,
        authRequired: false,
        modelCount: 0,
        models: [],
        summary: 'protocol',
      },
    },
  };
}

function catalogEntry(id: string): AgentRuntimeCatalogEntry {
  return {
    schemaVersion: 1,
    id,
    runtimeId: id,
    name: id,
    kind: id === 'codex' ? 'codex' : 'mindos',
    category: id === 'codex' ? 'native' : 'mindos',
    status: 'available',
    adapter: id === 'codex' ? 'codex-app-server' : 'mindos',
    aliases: [],
    owners: {
      model: id === 'codex' ? 'external' : 'mindos',
      auth: id === 'codex' ? 'external' : 'mindos',
      permission: id === 'codex' ? 'external' : 'mindos',
      session: id === 'codex' ? 'external' : 'mindos',
    },
    capabilitySummary: {
      session: id === 'codex' ? 'native-thread' : 'local-id',
      commandDiscovery: 'mindos-skills',
      modelSelection: id === 'codex' ? 'runtime-native' : 'mindos-settings',
      mcpConfig: { supportsDescriptorConfig: false },
      output: ['text'],
      eventStream: ['text'],
      remoteMode: 'local-only',
      unattended: 'limited',
      coordinationRole: 'primary',
    },
    diagnostics: {
      schemaVersion: 1,
      checkedAt: '2026-06-27T00:00:00.000Z',
      status: 'available',
      sources: ['runtime-catalog'],
      summary: `${id} is available.`,
      hints: [],
      checks: [
        {
          id: 'availability',
          label: 'Availability',
          status: 'passed',
          severity: 'info',
          source: 'runtime-catalog',
          summary: `${id} is available.`,
        },
      ],
    },
  };
}

function payload(entries: AgentRuntimeCatalogEntry[]): {
  runtimes: AgentRuntimeDescriptor[];
  catalog: AgentRuntimeCatalogPayload;
} {
  return {
    runtimes: entries.map((entry) => descriptor(entry.id)),
    catalog: {
      schemaVersion: 1,
      generatedAt: '2026-06-27T00:00:00.000Z',
      summary: {
        total: entries.length,
        available: entries.length,
        missing: 0,
        signedOut: 0,
        error: 0,
        categories: { mindos: 1, native: entries.length - 1, acp: 0, cloud: 0 },
      },
      entries,
    },
  };
}

function Probe({
  visible,
  onState,
}: {
  visible: boolean;
  onState: (state: ReturnType<typeof useRuntimeCatalog>) => void;
}) {
  const state = useRuntimeCatalog({ visible });
  useEffect(() => {
    onState(state);
  }, [onState, state]);
  return (
    <button
      type="button"
      data-loading={state.loading ? 'true' : 'false'}
      data-entries={state.entries.map((entry) => entry.id).join(',')}
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

describe('useRuntimeCatalog', () => {
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

  it('loads the runtime catalog and filters invalid entries without dropping valid runtimes', async () => {
    const onState = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ...payload([catalogEntry('mindos'), catalogEntry('codex')]),
      catalog: {
        ...payload([catalogEntry('mindos'), catalogEntry('codex')]).catalog,
        entries: [catalogEntry('mindos'), { id: 'bad' }, catalogEntry('codex')],
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(<Probe visible onState={onState} />);
      await flushAsync();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/agent-runtimes', expect.objectContaining({
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    }));
    const node = host.querySelector('button') as HTMLButtonElement;
    expect(node.dataset.loading).toBe('false');
    expect(node.dataset.entries).toBe('mindos,codex');
    expect(onState.mock.calls.at(-1)?.[0].runtimes).toHaveLength(2);
  });

  it('does not fetch while hidden and uses force refresh when requested', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload([catalogEntry('mindos')]))));
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
    expect(fetchMock).toHaveBeenCalledWith('/api/agent-runtimes', expect.any(Object));

    const node = host.querySelector('button') as HTMLButtonElement;
    await act(async () => {
      node.click();
      await flushAsync();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/agent-runtimes?force=1', expect.any(Object));
  });
});
