// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPush = vi.fn();

vi.mock('@/hooks/useSmoothRouterPush', () => ({
  useSmoothRouterPush: () => mockPush,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Agent activity review links', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('opens scoped review for write operations with a file path', async () => {
    const { AgentActivityOpCard } = await import('@/components/agents/agent-activity-shared');

    await act(async () => {
      root.render(
        <AgentActivityOpCard
          locale="en"
          op={{
            id: 'op-1',
            ts: '2026-06-22T00:01:00.000Z',
            tool: 'mindos_update_lines',
            params: { path: 'Research/notes.md' },
            result: 'ok',
          }}
        />,
      );
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[title="Review changes"]')?.click();
    });

    expect(mockPush).toHaveBeenCalledWith('/changelog?source=agent&path=Research%2Fnotes.md');
  });
});
