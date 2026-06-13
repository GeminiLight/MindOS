// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import EchoInsightMarkdown from '@/components/echo/EchoInsightMarkdown';

describe('EchoInsightMarkdown', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(host);
  });

  it('renders GFM markdown content (bold, lists)', async () => {
    await act(async () => {
      root.render(<EchoInsightMarkdown markdown={'**insight**\n\n- first\n- second'} />);
    });

    expect(host.querySelector('strong')?.textContent).toBe('insight');
    const items = Array.from(host.querySelectorAll('li')).map((li) => li.textContent);
    expect(items).toEqual(['first', 'second']);
  });

  it('renders plain paragraphs for empty-ish input without crashing', async () => {
    await act(async () => {
      root.render(<EchoInsightMarkdown markdown="" />);
    });
    expect(host.textContent).toBe('');
  });
});
