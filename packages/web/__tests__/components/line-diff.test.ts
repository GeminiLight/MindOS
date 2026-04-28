import { describe, it, expect } from 'vitest';
import { buildLineDiff } from '@/components/changes/line-diff';

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
