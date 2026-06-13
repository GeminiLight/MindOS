// Migrated from packages/web/__tests__/components/line-diff.test.ts
// (Wave 3, spec-agent-core-consolidation).
import { describe, it, expect } from 'vitest';
import { buildLineDiff, collapseDiffContext, type DiffLine } from './line-diff.js';

describe('buildLineDiff (LCS-based diff)', () => {
  it('handles empty files', () => {
    // ''.split('\n') returns [''] — one empty line, so diff shows one equal empty line
    expect(buildLineDiff('', '')).toEqual([{ type: 'equal', text: '' }]);
    expect(buildLineDiff('line1', '')).toContainEqual({ type: 'delete', text: 'line1' });
    expect(buildLineDiff('', 'line1')).toContainEqual({ type: 'insert', text: 'line1' });
  });

  it('detects unchanged lines', () => {
    const result = buildLineDiff('line1\nline2', 'line1\nline2');
    expect(result).toEqual([
      { type: 'equal', text: 'line1' },
      { type: 'equal', text: 'line2' },
    ]);
  });

  it('detects insertions', () => {
    const result = buildLineDiff('line1', 'line1\nline2');
    expect(result).toContainEqual({ type: 'insert', text: 'line2' });
  });

  it('detects deletions', () => {
    const result = buildLineDiff('line1\nline2', 'line1');
    expect(result).toContainEqual({ type: 'delete', text: 'line2' });
  });

  it('handles large diffs correctly', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const before = lines.join('\n');
    const after = [...lines.slice(0, 50), 'INSERTED', ...lines.slice(50)].join('\n');
    const result = buildLineDiff(before, after);
    expect(result).toContainEqual({ type: 'insert', text: 'INSERTED' });
  });
});

describe('collapseDiffContext', () => {
  it('collapses long unchanged stretches into gaps with context preserved', () => {
    const lines: DiffLine[] = [
      ...Array.from({ length: 10 }, (_, i): DiffLine => ({ type: 'equal', text: `eq ${i}` })),
      { type: 'insert', text: 'NEW' },
      ...Array.from({ length: 10 }, (_, i): DiffLine => ({ type: 'equal', text: `tail ${i}` })),
    ];
    const collapsed = collapseDiffContext(lines, 2);

    expect(collapsed[0]).toEqual({ type: 'gap', count: 8 });
    expect(collapsed).toContainEqual({ type: 'insert', text: 'NEW' });
    // 2 context lines on each side of the change survive
    expect(collapsed).toContainEqual({ type: 'equal', text: 'eq 8' });
    expect(collapsed).toContainEqual({ type: 'equal', text: 'tail 1' });
    expect(collapsed.at(-1)).toEqual({ type: 'gap', count: 8 });
  });

  it('keeps everything when the diff is all changes', () => {
    const lines: DiffLine[] = [
      { type: 'delete', text: 'old' },
      { type: 'insert', text: 'new' },
    ];
    expect(collapseDiffContext(lines, 2)).toEqual(lines);
  });
});
