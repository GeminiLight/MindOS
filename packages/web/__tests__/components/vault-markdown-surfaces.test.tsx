// @vitest-environment jsdom
/**
 * Cross-surface contract for vault markdown.
 *
 * The same Obsidian-flavoured snippet is rendered by three surfaces: the note
 * reading view, a note embedded with `![[...]]`, and a canvas text node. Each
 * used to wire its own remark plugins and component overrides, and they drifted
 * — embeds and canvas silently lost image resolution, tags, block anchors and
 * broken-link marking. This test pins that every surface renders the snippet
 * identically, so adding a syntax in one place cannot leave the others behind.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownView from '@/components/MarkdownView';
import { CanvasRenderer } from '@/components/renderers/canvas/CanvasRenderer';

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

const VAULT = ['Notes/Source.md', 'Notes/Embedded.md', 'Deep/Target.md', 'assets/pic.png'];

// Every syntax the vault renderer is responsible for, in one snippet.
const SNIPPET = [
  'Link [[Target]] and missing [[Nowhere]].',
  '',
  'Tag #project here.',
  '',
  '![[pic.png]]',
  '',
  'Anchored paragraph ^anchor-1',
].join('\n');

type Surface = { name: string; render: () => React.ReactElement };

const SURFACES: Surface[] = [
  {
    name: 'reading view',
    render: () => <MarkdownView content={SNIPPET} sourcePath="Notes/Source.md" />,
  },
  {
    name: 'note embed',
    render: () => <MarkdownView content="![[Embedded]]" sourcePath="Notes/Source.md" />,
  },
  {
    name: 'canvas text node',
    render: () => (
      <CanvasRenderer
        filePath="Board.canvas"
        extension="canvas"
        saveAction={async () => {}}
        content={JSON.stringify({
          nodes: [{ id: 'n', type: 'text', text: SNIPPET, x: 0, y: 0, width: 600, height: 600 }],
          edges: [],
        })}
      />
    ),
  },
];

describe('vault markdown renders identically on every surface', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    pluginMocks.fetchPluginSurfaces.mockResolvedValue([]);
    pluginMocks.fetchPluginMarkdownCodeBlockSnapshots.mockResolvedValue([]);
    pluginMocks.fetchPluginMarkdownPostProcessorSnapshots.mockResolvedValue([]);
    cacheMocks.fetchAllFilePaths.mockResolvedValue(VAULT);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: SNIPPET }),
    }));
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

  async function mount(surface: Surface) {
    await act(async () => {
      root.render(surface.render());
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
  }

  for (const surface of SURFACES) {
    describe(surface.name, () => {
      it('navigates a wiki link to the note where it actually lives', async () => {
        await mount(surface);
        // `[[Target]]` resolves by basename to Deep/Target.md, not to a sibling
        // of the source note.
        const link = host.querySelector('a[data-wikilink="Target"]');
        expect(link?.getAttribute('href')).toBe('/view/Deep/Target.md');
        expect(link?.hasAttribute('data-wikilink-unresolved')).toBe(false);
      });

      it('marks a link to a missing note', async () => {
        await mount(surface);
        expect(host.querySelector('a[data-wikilink="Nowhere"]')?.getAttribute('data-wikilink-unresolved')).toBe('true');
      });

      it('renders an inline tag as a chip', async () => {
        await mount(surface);
        expect(host.querySelector('button.markdown-tag[data-tag="project"]')).not.toBeNull();
      });

      it('resolves a bare attachment name to the raw file API', async () => {
        await mount(surface);
        expect(host.querySelector('img')?.getAttribute('src'))
          .toBe(`/api/file/raw?path=${encodeURIComponent('assets/pic.png')}`);
      });

      it('hides the block id marker and anchors the block', async () => {
        await mount(surface);
        expect(host.querySelector('[id="block-anchor-1"]')).not.toBeNull();
        expect(host.textContent).not.toContain('^anchor-1');
      });
    });
  }
});

describe('embeds stay single-level', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    pluginMocks.fetchPluginSurfaces.mockResolvedValue([]);
    pluginMocks.fetchPluginMarkdownCodeBlockSnapshots.mockResolvedValue([]);
    pluginMocks.fetchPluginMarkdownPostProcessorSnapshots.mockResolvedValue([]);
    cacheMocks.fetchAllFilePaths.mockResolvedValue(VAULT);
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: '![[Target]]' }) });
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

  it('renders a nested embed as a navigable link, not as content', async () => {
    await act(async () => {
      root.render(<MarkdownView content="![[Embedded]]" sourcePath="Notes/Source.md" />);
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('.markdown-embed')).toHaveLength(1);
    const nested = host.querySelector('.markdown-embed-body a[data-wikilink="Target"]');
    expect(nested?.getAttribute('href')).toBe('/view/Deep/Target.md');
  });
});
