import { describe, expect, it } from 'vitest';
import { parseJsonCanvas } from './json-canvas.js';

const node = (over: Record<string, unknown> = {}) => ({
  id: 'n1', type: 'text', text: 'hello', x: 0, y: 0, width: 100, height: 50, ...over,
});

const canvas = (over: Record<string, unknown> = {}) => JSON.stringify({ nodes: [], edges: [], ...over });

describe('parseJsonCanvas', () => {
  describe('normal paths', () => {
    it('parses a text node', () => {
      const result = parseJsonCanvas(canvas({ nodes: [node()] }));
      expect(result.ok).toBe(true);
      expect(result.canvas?.nodes[0]).toMatchObject({
        id: 'n1', type: 'text', text: 'hello', x: 0, y: 0, width: 100, height: 50,
      });
    });

    it('parses a file node with a subpath', () => {
      const result = parseJsonCanvas(canvas({
        nodes: [node({ type: 'file', file: 'Notes/A.md', subpath: '#Heading', text: undefined })],
      }));
      expect(result.canvas?.nodes[0]).toMatchObject({ type: 'file', file: 'Notes/A.md', subpath: '#Heading' });
    });

    it('parses link and group nodes', () => {
      const result = parseJsonCanvas(canvas({
        nodes: [
          node({ id: 'l', type: 'link', url: 'https://example.com', text: undefined }),
          node({ id: 'g', type: 'group', label: 'Section', text: undefined }),
        ],
      }));
      expect(result.canvas?.nodes.map((n) => n.type)).toEqual(['link', 'group']);
      expect(result.canvas?.nodes[1]).toMatchObject({ label: 'Section' });
    });

    it('parses an edge with sides, ends and label', () => {
      const result = parseJsonCanvas(canvas({
        nodes: [node(), node({ id: 'n2' })],
        edges: [{ id: 'e1', fromNode: 'n1', fromSide: 'right', toNode: 'n2', toSide: 'left', toEnd: 'arrow', label: 'leads to' }],
      }));
      expect(result.canvas?.edges[0]).toMatchObject({
        id: 'e1', fromNode: 'n1', fromSide: 'right', toNode: 'n2', toSide: 'left', toEnd: 'arrow', label: 'leads to',
      });
    });

    it('defaults edge ends to the spec values', () => {
      const result = parseJsonCanvas(canvas({
        nodes: [node(), node({ id: 'n2' })],
        edges: [{ id: 'e1', fromNode: 'n1', toNode: 'n2' }],
      }));
      expect(result.canvas?.edges[0]).toMatchObject({ fromEnd: 'none', toEnd: 'arrow' });
    });

    it('keeps preset and hex colors', () => {
      const result = parseJsonCanvas(canvas({
        nodes: [node({ color: '4' }), node({ id: 'n2', color: '#FF0000' })],
      }));
      expect(result.canvas?.nodes.map((n) => n.color)).toEqual(['4', '#FF0000']);
    });

    it('computes the bounding box over all nodes', () => {
      const result = parseJsonCanvas(canvas({
        nodes: [node({ x: -50, y: -20, width: 100, height: 40 }), node({ id: 'n2', x: 200, y: 100, width: 60, height: 30 })],
      }));
      expect(result.canvas?.bounds).toEqual({ minX: -50, minY: -20, maxX: 260, maxY: 130 });
    });

    it('accepts a canvas with no edges key', () => {
      const result = parseJsonCanvas(JSON.stringify({ nodes: [node()] }));
      expect(result.ok).toBe(true);
      expect(result.canvas?.edges).toEqual([]);
    });
  });

  describe('boundary cases', () => {
    it('treats an empty canvas as valid', () => {
      const result = parseJsonCanvas('{}');
      expect(result.ok).toBe(true);
      expect(result.canvas).toMatchObject({ nodes: [], edges: [] });
      expect(result.canvas?.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    });

    it('treats an empty string as an empty canvas', () => {
      expect(parseJsonCanvas('').ok).toBe(true);
      expect(parseJsonCanvas('   ').canvas?.nodes).toEqual([]);
    });

    it('skips a node missing required geometry rather than failing the file', () => {
      const result = parseJsonCanvas(canvas({ nodes: [node(), { id: 'bad', type: 'text', text: 'x' }] }));
      expect(result.ok).toBe(true);
      expect(result.canvas?.nodes).toHaveLength(1);
      expect(result.skipped).toBe(1);
    });

    it('skips a node with an unknown type', () => {
      const result = parseJsonCanvas(canvas({ nodes: [node({ type: 'hologram' })] }));
      expect(result.canvas?.nodes).toHaveLength(0);
      expect(result.skipped).toBe(1);
    });

    it('skips an edge pointing at a missing node', () => {
      const result = parseJsonCanvas(canvas({
        nodes: [node()],
        edges: [{ id: 'e1', fromNode: 'n1', toNode: 'ghost' }],
      }));
      expect(result.canvas?.edges).toHaveLength(0);
      expect(result.skipped).toBe(1);
    });

    it('drops an invalid edge side but keeps the edge', () => {
      const result = parseJsonCanvas(canvas({
        nodes: [node(), node({ id: 'n2' })],
        edges: [{ id: 'e1', fromNode: 'n1', toNode: 'n2', fromSide: 'diagonal' }],
      }));
      expect(result.canvas?.edges).toHaveLength(1);
      expect(result.canvas?.edges[0]?.fromSide).toBeUndefined();
    });

    it('handles zero-size and negative coordinates', () => {
      const result = parseJsonCanvas(canvas({ nodes: [node({ x: -100, y: -100, width: 0, height: 0 })] }));
      expect(result.canvas?.nodes).toHaveLength(1);
      expect(result.canvas?.bounds).toEqual({ minX: -100, minY: -100, maxX: -100, maxY: -100 });
    });

    it('keeps unicode text and labels verbatim', () => {
      const result = parseJsonCanvas(canvas({ nodes: [node({ text: '中文 🎉' })] }));
      expect(result.canvas?.nodes[0]).toMatchObject({ text: '中文 🎉' });
    });

    it('tolerates a large canvas', () => {
      const many = Array.from({ length: 500 }, (_, i) => node({ id: `n${i}`, x: i * 10 }));
      const result = parseJsonCanvas(canvas({ nodes: many }));
      expect(result.canvas?.nodes).toHaveLength(500);
    });

    it('skips duplicate node ids after the first', () => {
      const result = parseJsonCanvas(canvas({ nodes: [node(), node({ text: 'dup' })] }));
      expect(result.canvas?.nodes).toHaveLength(1);
      expect(result.skipped).toBe(1);
    });
  });

  describe('error paths', () => {
    it('reports invalid JSON without throwing', () => {
      const result = parseJsonCanvas('{ not json');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/JSON/i);
      expect(result.canvas).toBeUndefined();
    });

    it('rejects a non-object top level', () => {
      expect(parseJsonCanvas('[]').ok).toBe(false);
      expect(parseJsonCanvas('"text"').ok).toBe(false);
      expect(parseJsonCanvas('null').ok).toBe(false);
    });

    it('treats a non-array nodes field as empty', () => {
      const result = parseJsonCanvas(JSON.stringify({ nodes: 'nope' }));
      expect(result.ok).toBe(true);
      expect(result.canvas?.nodes).toEqual([]);
    });

    it('skips a text node with no text and a file node with no file', () => {
      const result = parseJsonCanvas(canvas({
        nodes: [node({ text: undefined }), node({ id: 'n2', type: 'file', text: undefined })],
      }));
      expect(result.canvas?.nodes).toHaveLength(0);
      expect(result.skipped).toBe(2);
    });

    it('skips non-object entries in nodes and edges', () => {
      const result = parseJsonCanvas(JSON.stringify({ nodes: [null, 42, 'x'], edges: [null] }));
      expect(result.ok).toBe(true);
      expect(result.skipped).toBe(4);
    });
  });
});
