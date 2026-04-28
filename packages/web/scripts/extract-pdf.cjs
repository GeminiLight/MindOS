#!/usr/bin/env node

/**
 * Standalone PDF text extraction script.
 *
 * Usage:  node extract-pdf.cjs <path-to-pdf>
 * Output: JSON on stdout  { text: string, pages: number }
 *
 * This runs OUTSIDE the Next.js bundler so pdfjs-dist worker resolution
 * works normally.
 */

'use strict';

const fs = require('fs');

// Suppress pdfjs-dist warnings (loadFont etc.) that go to stdout/stderr
// and would corrupt our JSON output.
const _warn = console.warn;
const _log = console.log;
console.warn = () => {};
console.log = () => {};

// ---------------------------------------------------------------------------
// CJK-aware smart text joining
// ---------------------------------------------------------------------------

/**
 * Detect whether a character falls in CJK / fullwidth ranges where
 * inter-item spaces are NOT desired.
 */
function isCJK(ch) {
  const c = ch.codePointAt(0);
  return (
    (c >= 0x2E80 && c <= 0x2FDF) ||   // CJK Radicals Supplement, Kangxi Radicals
    (c >= 0x4E00 && c <= 0x9FFF) ||   // CJK Unified Ideographs
    (c >= 0x3400 && c <= 0x4DBF) ||   // CJK Extension A
    (c >= 0xF900 && c <= 0xFAFF) ||   // CJK Compatibility Ideographs
    (c >= 0x3040 && c <= 0x309F) ||   // Hiragana
    (c >= 0x30A0 && c <= 0x30FF) ||   // Katakana
    (c >= 0xAC00 && c <= 0xD7AF) ||   // Hangul Syllables
    (c >= 0x20000 && c <= 0x2FA1F)    // CJK Extensions B-F + Supplement
  );
}

/** True for CJK fullwidth punctuation that already occupies its own space. */
function isCJKPunct(ch) {
  const c = ch.codePointAt(0);
  return (
    (c >= 0x3000 && c <= 0x303F) ||    // 。、「」【】
    (c >= 0xFF01 && c <= 0xFF0F) ||    // ！＂＃＄
    (c >= 0xFF1A && c <= 0xFF20) ||    // ：；＜＝＞
    (c >= 0xFF3B && c <= 0xFF40) ||    // ［＼］
    (c >= 0xFF5B && c <= 0xFF65) ||    // ｛｜｝～
    (c >= 0xFE50 && c <= 0xFE6B)      // Small Form Variants
  );
}

/**
 * Decide whether a space should be inserted between two adjacent characters
 * that come from separate pdfjs-dist TextItem objects.
 *
 * Rules:
 *   CJK + CJK  → no space  (中文相邻不加)
 *   CJK + Punct → no space  (标点紧跟)
 *   Punct + CJK → no space
 *   CJK + Latin → space     (中英之间加)
 *   Latin + CJK → space
 *   Latin + Latin → space    (英文单词间加)
 *   Punct + Latin → no space (e.g. `(hello`)
 *   Latin + Punct → no space (e.g. `hello.`)
 */
function shouldAddSpace(left, right) {
  if (!left || !right) return false;

  const lCJK = isCJK(left);
  const rCJK = isCJK(right);
  const lPunct = isCJKPunct(left) || /^[^\w\s]$/.test(left);
  const rPunct = isCJKPunct(right) || /^[^\w\s]$/.test(right);

  // Any side is punctuation → no space
  if (lPunct || rPunct) return false;
  // Both CJK → no space
  if (lCJK && rCJK) return false;
  // Mixed CJK/Latin → space
  if (lCJK !== rCJK) return true;
  // Both non-CJK (Latin/digit) → space between words
  return true;
}

/**
 * Join pdfjs-dist TextItem[] into clean text, respecting CJK spacing
 * rules and `hasEOL` line-break markers.
 */
function smartJoinTextItems(items) {
  const lines = [];
  let cur = '';

  for (const item of items) {
    const str = item.str ?? '';

    if (str === '') {
      // Empty str with hasEOL → line break
      if (item.hasEOL && cur.trim()) {
        lines.push(cur.trim());
        cur = '';
      }
      continue;
    }

    if (cur === '') {
      cur = str;
    } else {
      const left = cur[cur.length - 1];
      const right = str[0];
      cur += shouldAddSpace(left, right) ? ' ' + str : str;
    }

    if (item.hasEOL) {
      if (cur.trim()) lines.push(cur.trim());
      cur = '';
    }
  }

  if (cur.trim()) lines.push(cur.trim());
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    process.stdout.write(JSON.stringify({ text: '', pages: 0, error: 'File not found' }));
    process.exit(0);
  }

  // pdfjs-dist legacy build (CJS-compatible)
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
  );

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const numPages = doc.numPages;

  const pageTexts = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pageTexts.push(smartJoinTextItems(content.items));
  }

  process.stdout.write(JSON.stringify({ text: pageTexts.join('\n\n'), pages: numPages }));
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ text: '', pages: 0, error: err.message }));
  process.exit(0);
});
