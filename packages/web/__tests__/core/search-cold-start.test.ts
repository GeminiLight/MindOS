/**
 * P1 regression tests: cold-start indexing must not block a search request
 * for an unbounded amount of time.
 *
 * Design under test: a cold in-request rebuild reads text files inline
 * (fast), but PDF extraction beyond a time budget is deferred to a
 * background task. The deferred PDFs are immediately present in the index
 * (path tokens + placeholder content) and their full text becomes
 * searchable once the background task completes.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from './helpers';
import { extractPdfText } from '@/lib/core/pdf-text';
import {
  searchFiles,
  __setColdBuildPdfBudgetForTests,
  __waitForDeferredPdfIndexingForTests,
} from '@/lib/core/search';

vi.mock('@/lib/core/pdf-text', () => ({
  extractPdfText: vi.fn(() => 'pdfwombat extracted text body'),
}));

describe('cold-start search with PDF budget', () => {
  let mindRoot: string;

  beforeEach(() => {
    mindRoot = mkTempMindRoot();
    seedFile(mindRoot, 'notes/quick.md', 'markdownotter is instantly searchable');
    fs.writeFileSync(path.join(mindRoot, 'docs-report.pdf'), '%PDF-1.4 dummy');
    fs.writeFileSync(path.join(mindRoot, 'docs-slides.pdf'), '%PDF-1.4 dummy');
    vi.mocked(extractPdfText).mockClear();
  });

  afterEach(() => {
    __setColdBuildPdfBudgetForTests(null);
    cleanupMindRoot(mindRoot);
  });

  it('does not extract PDFs inline when the budget is exhausted', () => {
    __setColdBuildPdfBudgetForTests(0);
    const results = searchFiles(mindRoot, 'markdownotter');
    expect(results.map((r) => r.path)).toContain('notes/quick.md');
    expect(extractPdfText).not.toHaveBeenCalled();
  });

  it('indexes deferred PDF content in the background after the cold search', async () => {
    __setColdBuildPdfBudgetForTests(0);
    expect(searchFiles(mindRoot, 'pdfwombat')).toEqual([]); // degraded first answer
    await __waitForDeferredPdfIndexingForTests();
    const paths = searchFiles(mindRoot, 'pdfwombat').map((r) => r.path);
    expect(paths).toContain('docs-report.pdf');
    expect(paths).toContain('docs-slides.pdf');
    expect(extractPdfText).toHaveBeenCalledTimes(2);
  });

  it('extracts PDFs inline when the budget allows', () => {
    __setColdBuildPdfBudgetForTests(60_000);
    const paths = searchFiles(mindRoot, 'pdfwombat').map((r) => r.path);
    expect(paths).toContain('docs-report.pdf');
    expect(paths).toContain('docs-slides.pdf');
  });

  it('handles a mindRoot with only PDFs and zero budget without crashing', async () => {
    fs.rmSync(path.join(mindRoot, 'notes'), { recursive: true, force: true });
    __setColdBuildPdfBudgetForTests(0);
    expect(searchFiles(mindRoot, 'pdfwombat')).toEqual([]);
    await __waitForDeferredPdfIndexingForTests();
    expect(searchFiles(mindRoot, 'pdfwombat').length).toBeGreaterThan(0);
  });

  it('skips a deferred PDF whose extraction fails without breaking the rest', async () => {
    __setColdBuildPdfBudgetForTests(0);
    vi.mocked(extractPdfText)
      .mockImplementationOnce(() => { throw new Error('corrupt pdf'); })
      .mockImplementation(() => 'pdfwombat extracted text body');
    searchFiles(mindRoot, 'markdownotter');
    await __waitForDeferredPdfIndexingForTests();
    expect(searchFiles(mindRoot, 'pdfwombat').length).toBeGreaterThan(0);
  });
});
