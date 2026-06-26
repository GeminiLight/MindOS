// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownView from '@/components/MarkdownView';

const pluginMocks = vi.hoisted(() => ({
  fetchPluginSurfaces: vi.fn(),
  fetchPluginMarkdownCodeBlockSnapshots: vi.fn(),
  fetchPluginMarkdownPostProcessorSnapshots: vi.fn(),
}));

vi.mock('@/lib/plugins/client', () => ({
  fetchPluginSurfaces: pluginMocks.fetchPluginSurfaces,
  fetchPluginMarkdownCodeBlockSnapshots: pluginMocks.fetchPluginMarkdownCodeBlockSnapshots,
  fetchPluginMarkdownPostProcessorSnapshots: pluginMocks.fetchPluginMarkdownPostProcessorSnapshots,
}));

describe('MarkdownView frontmatter rendering', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    pluginMocks.fetchPluginSurfaces.mockResolvedValue([]);
    pluginMocks.fetchPluginMarkdownCodeBlockSnapshots.mockResolvedValue([]);
    pluginMocks.fetchPluginMarkdownPostProcessorSnapshots.mockResolvedValue([]);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(host);
  });

  async function render(content: string, sourcePath = '') {
    await act(async () => {
      root.render(<MarkdownView content={content} sourcePath={sourcePath} />);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function flushIdleWork() {
    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.resolve();
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

  it('routes local markdown links through the app view instead of opening them as external links', async () => {
    await render('[Sibling](other.md) [Nested](./sub/next.md#Part) [External](https://example.com/other.md)', 'Notes/source.md');

    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('.prose a'));
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      '/view/Notes/other.md',
      '/view/Notes/sub/next.md#Part',
      'https://example.com/other.md',
    ]);
    expect(links[0].getAttribute('target')).toBeNull();
    expect(links[1].getAttribute('target')).toBeNull();
    expect(links[2].getAttribute('target')).toBe('_blank');
  });

  it('keeps malformed frontmatter visible as markdown instead of hiding content', async () => {
    await render(`---
title: [broken
---

# Body`);

    expect(host.querySelector('.markdown-frontmatter')).toBeNull();
    expect(host.querySelector('.prose')?.textContent).toContain('title: [broken');
  });

  it('queries markdown surfaces for document hooks without running code block snapshots when there are no fenced code blocks', async () => {
    await render('# Plain note\n\nNo code here.');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pluginMocks.fetchPluginSurfaces).toHaveBeenCalledWith('kind=markdown&source=obsidian');
    expect(pluginMocks.fetchPluginMarkdownCodeBlockSnapshots).not.toHaveBeenCalled();
    expect(pluginMocks.fetchPluginMarkdownPostProcessorSnapshots).not.toHaveBeenCalled();
  });

  it('renders text snapshots for Obsidian markdown post processors', async () => {
    pluginMocks.fetchPluginSurfaces.mockResolvedValueOnce([
      {
        id: 'obsidian:markdown-post:structure',
        source: 'obsidian',
        kind: 'markdown',
        location: 'document',
        availability: 'available',
        pluginId: 'structure',
        pluginName: 'Structure Renderer',
        title: 'Structure Renderer markdown post processors',
        host: {
          state: 'mounted',
          label: 'Document rendering host',
          description: 'Rendered as a sanitized text snapshot for the current document.',
        },
        metadata: { processorType: 'post', count: 1 },
      },
    ]);
    pluginMocks.fetchPluginMarkdownPostProcessorSnapshots.mockResolvedValueOnce([
      {
        processorId: 'structure:post:1',
        pluginId: 'structure',
        pluginName: 'Structure Renderer',
        text: 'Detected document outline\n- Plain note',
      },
    ]);

    await render('# Plain note\n\nNo code here.');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await flushIdleWork();
    });

    expect(pluginMocks.fetchPluginMarkdownPostProcessorSnapshots).toHaveBeenCalledWith('# Plain note\n\nNo code here.', '');
    const postSnapshot = host.querySelector('[data-plugin-markdown-post-processors]');
    expect(postSnapshot).not.toBeNull();
    expect(postSnapshot?.textContent).toContain('Obsidian post-process snapshot');
    expect(postSnapshot?.textContent).toContain('Structure Renderer');
    expect(postSnapshot?.textContent).toContain('Detected document outline');
  });

  it('renders text snapshots for fenced code blocks that match Obsidian markdown hook surfaces', async () => {
    pluginMocks.fetchPluginSurfaces.mockResolvedValueOnce([
      {
        id: 'obsidian:markdown-code:daily:tasks',
        source: 'obsidian',
        kind: 'markdown',
        location: 'document',
        availability: 'available',
        pluginId: 'daily',
        pluginName: 'Daily Notes',
        title: '```tasks',
        host: {
          state: 'mounted',
          label: 'Document rendering host',
          description: 'Rendered as a sanitized text snapshot next to matching fenced code blocks.',
        },
        metadata: { language: 'tasks' },
      },
    ]);
    pluginMocks.fetchPluginMarkdownCodeBlockSnapshots.mockImplementationOnce(async (blocks: Array<{ id: string; language: string }>) => (
      blocks.map((block) => ({
        id: block.id,
        language: block.language,
        renders: [
          {
            processorId: `daily:${block.language}:1`,
            pluginId: 'daily',
            pluginName: 'Daily Notes',
            language: block.language,
            text: 'Rendered tasks\n- [ ] Review plugin hooks',
          },
        ],
      }))
    ));

    await render('```tasks\n- [ ] Review plugin hooks\n```');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pluginMocks.fetchPluginSurfaces).toHaveBeenCalledWith('kind=markdown&source=obsidian');
    expect(pluginMocks.fetchPluginMarkdownCodeBlockSnapshots).toHaveBeenCalledWith([
      expect.objectContaining({
        language: 'tasks',
        source: '- [ ] Review plugin hooks',
      }),
    ]);
    const hook = host.querySelector('[data-plugin-markdown-hook="tasks"]');
    expect(hook).not.toBeNull();
    expect(hook?.textContent).toContain('Obsidian hook: Daily Notes');
    expect(hook?.textContent).toContain('Mounted');
    expect(hook?.className).toContain('mb-2');
    expect(hook?.className).not.toContain('absolute');
    const renderSnapshot = host.querySelector('[data-plugin-markdown-render="tasks"]');
    expect(renderSnapshot).not.toBeNull();
    expect(renderSnapshot?.textContent).toContain('Obsidian render snapshot');
    expect(renderSnapshot?.textContent).toContain('Daily Notes');
    expect(renderSnapshot?.textContent).toContain('Rendered tasks');
    expect(Array.from(host.querySelectorAll('pre')).some((pre) => pre.className.includes('!pt-16'))).toBe(false);
  });

  it('keeps the markdown hook badge floating when no render snapshot is available', async () => {
    pluginMocks.fetchPluginSurfaces.mockResolvedValueOnce([
      {
        id: 'obsidian:markdown-code:daily:tasks',
        source: 'obsidian',
        kind: 'markdown',
        location: 'document',
        availability: 'available',
        pluginId: 'daily',
        pluginName: 'Daily Notes',
        title: '```tasks',
        host: {
          state: 'mounted',
          label: 'Document rendering host',
          description: 'Rendered as a sanitized text snapshot next to matching fenced code blocks.',
        },
        metadata: { language: 'tasks' },
      },
    ]);
    pluginMocks.fetchPluginMarkdownCodeBlockSnapshots.mockResolvedValueOnce([
      { id: 'tasks-1', language: 'tasks', renders: [] },
    ]);

    await render('```tasks\n- [ ] Review plugin hooks\n```');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const hook = host.querySelector('[data-plugin-markdown-hook="tasks"]');
    expect(hook?.className).toContain('absolute');
    expect(host.querySelector('[data-plugin-markdown-render="tasks"]')).toBeNull();
    expect(Array.from(host.querySelectorAll('pre')).some((pre) => pre.className.includes('!pt-16'))).toBe(true);
  });

  it('queries plugin markdown hooks for tilde fenced code blocks', async () => {
    await render('~~~tasks\n- [ ] Review plugin hooks\n~~~');

    expect(pluginMocks.fetchPluginSurfaces).toHaveBeenCalledWith('kind=markdown&source=obsidian');
  });
});
