// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

function renderHook<T>(useHook: () => T) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const ref: { current: T | null } = { current: null };
  function Test() { ref.current = useHook(); return null; }
  return {
    ref,
    async mount() { await act(async () => { root.render(<Test />); }); },
    async unmount() { await act(async () => { root.unmount(); }); },
  };
}

describe('useFileImport duplicate handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('keeps two distinct files when name and size match but content differs', async () => {
    const { useFileImport } = await import('@/hooks/useFileImport');
    const hook = renderHook(() => useFileImport());
    await hook.mount();

    const fileA = new File(['aaa'], 'report.txt', { type: 'text/plain' });
    const fileB = new File(['bbb'], 'report.txt', { type: 'text/plain' });
    expect(fileA.size).toBe(fileB.size);
    expect(await fileA.text()).not.toBe(await fileB.text());

    await act(async () => {
      await hook.ref.current!.addFiles([fileA, fileB]);
    });

    expect(hook.ref.current!.files).toHaveLength(2);

    await hook.unmount();
  });

  it('sends both files to /api/file/import after selection', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ created: [], skipped: [], errors: [], updatedFiles: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { useFileImport } = await import('@/hooks/useFileImport');
    const hook = renderHook(() => useFileImport());
    await hook.mount();

    const fileA = new File(['aaa'], 'report.txt', { type: 'text/plain' });
    const fileB = new File(['bbb'], 'report.txt', { type: 'text/plain' });

    await act(async () => {
      await hook.ref.current!.addFiles([fileA, fileB]);
    });

    await act(async () => {
      await hook.ref.current!.doArchive();
    });

    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/file/import')!;
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload.files).toHaveLength(2);

    await hook.unmount();
  });
});
