/**
 * Worker thread for async LCS diff computation.
 * Receives { before, after } messages, returns DiffLine[].
 * Runs in a separate thread to avoid blocking the agent event loop.
 */
import { parentPort } from 'worker_threads';

type DiffLineType = 'equal' | 'insert' | 'delete';
interface DiffLine { type: DiffLineType; text: string; }

function buildLineDiff(before: string, after: string): DiffLine[] {
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
      i++; j++;
    } else if (j < n && (i >= m || lcs[i][j + 1] >= lcs[i + 1][j])) {
      rows.push({ type: 'insert', text: newLines[j] });
      j++;
    } else {
      rows.push({ type: 'delete', text: oldLines[i] });
      i++;
    }
  }
  return rows;
}

parentPort?.on('message', ({ id, before, after }: { id: number; before: string; after: string }) => {
  try {
    const result = buildLineDiff(before, after);
    parentPort?.postMessage({ id, result, error: null });
  } catch (err) {
    parentPort?.postMessage({ id, result: null, error: String(err) });
  }
});
