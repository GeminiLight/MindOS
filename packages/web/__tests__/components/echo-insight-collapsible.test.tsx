// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EchoInsightCollapsible } from '@/components/echo/EchoInsightCollapsible';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const consumeUIMessageStreamMock = vi.hoisted(() => vi.fn(async (_body, onUpdate: (message: { role: string; content: string }) => void) => {
  onUpdate({ role: 'assistant', content: '# Imprint\n\n## Facts\n\nGenerated.' });
  return { role: 'assistant', content: '# Imprint\n\n## Facts\n\nGenerated.' };
}));

vi.mock('@/hooks/useSettingsAiAvailable', () => ({
  useSettingsAiAvailable: () => ({ ready: true, loading: false }),
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      hints: {
        aiNotConfigured: 'AI is not configured.',
        generationInProgress: 'Generation is in progress.',
      },
    },
  }),
}));

vi.mock('@/lib/agent/stream-consumer', () => ({
  consumeUIMessageStream: consumeUIMessageStreamMock,
}));

describe('EchoInsightCollapsible', () => {
  let host: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    fetchMock = vi.fn(async () => new Response('event-stream', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    consumeUIMessageStreamMock.mockClear();
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    host?.remove();
    vi.unstubAllGlobals();
  });

  it('stays hidden before a page-level action triggers generation', async () => {
    await act(async () => {
      root.render(
        <EchoInsightCollapsible
          noAiHint="No AI"
          generatingLabel="Generating"
          errorPrefix="Error:"
          retryLabel="Retry"
          assistantId="echo-imprint"
          userPrompt="Visible Echo context"
          maxSteps={10}
        />,
      );
    });

    expect(host.textContent).toBe('');
    expect(host.querySelector('button')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs Echo generation through assistant-runs when page-level action fires', async () => {
    await act(async () => {
      root.render(
        <EchoInsightCollapsible
          noAiHint="No AI"
          generatingLabel="Generating"
          errorPrefix="Error:"
          retryLabel="Retry"
          assistantId="echo-threader"
          userPrompt="Visible thread context"
          generateSignal={0}
          maxSteps={8}
        />,
      );
    });

    expect(host.textContent).not.toContain('Assistant draft');
    expect(host.textContent).not.toContain('Generate');

    await act(async () => {
      root.render(
        <EchoInsightCollapsible
          noAiHint="No AI"
          generatingLabel="Generating"
          errorPrefix="Error:"
          retryLabel="Retry"
          assistantId="echo-threader"
          userPrompt="Visible thread context"
          generateSignal={1}
          maxSteps={8}
        />,
      );
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/assistant-runs', expect.objectContaining({
      method: 'POST',
    }));
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toMatchObject({
      assistantId: 'echo-threader',
      permissionMode: 'read',
      maxSteps: 8,
      messages: [{ role: 'user', content: 'Visible thread context' }],
    });
    expect(host.querySelector('button')).toBeNull();
    expect(host.textContent).not.toContain('Assistant draft');
    expect(host.textContent).toContain('Generated.');
  });
});
