// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownView from '@/components/MarkdownView';
import { SEARCH_QUERY_REQUEST_EVENT } from '@/lib/search-events';

const pluginMocks = vi.hoisted(() => ({
  fetchPluginSurfaces: vi.fn(),
  fetchPluginMarkdownCodeBlockSnapshots: vi.fn(),
  fetchPluginMarkdownPostProcessorSnapshots: vi.fn(),
}));
const cacheMocks = vi.hoisted(() => ({ fetchAllFilePaths: vi.fn() }));

vi.mock('@/lib/plugins/client', () => ({
  fetchPluginSurfaces: pluginMocks.fetchPluginSurfaces,
  fetchPluginMarkdownCodeBlockSnapshots: pluginMocks.fetchPluginMarkdownCodeBlockSnapshots,
  fetchPluginMarkdownPostProcessorSnapshots: pluginMocks.fetchPluginMarkdownPostProcessorSnapshots,
}));
vi.mock('@/lib/client-cache', () => ({ fetchAllFilePaths: cacheMocks.fetchAllFilePaths }));

describe('MarkdownView inline tags and block ids', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    pluginMocks.fetchPluginSurfaces.mockResolvedValue([]);
    pluginMocks.fetchPluginMarkdownCodeBlockSnapshots.mockResolvedValue([]);
    pluginMocks.fetchPluginMarkdownPostProcessorSnapshots.mockResolvedValue([]);
    cacheMocks.fetchAllFilePaths.mockResolvedValue(['Notes/Target.md']);
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
      root.render(<MarkdownView content={content} sourcePath="Notes/Source.md" />);
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });
  }

  const chips = () => Array.from(host.querySelectorAll('button.markdown-tag'));

  describe('inline tags', () => {
    it('renders a tag as a chip showing the hash', async () => {
      await render('about #project today');
      expect(chips()).toHaveLength(1);
      expect(chips()[0]?.getAttribute('data-tag')).toBe('project');
      expect(chips()[0]?.textContent).toBe('#project');
    });

    it('requests a search for the tag on click', async () => {
      const seen: string[] = [];
      const listener = (event: Event) => seen.push((event as CustomEvent).detail.query);
      window.addEventListener(SEARCH_QUERY_REQUEST_EVENT, listener);
      try {
        await render('#project');
        await act(async () => { (chips()[0] as HTMLButtonElement).click(); });
        expect(seen).toEqual(['#project']);
      } finally {
        window.removeEventListener(SEARCH_QUERY_REQUEST_EVENT, listener);
      }
    });

    it('renders nested and unicode tags', async () => {
      await render('#work/alpha and #中文标签');
      expect(chips().map((c) => c.getAttribute('data-tag'))).toEqual(['work/alpha', '中文标签']);
    });

    it('does not treat a heading as a tag', async () => {
      await render('# Heading\n\nbody');
      expect(chips()).toHaveLength(0);
      expect(host.querySelector('h1')?.textContent).toContain('Heading');
    });

    it('does not treat a purely numeric hash as a tag', async () => {
      await render('issue #1 and #2024');
      expect(chips()).toHaveLength(0);
    });

    it('does not linkify a tag inside code', async () => {
      await render('```\n#project\n```\n\ninline `#project`');
      expect(chips()).toHaveLength(0);
    });

    it('leaves a wiki link alone', async () => {
      await render('[[Target]] and #project');
      expect(host.querySelector('a[data-wikilink="Target"]')).not.toBeNull();
      expect(chips()).toHaveLength(1);
    });
  });

  describe('block ids', () => {
    it('hides the marker and anchors the block', async () => {
      await render('A paragraph ^block-1');
      const p = host.querySelector('p[id="block-block-1"]');
      expect(p).not.toBeNull();
      expect(p?.textContent).toBe('A paragraph');
      expect(host.textContent).not.toContain('^block-1');
    });

    it('anchors a list item', async () => {
      await render('- item one ^bid\n- item two');
      expect(host.querySelector('li[id="block-bid"]')).not.toBeNull();
      expect(host.textContent).not.toContain('^bid');
    });

    it('leaves a caret that is not a marker as text', async () => {
      await render('math like a ^ b stays');
      expect(host.textContent).toContain('a ^ b');
    });

    it('links a block reference at the new anchor', async () => {
      await render('see [[Target#^abc]]');
      const link = host.querySelector('a[data-wikilink="Target"]');
      expect(link?.getAttribute('href')).toBe('/view/Notes/Target.md#block-abc');
    });
  });
});
