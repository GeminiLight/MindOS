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
const cacheMocks = vi.hoisted(() => ({ fetchAllFilePaths: vi.fn() }));

vi.mock('@/lib/plugins/client', () => ({
  fetchPluginSurfaces: pluginMocks.fetchPluginSurfaces,
  fetchPluginMarkdownCodeBlockSnapshots: pluginMocks.fetchPluginMarkdownCodeBlockSnapshots,
  fetchPluginMarkdownPostProcessorSnapshots: pluginMocks.fetchPluginMarkdownPostProcessorSnapshots,
}));
vi.mock('@/lib/client-cache', () => ({ fetchAllFilePaths: cacheMocks.fetchAllFilePaths }));

const EMBEDDED = `---
title: Target
---
intro line

# Section A

section a body with a link [[Other]]

# Section B

section b body
`;

describe('MarkdownView note embeds', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    pluginMocks.fetchPluginSurfaces.mockResolvedValue([]);
    pluginMocks.fetchPluginMarkdownCodeBlockSnapshots.mockResolvedValue([]);
    pluginMocks.fetchPluginMarkdownPostProcessorSnapshots.mockResolvedValue([]);
    cacheMocks.fetchAllFilePaths.mockResolvedValue(['Notes/Target.md', 'Notes/Source.md']);
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: EMBEDDED }) });
    vi.stubGlobal('fetch', fetchMock);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(host);
    vi.unstubAllGlobals();
  });

  async function render(content: string) {
    await act(async () => {
      root.render(<MarkdownView content={content} sourcePath="Notes/Source.md" />);
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
  }

  const embed = () => host.querySelector('.markdown-embed');

  describe('normal paths', () => {
    it('renders a standalone note embed as a block with the note body', async () => {
      await render('![[Target]]');
      expect(embed()).not.toBeNull();
      expect(embed()?.textContent).toContain('intro line');
      expect(embed()?.textContent).toContain('section b body');
    });

    it('strips the embedded note frontmatter', async () => {
      await render('![[Target]]');
      expect(embed()?.textContent).not.toContain('title: Target');
    });

    it('embeds only the requested heading section', async () => {
      await render('![[Target#Section A]]');
      expect(embed()?.textContent).toContain('section a body');
      expect(embed()?.textContent).not.toContain('section b body');
      expect(embed()?.textContent).not.toContain('intro line');
    });

    it('links the embed title to the source note', async () => {
      await render('![[Target]]');
      const link = embed()?.querySelector('.markdown-embed-title a');
      expect(link?.getAttribute('href')).toBe('/view/Notes/Target.md');
    });

    it('reads the resolved path, not the raw target', async () => {
      await render('![[Target]]');
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/file?path=${encodeURIComponent('Notes/Target.md')}&op=read_file`,
      );
    });

    it('renders wiki links inside the embedded content', async () => {
      await render('![[Target]]');
      expect(embed()?.querySelector('a[data-wikilink="Other"]')).not.toBeNull();
    });
  });

  describe('boundary cases', () => {
    it('keeps an inline embed as a link rather than a block', async () => {
      await render('see ![[Target]] inline');
      expect(embed()).toBeNull();
      expect(host.querySelector('a[data-wikilink-embed]')).not.toBeNull();
    });

    it('does not recurse: an embed inside embedded content stays a link', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ content: '![[Target]]' }) });
      await render('![[Target]]');
      // One fetch for the outer embed only.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reports a missing note', async () => {
      await render('![[Nope]]');
      expect(embed()?.textContent).toContain('未找到');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports a missing heading section', async () => {
      await render('![[Target#No Such Heading]]');
      expect(embed()?.textContent).toContain('未找到');
    });

    it('still renders an image embed as an image, not a note embed', async () => {
      cacheMocks.fetchAllFilePaths.mockResolvedValue(['assets/pic.png']);
      await render('![[pic.png]]');
      expect(embed()).toBeNull();
      expect(host.querySelector('img')).not.toBeNull();
    });
  });

  describe('error paths', () => {
    it('reports a read failure without breaking the page', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
      await render('![[Target]]');
      expect(embed()?.textContent).toContain('无法读取');
    });

    it('reports a network failure', async () => {
      fetchMock.mockRejectedValue(new Error('offline'));
      await render('![[Target]]');
      expect(embed()?.textContent).toContain('无法读取');
    });

    it('tolerates an empty response body', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
      await render('![[Target]]');
      expect(embed()).not.toBeNull();
    });
  });
});
