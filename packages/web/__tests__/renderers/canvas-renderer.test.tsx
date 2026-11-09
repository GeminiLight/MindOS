/**
 * Rendering contract for the read-only JSON Canvas viewer.
 *
 * Parsing itself is covered in `@geminilight/mindos`; these tests pin what the
 * viewer actually puts on screen for each node type, plus the degraded states.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { CanvasRenderer } from '@/components/renderers/canvas/CanvasRenderer';
import type { RendererContext } from '@/lib/renderers/registry';

function render(content: string): string {
  const ctx: RendererContext = {
    filePath: 'Board.canvas',
    content,
    extension: 'canvas',
    saveAction: async () => {},
  };
  return renderToStaticMarkup(createElement(CanvasRenderer, ctx));
}

const node = (over: Record<string, unknown> = {}) => ({
  id: 'n1', type: 'text', text: 'hello', x: 0, y: 0, width: 200, height: 100, ...over,
});

const doc = (over: Record<string, unknown>) => JSON.stringify({ nodes: [], edges: [], ...over });

describe('canvas renderer registration', () => {
  it('resolves .canvas files to the canvas renderer', async () => {
    await import('@/lib/renderers/index');
    const { resolveRenderer } = await import('@/lib/renderers/registry');
    expect(resolveRenderer('Boards/Plan.canvas', 'canvas')?.id).toBe('canvas');
  });

  it('does not claim markdown files', async () => {
    await import('@/lib/renderers/index');
    const { resolveRenderer } = await import('@/lib/renderers/registry');
    expect(resolveRenderer('Notes/A.md', 'md')?.id).not.toBe('canvas');
  });
});

describe('CanvasRenderer', () => {
  describe('normal paths', () => {
    it('renders a text node as markdown', () => {
      const html = render(doc({ nodes: [node({ text: '# Heading\n\nbody' })] }));
      expect(html).toContain('Heading');
      expect(html).toContain('body');
    });

    it('renders wiki links inside a text node as navigable view links', () => {
      // Text nodes go through the shared vault renderer, so a link gets a real
      // /view/ href instead of a bare relative `Target.md` the browser would 404.
      const html = render(doc({ nodes: [node({ text: 'see [[Target]]' })] }));
      expect(html).toContain('data-wikilink="Target"');
      expect(html).toContain('href="/view/Target.md"');
    });

    it('embeds a markdown file node instead of only naming it', () => {
      const html = render(doc({ nodes: [node({ type: 'file', file: 'Notes/A.md', text: undefined })] }));
      // The note body arrives asynchronously; what the static render must show
      // is the embed frame with the source note as its title.
      expect(html).toContain('markdown-embed');
      expect(html).toContain('Notes/A.md');
    });

    it('still links a non-markdown, non-image file node by name', () => {
      const html = render(doc({ nodes: [node({ type: 'file', file: 'docs/spec.pdf', text: undefined })] }));
      expect(html).toContain('href="/view/docs/spec.pdf"');
      expect(html).toContain('spec.pdf');
      expect(html).not.toContain('markdown-embed');
    });

    it('renders an image file node as an img', () => {
      const html = render(doc({ nodes: [node({ type: 'file', file: 'assets/pic.png', text: undefined })] }));
      expect(html).toContain('<img');
      expect(html).toContain('pic.png');
    });

    it('renders a link node as an external anchor', () => {
      const html = render(doc({ nodes: [node({ type: 'link', url: 'https://example.com', text: undefined })] }));
      expect(html).toContain('https://example.com');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
    });

    it('renders a group label', () => {
      const html = render(doc({ nodes: [node({ type: 'group', label: 'Section A', text: undefined })] }));
      expect(html).toContain('Section A');
    });

    it('draws an edge path with an arrow marker', () => {
      const html = render(doc({
        nodes: [node(), node({ id: 'n2', x: 400 })],
        edges: [{ id: 'e1', fromNode: 'n1', toNode: 'n2' }],
      }));
      expect(html).toContain('<path');
      expect(html).toContain('url(#canvas-arrow)');
    });

    it('renders an edge label', () => {
      const html = render(doc({
        nodes: [node(), node({ id: 'n2', x: 400 })],
        edges: [{ id: 'e1', fromNode: 'n1', toNode: 'n2', label: 'leads to' }],
      }));
      expect(html).toContain('leads to');
    });

    it('applies a preset colour as a css variable and hex verbatim', () => {
      const html = render(doc({ nodes: [node({ color: '4' }), node({ id: 'n2', color: '#ff0000', x: 300 })] }));
      expect(html).toContain('var(--canvas-4)');
      expect(html).toContain('#ff0000');
    });

    it('reports node and edge counts', () => {
      const html = render(doc({
        nodes: [node(), node({ id: 'n2', x: 400 })],
        edges: [{ id: 'e1', fromNode: 'n1', toNode: 'n2' }],
      }));
      expect(html).toContain('2 个节点');
      expect(html).toContain('1 条连线');
    });

    it('marks the surface as read-only', () => {
      expect(render(doc({ nodes: [node()] }))).toContain('只读');
    });
  });

  describe('boundary cases', () => {
    it('shows an empty state when there are no nodes', () => {
      expect(render(doc({ nodes: [] }))).toContain('还没有内容');
    });

    it('reports skipped entries', () => {
      const html = render(doc({ nodes: [node(), { id: 'bad', type: 'text', text: 'x' }] }));
      expect(html).toContain('1 项无法读取已跳过');
    });

    it('does not mention skipped entries when everything parsed', () => {
      expect(render(doc({ nodes: [node()] }))).not.toContain('无法读取');
    });

    it('handles negative coordinates without negative offsets', () => {
      const html = render(doc({ nodes: [node({ x: -500, y: -300 })] }));
      expect(html).not.toMatch(/left:\s*-/);
      expect(html).not.toMatch(/top:\s*-/);
    });

    it('renders unicode text', () => {
      expect(render(doc({ nodes: [node({ text: '中文 🎉' })] }))).toContain('中文 🎉');
    });

    it('ignores an edge whose endpoint was dropped', () => {
      const html = render(doc({ nodes: [node()], edges: [{ id: 'e1', fromNode: 'n1', toNode: 'ghost' }] }));
      expect(html).toContain('0 条连线');
    });
  });

  describe('error paths', () => {
    it('shows a readable error for invalid JSON', () => {
      const html = render('{ not json');
      expect(html).toContain('无法读取这个 canvas 文件');
      expect(html).toMatch(/Invalid JSON/i);
    });

    it('shows an error for a non-object top level', () => {
      expect(render('[]')).toContain('无法读取这个 canvas 文件');
    });

    it('treats an empty file as an empty canvas, not an error', () => {
      const html = render('');
      expect(html).toContain('还没有内容');
      expect(html).not.toContain('无法读取');
    });
  });
});
