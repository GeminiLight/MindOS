import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleWebSearchFallback } from '@/lib/agent/web-search-fallback';

// Mock the free search chain
vi.mock('@/lib/agent/web-search', () => ({
  webSearch: vi.fn(),
  formatSearchResults: vi.fn(),
}));

import { webSearch, formatSearchResults } from '@/lib/agent/web-search';

const mockWebSearch = vi.mocked(webSearch);
const mockFormat = vi.mocked(formatSearchResults);

beforeEach(() => {
  vi.resetAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(overrides: {
  toolName?: string;
  isError?: boolean;
  query?: string;
  errorText?: string;
}) {
  return {
    toolCall: { name: overrides.toolName ?? 'web_search' },
    args: overrides.query !== undefined ? { query: overrides.query } : {},
    result: {
      content: overrides.errorText
        ? [{ type: 'text', text: overrides.errorText }]
        : [],
    },
    isError: overrides.isError ?? true,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('handleWebSearchFallback', () => {
  describe('skip conditions', () => {
    it('skips non web_search tools', async () => {
      const result = await handleWebSearchFallback(
        makeContext({ toolName: 'read_file', isError: true, query: 'test' }),
      );
      expect(result).toBeUndefined();
      expect(mockWebSearch).not.toHaveBeenCalled();
    });

    it('skips when tool succeeded (isError=false)', async () => {
      const result = await handleWebSearchFallback(
        makeContext({ isError: false, query: 'test' }),
      );
      expect(result).toBeUndefined();
      expect(mockWebSearch).not.toHaveBeenCalled();
    });

    it('skips when query is empty', async () => {
      const result = await handleWebSearchFallback(
        makeContext({ query: '' }),
      );
      expect(result).toBeUndefined();
      expect(mockWebSearch).not.toHaveBeenCalled();
    });

    it('skips when query is missing from args', async () => {
      const ctx = {
        toolCall: { name: 'web_search' },
        args: {},
        result: { content: [] },
        isError: true,
      };
      const result = await handleWebSearchFallback(ctx);
      expect(result).toBeUndefined();
      expect(mockWebSearch).not.toHaveBeenCalled();
    });
  });

  describe('successful fallback', () => {
    it('returns free search results when web_search fails', async () => {
      mockWebSearch.mockResolvedValue({
        results: [
          { title: 'DuckDuckGo Result', url: 'https://example.com', snippet: 'Found it' },
        ],
        engine: 'DuckDuckGo',
      });
      mockFormat.mockReturnValue('## Web Search Results for: "test"\n\n### 1. DuckDuckGo Result');

      const result = await handleWebSearchFallback(
        makeContext({ query: 'test', errorText: 'Exa monthly free tier exhausted' }),
      );

      expect(mockWebSearch).toHaveBeenCalledWith('test');
      expect(mockFormat).toHaveBeenCalledWith('test', {
        results: [{ title: 'DuckDuckGo Result', url: 'https://example.com', snippet: 'Found it' }],
        engine: 'DuckDuckGo',
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: '## Web Search Results for: "test"\n\n### 1. DuckDuckGo Result' }],
        isError: false,
      });
    });

    it('trims whitespace from query', async () => {
      mockWebSearch.mockResolvedValue({
        results: [{ title: 'R', url: 'https://r.com', snippet: 's' }],
        engine: 'Bing',
      });
      mockFormat.mockReturnValue('formatted');

      await handleWebSearchFallback(makeContext({ query: '  react 19  ' }));
      expect(mockWebSearch).toHaveBeenCalledWith('react 19');
    });
  });

  describe('fallback also fails', () => {
    it('returns undefined when free search returns empty results', async () => {
      mockWebSearch.mockResolvedValue({ results: [], engine: 'none' });

      const result = await handleWebSearchFallback(
        makeContext({ query: 'obscure query', errorText: 'No provider available' }),
      );

      expect(mockWebSearch).toHaveBeenCalledWith('obscure query');
      expect(result).toBeUndefined();
    });

    it('returns undefined when free search throws', async () => {
      mockWebSearch.mockRejectedValue(new Error('Network error'));

      const result = await handleWebSearchFallback(
        makeContext({ query: 'test', errorText: 'Exa error' }),
      );

      expect(mockWebSearch).toHaveBeenCalledWith('test');
      expect(result).toBeUndefined();
    });
  });

  describe('error message extraction', () => {
    it('logs the original error from tool result', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockWebSearch.mockResolvedValue({ results: [], engine: 'none' });

      await handleWebSearchFallback(
        makeContext({ query: 'test', errorText: 'Exa monthly free tier exhausted (1,000 requests)' }),
      );

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Exa monthly free tier exhausted'),
      );
      warnSpy.mockRestore();
    });

    it('handles missing error text gracefully', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockWebSearch.mockResolvedValue({ results: [], engine: 'none' });

      const ctx = {
        toolCall: { name: 'web_search' },
        args: { query: 'test' },
        result: { content: [] },
        isError: true,
      };
      await handleWebSearchFallback(ctx);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('unknown error'),
      );
      warnSpy.mockRestore();
    });
  });
});
