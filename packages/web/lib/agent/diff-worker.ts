import { buildLineDiff } from '@geminilight/mindos/agent/tool/line-diff';
/**
 * Worker thread for async LCS diff computation.
 * Receives { before, after } messages, returns DiffLine[].
 * Runs in a separate thread to avoid blocking the agent event loop.
 */
import { parentPort } from 'worker_threads';

type DiffLineType = 'equal' | 'insert' | 'delete';
interface DiffLine { type: DiffLineType; text: string; }

parentPort?.on('message', ({ id, before, after }: { id: number; before: string; after: string }) => {
  try {
    const result = buildLineDiff(before, after);
    parentPort?.postMessage({ id, result, error: null });
  } catch (err) {
    parentPort?.postMessage({ id, result: null, error: String(err) });
  }
});
