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

  it('runs Echo generation through the assistant-runs endpoint', async () => {
    await act(async () => {
      root.render(
        <EchoInsightCollapsible
          title="Insight"
          showLabel="Show"
          hideLabel="Hide"
          hint="Generate from context."
          generateLabel="Generate"
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

    const toggle = host.querySelector('button[aria-expanded="false"]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    await act(async () => {
      toggle.click();
    });

    const generate = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Generate')) as HTMLButtonElement;
    expect(generate).toBeTruthy();
    await act(async () => {
      generate.click();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/assistant-runs', expect.objectContaining({
      method: 'POST',
    }));
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      assistantId: 'echo-imprint',
      permissionMode: 'read',
      maxSteps: 10,
      messages: [{ role: 'user', content: 'Visible Echo context' }],
    });
    expect(consumeUIMessageStreamMock).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Generated.');
  });

  it('lets a page-level action trigger generation and open the result panel', async () => {
    await act(async () => {
      root.render(
        <EchoInsightCollapsible
          title="Assistant draft"
          showLabel="Show"
          hideLabel="Hide"
          hint="Generate from context."
          generateLabel="Generate"
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

    expect(host.querySelector('button[aria-expanded="false"]')).toBeTruthy();

    await act(async () => {
      root.render(
        <EchoInsightCollapsible
          title="Assistant draft"
          showLabel="Show"
          hideLabel="Hide"
          hint="Generate from context."
          generateLabel="Generate"
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

    expect(host.querySelector('button[aria-expanded="true"]')).toBeTruthy();
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
    expect(host.textContent).toContain('Generated.');
  });
});
