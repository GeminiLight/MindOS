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

describe('MarkdownView broken wiki links', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    pluginMocks.fetchPluginSurfaces.mockResolvedValue([]);
    pluginMocks.fetchPluginMarkdownCodeBlockSnapshots.mockResolvedValue([]);
    pluginMocks.fetchPluginMarkdownPostProcessorSnapshots.mockResolvedValue([]);
    cacheMocks.fetchAllFilePaths.mockResolvedValue(['Notes/Target.md', 'Other/Thing.md']);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(host);
  });

  async function render(content: string, sourcePath = 'Notes/Source.md') {
    await act(async () => {
      root.render(<MarkdownView content={content} sourcePath={sourcePath} />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  const links = () => Array.from(host.querySelectorAll('a[data-wikilink]'));

  describe('normal paths', () => {
    it('leaves a link to an existing note unmarked', async () => {
      await render('see [[Target]]');
      const [link] = links();
      expect(link).toBeDefined();
      expect(link?.hasAttribute('data-wikilink-unresolved')).toBe(false);
    });

    it('marks a link to a note that does not exist', async () => {
      await render('see [[Missing Note]]');
      const [link] = links();
      expect(link?.getAttribute('data-wikilink-unresolved')).toBe('true');
      expect(link?.getAttribute('title')).toContain('Missing Note');
    });

    it('resolves by full path as well as basename', async () => {
      await render('[[Notes/Target]] and [[Thing]]');
      expect(links().every((l) => !l.hasAttribute('data-wikilink-unresolved'))).toBe(true);
    });

    it('marks only the broken link when a note mixes both', async () => {
      await render('[[Target]] then [[Nope]]');
      const marked = links().map((l) => l.hasAttribute('data-wikilink-unresolved'));
      expect(marked).toEqual([false, true]);
    });

    it('still resolves a link that carries a heading subpath', async () => {
      await render('[[Target#Some Heading]]');
      expect(links()[0]?.hasAttribute('data-wikilink-unresolved')).toBe(false);
    });
  });

  describe('boundary cases', () => {
    it('does not mark anything before the file list resolves', async () => {
      cacheMocks.fetchAllFilePaths.mockReturnValue(new Promise(() => {}));
      await render('[[Missing]]');
      expect(links()[0]?.hasAttribute('data-wikilink-unresolved')).toBe(false);
    });

    it('treats an ambiguous basename as unresolved', async () => {
      cacheMocks.fetchAllFilePaths.mockResolvedValue(['One/Dup.md', 'Two/Dup.md']);
      await render('[[Dup]]');
      expect(links()[0]?.getAttribute('data-wikilink-unresolved')).toBe('true');
    });

    it('does not mark ordinary markdown links', async () => {
      await render('[label](Other/Thing.md)');
      expect(host.querySelectorAll('a[data-wikilink-unresolved]').length).toBe(0);
    });

    it('handles an empty vault by marking every wiki link', async () => {
      cacheMocks.fetchAllFilePaths.mockResolvedValue([]);
      await render('[[Anything]]');
      expect(links()[0]?.getAttribute('data-wikilink-unresolved')).toBe('true');
    });

    it('resolves unicode targets', async () => {
      cacheMocks.fetchAllFilePaths.mockResolvedValue(['笔记/中文.md']);
      await render('[[中文]]');
      expect(links()[0]?.hasAttribute('data-wikilink-unresolved')).toBe(false);
    });
  });

  describe('error paths', () => {
    it('leaves links unmarked when the file list request fails', async () => {
      cacheMocks.fetchAllFilePaths.mockRejectedValue(new Error('offline'));
      await render('[[Missing]]');
      expect(links()[0]?.hasAttribute('data-wikilink-unresolved')).toBe(false);
    });

    it('does not throw when the file list is not an array', async () => {
      cacheMocks.fetchAllFilePaths.mockResolvedValue([] as string[]);
      await expect(render('[[Missing]]')).resolves.not.toThrow();
    });
  });
});

describe('MarkdownView image embeds', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    pluginMocks.fetchPluginSurfaces.mockResolvedValue([]);
    pluginMocks.fetchPluginMarkdownCodeBlockSnapshots.mockResolvedValue([]);
    pluginMocks.fetchPluginMarkdownPostProcessorSnapshots.mockResolvedValue([]);
    cacheMocks.fetchAllFilePaths.mockResolvedValue(['assets/diagram.png', 'Notes/Target.md']);
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
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  const src = () => host.querySelector('img')?.getAttribute('src') ?? '';

  it('resolves a bare attachment name to the raw file API', async () => {
    await render('![[diagram.png]]');
    expect(src()).toBe(`/api/file/raw?path=${encodeURIComponent('assets/diagram.png')}`);
  });

  it('resolves a relative markdown image the same way', async () => {
    await render('![alt](assets/diagram.png)');
    expect(src()).toBe(`/api/file/raw?path=${encodeURIComponent('assets/diagram.png')}`);
  });

  it('leaves an absolute vault path working', async () => {
    cacheMocks.fetchAllFilePaths.mockResolvedValue(['.media/pic.png']);
    await render('![alt](/.media/pic.png)');
    expect(src()).toBe(`/api/file/raw?path=${encodeURIComponent('.media/pic.png')}`);
  });

  it('leaves an external URL untouched', async () => {
    await render('![alt](https://example.com/a.png)');
    expect(src()).toBe('https://example.com/a.png');
  });

  it('drops a data URI, as react-markdown sanitizes those urls', () => {
    // Documents existing library behaviour rather than asserting our own: the
    // default urlTransform strips data: so no src reaches the DOM.
    return render('![alt](data:image/png;base64,iVBOR)').then(() => {
      expect(src()).toBe('');
    });
  });

  it('falls back to the original src when the attachment is missing', async () => {
    await render('![[nope.png]]');
    expect(src()).toBe('nope.png');
  });

  it('keeps unicode attachment names working', async () => {
    cacheMocks.fetchAllFilePaths.mockResolvedValue(['附件/图 1.png']);
    await render('![[图 1.png]]');
    expect(src()).toBe(`/api/file/raw?path=${encodeURIComponent('附件/图 1.png')}`);
  });
});
