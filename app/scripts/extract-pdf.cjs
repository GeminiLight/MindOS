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
const path = require('path');

// Suppress pdfjs-dist warnings (loadFont etc.) that go to stdout/stderr
// and would corrupt our JSON output.
const _warn = console.warn;
const _log = console.log;
console.warn = () => {};
console.log = () => {};

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
    const line = content.items.map((item) => item.str ?? '').join(' ');
    pageTexts.push(line);
  }

  process.stdout.write(JSON.stringify({ text: pageTexts.join('\n\n'), pages: numPages }));
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ text: '', pages: 0, error: err.message }));
  process.exit(0);
});
