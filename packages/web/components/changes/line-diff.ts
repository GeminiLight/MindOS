export type DiffLineType = 'equal' | 'insert' | 'delete';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface CollapsedGap {
  type: 'gap';
  count: number;
}

export type DiffRow = DiffLine | CollapsedGap;

export function buildLineDiff(before: string, after: string): DiffLine[] {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  const m = oldLines.length;
  const n = newLines.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = oldLines[i] === newLines[j]
        ? 1 + lcs[i + 1][j + 1]
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && oldLines[i] === newLines[j]) {
      rows.push({ type: 'equal', text: oldLines[i] });
      i += 1;
      j += 1;
      continue;
    }
    if (j < n && (i >= m || lcs[i][j + 1] >= lcs[i + 1][j])) {
      rows.push({ type: 'insert', text: newLines[j] });
      j += 1;
      continue;
    }
    rows.push({ type: 'delete', text: oldLines[i] });
    i += 1;
  }
  return rows;
}

export function collapseDiffContext(lines: DiffLine[], context = 2): DiffRow[] {
  const keep = new Set<number>();
  lines.forEach((line, idx) => {
    if (line.type === 'equal') return;
    for (let i = Math.max(0, idx - context); i <= Math.min(lines.length - 1, idx + context); i++) {
      keep.add(i);
    }
  });

  const out: DiffRow[] = [];
  let gapStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (keep.has(i)) {
      if (gapStart !== -1) {
        out.push({ type: 'gap', count: i - gapStart });
        gapStart = -1;
      }
      out.push(lines[i]);
      continue;
    }
    if (gapStart === -1) gapStart = i;
  }
  if (gapStart !== -1) out.push({ type: 'gap', count: lines.length - gapStart });
  return out;
}
