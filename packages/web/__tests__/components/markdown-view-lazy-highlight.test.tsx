// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownView from '@/components/MarkdownView';

describe('MarkdownView lazy syntax highlighting', () => {
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

  async function render(content: string) {
    await act(async () => {
      root.render(<MarkdownView content={content} />);
    });
  }

  async function flushAsync() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('renders code immediately and applies highlight.js classes once the plugin loads', async () => {
    await render('```js\nconst answer = 42;\n```');

    // Content is never blocked on the highlighter chunk.
    await vi.waitFor(async () => {
      await flushAsync();
      expect(host.textContent).toContain('const answer = 42;');
    });

    // After the dynamic rehype-highlight import resolves, code gets highlighted.
    await vi.waitFor(
      async () => {
        await flushAsync();
        expect(host.querySelector('code.hljs')).not.toBeNull();
        expect(host.querySelector('.hljs-keyword')).not.toBeNull();
      },
      { timeout: 5000 },
    );
  });

  it('still renders non-code markdown when no highlighting is involved', async () => {
    await render('# Title\n\nSome **bold** text');

    await vi.waitFor(async () => {
      await flushAsync();
      expect(host.querySelector('h1')?.textContent).toBe('Title');
      expect(host.querySelector('strong')?.textContent).toBe('bold');
    });
  });
});
