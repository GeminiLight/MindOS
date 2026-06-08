// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockApiFetch = vi.fn();

vi.mock('@/lib/api', () => ({
  apiFetch: mockApiFetch,
}));

describe('useSyncAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('uses the long sync timeout for manual sync actions', async () => {
    const { useSyncAction } = await import('@/lib/sync-status-store');
    const refresh = vi.fn().mockResolvedValue(undefined);
    mockApiFetch.mockResolvedValue({});

    function Harness() {
      const { syncNow } = useSyncAction(refresh);
      return <button type="button" onClick={() => void syncNow()}>sync</button>;
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/api/sync', expect.objectContaining({
      method: 'POST',
      timeout: 120_000,
    }));
    expect(refresh).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps failed sync action errors visible to the caller', async () => {
    const { useSyncAction } = await import('@/lib/sync-status-store');
    const refresh = vi.fn().mockResolvedValue(undefined);
    mockApiFetch.mockRejectedValue(new Error('push failed'));

    function Harness() {
      const { syncNow, syncError } = useSyncAction(refresh);
      return (
        <div>
          <button type="button" onClick={() => void syncNow()}>sync</button>
          <p>{syncError}</p>
        </div>
      );
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => {
      host.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('push failed');
    expect(refresh).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
