// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useAiOrganize } from '@/hooks/useAiOrganize';

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}

function OrganizeHarness() {
  const { start } = useAiOrganize();
  useEffect(() => {
    void start(
      [{ name: 'capture.md', content: 'source text' }],
      'Organize this',
      'inbox-organize',
      { providerOverride: 'p_capture', modelOverride: 'capture-model' },
    );
  }, [start]);
  return null;
}

describe('useAiOrganize start request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: streamFrom(['data: {"type":"done"}\n\n']),
      json: async () => ({}),
    }));
  });

  it('passes Capture-specific provider and model overrides to /api/ask organize mode', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<OrganizeHarness />);
      await new Promise(r => setTimeout(r, 0));
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledWith('/api/ask', expect.objectContaining({
      method: 'POST',
    }));
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request).toMatchObject({
      mode: 'organize',
      providerOverride: 'p_capture',
      modelOverride: 'capture-model',
    });

    await act(async () => {
      root.unmount();
    });
  });
});
