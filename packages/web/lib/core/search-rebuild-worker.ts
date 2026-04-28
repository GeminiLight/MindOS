/**
 * Worker thread for Core search index rebuild.
 * Receives mindRoot path, reads all files, builds inverted index,
 * and posts the serialized index data back to the parent thread.
 *
 * This runs in a separate thread via worker_threads so the main
 * Node.js event loop stays responsive during index construction.
 */
import { parentPort, workerData } from 'worker_threads';
import { collectAllFiles } from './tree';
import { readFile } from './fs-ops';
import { resolveSafe } from './security';
import { extractPdfText } from './pdf-text';
import { CJK_CHAR_REGEX } from './cjk';
import path from 'path';

const MAX_CONTENT_LENGTH = 50_000;

// Intl.Segmenter for proper CJK word segmentation
const zhSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('zh', { granularity: 'word' })
  : null;

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const lower = text.toLowerCase();
  const words = lower.match(/[a-z0-9_$@#]+/g);
  if (words) {
    for (const w of words) {
      if (w.length >= 2) tokens.add(w);
    }
  }
  if (CJK_CHAR_REGEX.test(lower)) {
    if (zhSegmenter) {
      for (const { segment, isWordLike } of zhSegmenter.segment(lower)) {
        if (!isWordLike) continue;
        const word = segment.trim();
        if (!word) continue;
        tokens.add(word);
        for (const ch of word) {
          if (CJK_CHAR_REGEX.test(ch)) tokens.add(ch);
        }
      }
    } else {
      const cjkChars: string[] = [];
      for (const ch of lower) {
        if (CJK_CHAR_REGEX.test(ch)) {
          cjkChars.push(ch);
        } else {
          if (cjkChars.length > 0) {
            emitCjkBigrams(cjkChars, tokens);
            cjkChars.length = 0;
          }
        }
      }
      if (cjkChars.length > 0) emitCjkBigrams(cjkChars, tokens);
    }
  }
  return tokens;
}

function emitCjkBigrams(chars: string[], tokens: Set<string>): void {
  for (let i = 0; i < chars.length; i++) {
    tokens.add(chars[i]);
    if (i + 1 < chars.length) {
      tokens.add(chars[i] + chars[i + 1]);
    }
  }
}

interface PersistedIndex {
  version: number;
  builtForRoot: string;
  fileCount: number;
  totalChars: number;
  docLengths: Record<string, number>;
  invertedIndex: Record<string, string[]>;
  timestamp: number;
}

function rebuild(mindRoot: string): PersistedIndex {
  const allFiles = collectAllFiles(mindRoot);
  const invertedIndex: Record<string, string[]> = {};
  const docLengths: Record<string, number> = {};
  let totalChars = 0;

  for (const filePath of allFiles) {
    let content: string;
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.pdf') {
      try {
        const resolved = resolveSafe(mindRoot, filePath);
        content = extractPdfText(resolved);
        if (!content) continue;
      } catch { continue; }
    } else {
      try { content = readFile(mindRoot, filePath); } catch { continue; }
    }

    docLengths[filePath] = content.length;
    totalChars += content.length;

    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.slice(0, MAX_CONTENT_LENGTH);
    }

    const allText = filePath + '\n' + content;
    const tokens = tokenize(allText);

    for (const token of tokens) {
      if (!invertedIndex[token]) {
        invertedIndex[token] = [];
      }
      invertedIndex[token].push(filePath);
    }
  }

  return {
    version: 1,
    builtForRoot: mindRoot,
    fileCount: allFiles.length,
    totalChars,
    docLengths,
    invertedIndex,
    timestamp: Date.now(),
  };
}

// Execute when loaded as a worker
if (parentPort && workerData?.mindRoot) {
  try {
    const result = rebuild(workerData.mindRoot);
    parentPort.postMessage({ ok: true, data: result });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
