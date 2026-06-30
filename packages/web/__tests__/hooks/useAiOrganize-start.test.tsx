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
      { providerOverride: 'p_capture', modelOverride: 'capture-model', assistantId: 'inbox-organizer' },
    );
  }, [start]);
  return null;
}

function OversizedOrganizeHarness({ onState }: { onState: (state: { phase: string; error: string | null }) => void }) {
  const aiOrganize = useAiOrganize();

  useEffect(() => {
    void aiOrganize.start(
      [{ name: 'large.md', content: 'x'.repeat(20_001) }],
      'Organize this',
      'inbox-organize',
      { assistantId: 'inbox-organizer' },
    );
  }, [aiOrganize.start]);

  useEffect(() => {
    onState({ phase: aiOrganize.phase, error: aiOrganize.error });
  }, [aiOrganize.error, aiOrganize.phase, onState]);

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

  it('routes assistant-backed organize runs through /api/assistant-runs', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<OrganizeHarness />);
      await new Promise(r => setTimeout(r, 0));
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledWith('/api/assistant-runs', expect.objectContaining({
      method: 'POST',
    }));
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request).toMatchObject({
      assistantId: 'inbox-organizer',
      providerOverride: 'p_capture',
      modelOverride: 'capture-model',
      uploadedFiles: [{ name: 'capture.md', content: 'source text' }],
    });
    expect(request).not.toHaveProperty('maxSteps');

    await act(async () => {
      root.unmount();
    });
  });

  it('rejects oversized organizer attachments before starting a request', async () => {
    const states: Array<{ phase: string; error: string | null }> = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<OversizedOrganizeHarness onState={state => states.push(state)} />);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(states.some(state => state.phase === 'error' && state.error?.includes('large.md'))).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });
});
