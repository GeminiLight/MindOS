import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('@/lib/core/hybrid-search', () => ({
  hybridSearch: vi.fn(),
}));

vi.mock('@/lib/fs', () => ({
  getFileContent: vi.fn(),
  getMindRoot: vi.fn(() => '/mock/mind'),
}));

vi.mock('@/lib/agent/context', () => ({
  estimateStringTokens: vi.fn((text: string) => Math.ceil(text.length / 4)),
}));

import { performActiveRecall } from '@/lib/agent/active-recall';
import { hybridSearch } from '@/lib/core/hybrid-search';
import { getFileContent } from '@/lib/fs';
import { estimateStringTokens } from '@/lib/agent/context';

const mockSearch = vi.mocked(hybridSearch);
const mockGetFile = vi.mocked(getFileContent);
const mockTokens = vi.mocked(estimateStringTokens);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: estimateStringTokens returns length/4
  mockTokens.mockImplementation((text: string) => Math.ceil(text.length / 4));
});

describe('performActiveRecall', () => {
  it('returns matching results for a valid query', async () => {
    mockSearch.mockResolvedValue([
      { path: 'notes/arch.md', snippet: 'Architecture decisions...', score: 5.0, occurrences: 1 },
      { path: 'notes/todo.md', snippet: 'TODO items...', score: 3.0, occurrences: 1 },
    ]);
    mockGetFile.mockReturnValue('Full content of the architecture document with more details.');

    const results = await performActiveRecall('/mock/mind', 'architecture decisions');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe('notes/arch.md');
    expect(results[0].score).toBe(5.0);
    expect(mockSearch).toHaveBeenCalledOnce();
  });

  it('returns empty array when no results match', async () => {
    mockSearch.mockResolvedValue([]);

    const results = await performActiveRecall('/mock/mind', 'something obscure');

    expect(results).toEqual([]);
  });

  it('returns empty array for very short queries', async () => {
    const results = await performActiveRecall('/mock/mind', 'a');

    expect(results).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('returns empty array for empty query', async () => {
    const results = await performActiveRecall('/mock/mind', '');

    expect(results).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('filters results below minScore threshold', async () => {
    mockSearch.mockResolvedValue([
      { path: 'notes/high.md', snippet: 'High score', score: 5.0, occurrences: 1 },
      { path: 'notes/low.md', snippet: 'Low score', score: 0.5, occurrences: 1 },
    ]);
    mockGetFile.mockReturnValue('Short content');

    const results = await performActiveRecall('/mock/mind', 'test query', { minScore: 1.0 });

    expect(results.length).toBe(1);
    expect(results[0].path).toBe('notes/high.md');
  });

  it('excludes meta-files (README.md, INSTRUCTION.md, CONFIG.json)', async () => {
    mockSearch.mockResolvedValue([
      { path: 'README.md', snippet: 'Top-level readme', score: 10.0, occurrences: 1 },
      { path: 'dir/INSTRUCTION.md', snippet: 'Instructions', score: 8.0, occurrences: 1 },
      { path: 'dir/CONFIG.json', snippet: 'Config', score: 7.0, occurrences: 1 },
      { path: 'notes/real.md', snippet: 'Real content', score: 5.0, occurrences: 1 },
    ]);
    mockGetFile.mockReturnValue('Real content here');

    const results = await performActiveRecall('/mock/mind', 'test query');

    expect(results.length).toBe(1);
    expect(results[0].path).toBe('notes/real.md');
  });

  it('excludes files already in excludePaths (attached files)', async () => {
    mockSearch.mockResolvedValue([
      { path: 'notes/attached.md', snippet: 'Already attached', score: 8.0, occurrences: 1 },
      { path: 'notes/new.md', snippet: 'New content', score: 5.0, occurrences: 1 },
    ]);
    mockGetFile.mockReturnValue('Content');

    const results = await performActiveRecall('/mock/mind', 'test', {
      excludePaths: ['notes/attached.md'],
    });

    expect(results.length).toBe(1);
    expect(results[0].path).toBe('notes/new.md');
  });

  it('respects maxFiles limit', async () => {
    mockSearch.mockResolvedValue([
      { path: 'a.md', snippet: 'A', score: 5.0, occurrences: 1 },
      { path: 'b.md', snippet: 'B', score: 4.0, occurrences: 1 },
      { path: 'c.md', snippet: 'C', score: 3.0, occurrences: 1 },
      { path: 'd.md', snippet: 'D', score: 2.0, occurrences: 1 },
    ]);
    mockGetFile.mockReturnValue('Short');

    const results = await performActiveRecall('/mock/mind', 'test', { maxFiles: 2 });

    expect(results.length).toBe(2);
  });

  it('respects maxTokens budget', async () => {
    // Each file content is ~200 chars = ~50 tokens
    const content = 'x'.repeat(200);
    mockSearch.mockResolvedValue([
      { path: 'a.md', snippet: 'A', score: 5.0, occurrences: 1 },
      { path: 'b.md', snippet: 'B', score: 4.0, occurrences: 1 },
      { path: 'c.md', snippet: 'C', score: 3.0, occurrences: 1 },
    ]);
    mockGetFile.mockReturnValue(content);
    // 200 chars / 4 = 50 tokens each

    const results = await performActiveRecall('/mock/mind', 'test', { maxTokens: 80 });

    // Should fit 1 full (50t) + possibly truncated 2nd
    expect(results.length).toBeLessThanOrEqual(2);
    // Total tokens should not exceed 80
  });

  it('truncates query longer than 500 chars', async () => {
    const longQuery = 'a'.repeat(600);
    mockSearch.mockResolvedValue([]);

    await performActiveRecall('/mock/mind', longQuery);

    // hybridSearch should be called with truncated query
    expect(mockSearch).toHaveBeenCalledOnce();
    const calledQuery = mockSearch.mock.calls[0][1];
    expect(calledQuery.length).toBe(500);
  });

  it('handles search timeout gracefully', async () => {
    mockSearch.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 5000)));

    const results = await performActiveRecall('/mock/mind', 'test', { timeoutMs: 50 });

    expect(results).toEqual([]);
  });

  it('handles search error gracefully', async () => {
    mockSearch.mockRejectedValue(new Error('search failed'));

    const results = await performActiveRecall('/mock/mind', 'test');

    expect(results).toEqual([]);
  });

  it('falls back to snippet when file read fails', async () => {
    mockSearch.mockResolvedValue([
      { path: 'notes/gone.md', snippet: 'Original snippet text', score: 5.0, occurrences: 1 },
    ]);
    mockGetFile.mockImplementation(() => { throw new Error('file not found'); });

    const results = await performActiveRecall('/mock/mind', 'test');

    expect(results.length).toBe(1);
    expect(results[0].content).toBe('Original snippet text');
  });

  it('returns full file content for short files', async () => {
    const shortContent = 'This is a short file with only 50 chars of text.';
    mockSearch.mockResolvedValue([
      { path: 'notes/short.md', snippet: 'short file', score: 5.0, occurrences: 1 },
    ]);
    mockGetFile.mockReturnValue(shortContent);

    const results = await performActiveRecall('/mock/mind', 'short file');

    expect(results[0].content).toBe(shortContent);
  });

  it('expands snippet for long files with keyword match', async () => {
    // Build a 2000-char file with keyword at position ~1000
    const before = 'prefix '.repeat(100); // ~700 chars
    const match = 'KEYWORD_MATCH here is the relevant content ';
    const after = 'suffix '.repeat(100); // ~700 chars
    const fullContent = before + match + after;

    mockSearch.mockResolvedValue([
      { path: 'notes/long.md', snippet: 'KEYWORD_MATCH', score: 5.0, occurrences: 1 },
    ]);
    mockGetFile.mockReturnValue(fullContent);

    const results = await performActiveRecall('/mock/mind', 'keyword_match');

    expect(results[0].content.length).toBeLessThanOrEqual(810); // ~800 + "..."
    expect(results[0].content).toContain('KEYWORD_MATCH');
  });
});
