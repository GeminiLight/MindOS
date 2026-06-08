// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import MarkdownView from '@/components/MarkdownView';

describe('MarkdownView frontmatter rendering', () => {
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

  it('renders leading frontmatter as a collapsed properties panel and strips it from prose', async () => {
    await render(`---
title: Frontmatter Test
tags: [clip, reading]
source: "https://example.com/a:b"
draft: false
---

# Hello

Body`);

    const panel = host.querySelector('.markdown-frontmatter');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('Properties');
    expect(panel?.textContent).toContain('4 fields');
    expect(panel?.textContent).not.toContain('Frontmatter Test');

    const toggle = panel?.querySelector('button[aria-expanded]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');

    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(panel?.textContent).toContain('title');
    expect(panel?.textContent).toContain('Frontmatter Test');
    expect(panel?.textContent).toContain('clip');
    expect(panel?.textContent).toContain('reading');
    expect(panel?.textContent).toContain('https://example.com/a:b');
    expect(panel?.textContent).toContain('false');

    expect(host.querySelector('.prose h1')?.textContent).toBe('Hello');
    expect(host.querySelector('.prose')?.textContent).not.toContain('title: Frontmatter Test');
    expect(host.querySelectorAll('.prose hr')).toHaveLength(0);
  });

  it('does not show a properties panel when markdown has no leading frontmatter', async () => {
    await render('# Hello\n\n---\n\nA divider in the body.');

    expect(host.querySelector('.markdown-frontmatter')).toBeNull();
    expect(host.querySelector('.prose h1')?.textContent).toBe('Hello');
    expect(host.querySelectorAll('.prose hr')).toHaveLength(1);
  });

  it('keeps malformed frontmatter visible as markdown instead of hiding content', async () => {
    await render(`---
title: [broken
---

# Body`);

    expect(host.querySelector('.markdown-frontmatter')).toBeNull();
    expect(host.querySelector('.prose')?.textContent).toContain('title: [broken');
  });
});
