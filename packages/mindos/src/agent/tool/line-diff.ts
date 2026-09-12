import { diffArrays } from 'diff';

// Sunk from packages/web/components/changes/line-diff.ts (Wave 3, spec-agent-core-consolidation).
// Bounded jsdiff adapter shared by agent KB tools and the web change viewers.

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

/** The UI and tool output share one bounded algorithm. Array tokens preserve CRLF and trailing empty lines. */
export function buildLineDiff(before: string, after: string, options: { maxEditLength?: number; timeout?: number } = {}): DiffLine[] {
  if (before.length + after.length > 4_000_000) throw new Error('Diff input limit exceeded');
  const changes = diffArrays(before.split('\n'), after.split('\n'), {
    maxEditLength: options.maxEditLength ?? 4_000,
    timeout: options.timeout ?? 40,
  });
  if (!changes) throw new Error('Diff computation limit exceeded');
  return changes.flatMap(change => change.value.map(text => ({
    type: change.added ? 'insert' as const : change.removed ? 'delete' as const : 'equal' as const,
    text,
  })));
}

export function tryBuildLineDiff(before: string, after: string): DiffLine[] | null {
  try { return buildLineDiff(before, after); } catch { return null; }
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
    const line = lines[i];
    if (line && keep.has(i)) {
      if (gapStart !== -1) {
        out.push({ type: 'gap', count: i - gapStart });
        gapStart = -1;
      }
      out.push(line);
      continue;
    }
    if (gapStart === -1) gapStart = i;
  }
  if (gapStart !== -1) out.push({ type: 'gap', count: lines.length - gapStart });
  return out;
}
