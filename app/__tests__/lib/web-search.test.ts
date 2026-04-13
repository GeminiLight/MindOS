import { describe, expect, it, vi, beforeEach } from 'vitest';
import { webSearch, formatSearchResults, type SearchResponse } from '@/lib/agent/web-search';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function ddgHtml(results: Array<{ title: string; url: string; snippet: string }>): string {
  return results.map(r =>
    `<div class="result__body"><div class="result__title"><a href="//duckduckgo.com/l/?uddg=${encodeURIComponent(r.url)}">${r.title}</a></div><div class="result__snippet">${r.snippet}</div></div>`
  ).join('');
}

describe('webSearch free (DuckDuckGo)', () => {
  it('returns DuckDuckGo results when available', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(ddgHtml([
        { title: 'React 19', url: 'https://react.dev', snippet: 'New features in React 19' },
      ])),
    });

    const result = await webSearch('react 19');
    expect(result.engine).toBe('DuckDuckGo');
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe('React 19');
    expect(result.results[0].url).toBe('https://react.dev');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns empty when DuckDuckGo returns no results', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('<html></html>') });

    const result = await webSearch('test query');
    expect(result.engine).toBe('none');
    expect(result.results).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns empty when DuckDuckGo throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('DDG timeout'));

    const result = await webSearch('test query');
    expect(result.engine).toBe('none');
    expect(result.results).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('handles HTTP errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, text: () => Promise.resolve('') });

    const result = await webSearch('rate limited');
    expect(result.results).toHaveLength(0);
    expect(result.engine).toBe('none');
  });
});

describe('formatSearchResults', () => {
  it('formats results as markdown', () => {
    const response: SearchResponse = {
      results: [
        { title: 'React 19', url: 'https://react.dev', snippet: 'New features' },
        { title: 'Blog Post', url: 'https://blog.com', snippet: 'Details here' },
      ],
      engine: 'DuckDuckGo',
    };

    const md = formatSearchResults('react 19', response);
    expect(md).toContain('## Web Search Results for: "react 19"');
    expect(md).toContain('### 1. React 19');
    expect(md).toContain('### 2. Blog Post');
    expect(md).toContain('**URL:** https://react.dev');
    expect(md).toContain('Source: DuckDuckGo');
  });

  it('returns helpful message when no results', () => {
    const md = formatSearchResults('obscure query', { results: [], engine: 'none' });
    expect(md).toContain('No web search results found');
    expect(md).toContain('obscure query');
  });
});

describe('webSearch with provider config', () => {
  it('uses DuckDuckGo by default (no config)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(ddgHtml([
        { title: 'Free Result', url: 'https://free.com', snippet: 'free' },
      ])),
    });

    const result = await webSearch('test');
    expect(result.engine).toBe('DuckDuckGo');
  });

  it('uses DuckDuckGo with config provider=free', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(ddgHtml([
        { title: 'Free Result', url: 'https://free.com', snippet: 'free' },
      ])),
    });

    const result = await webSearch('test', { provider: 'free', apiKey: '' });
    expect(result.engine).toBe('DuckDuckGo');
  });

  it('calls Tavily API with correct format', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        results: [
          { title: 'Tavily Result', url: 'https://tavily.com', content: 'AI optimized' },
        ],
      }),
    });

    const result = await webSearch('test', { provider: 'tavily', apiKey: 'tvly-xxx' });
    expect(result.engine).toBe('Tavily');
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe('Tavily Result');
    expect(result.results[0].snippet).toBe('AI optimized');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('calls Brave API with correct headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        web: {
          results: [
            { title: 'Brave Result', url: 'https://brave.com', description: 'Privacy first' },
          ],
        },
      }),
    });

    const result = await webSearch('test', { provider: 'brave', apiKey: 'BSA-xxx' });
    expect(result.engine).toBe('Brave');
    expect(result.results).toHaveLength(1);
    expect(result.results[0].snippet).toBe('Privacy first');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api.search.brave.com'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Subscription-Token': 'BSA-xxx' }),
      }),
    );
  });

  it('calls Serper API with correct format', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        organic: [
          { title: 'Serper Result', link: 'https://serper.dev', snippet: 'Google proxy' },
        ],
      }),
    });

    const result = await webSearch('test', { provider: 'serper', apiKey: 'serper-xxx' });
    expect(result.engine).toBe('Serper');
    expect(result.results).toHaveLength(1);
    expect(result.results[0].url).toBe('https://serper.dev');
  });

  it('calls Bing API with correct headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        webPages: {
          value: [
            { name: 'Bing API Result', url: 'https://bing.com', snippet: 'Microsoft search' },
          ],
        },
      }),
    });

    const result = await webSearch('test', { provider: 'bing-api', apiKey: 'bing-xxx' });
    expect(result.engine).toBe('Bing API');
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe('Bing API Result');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api.bing.microsoft.com'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Ocp-Apim-Subscription-Key': 'bing-xxx' }),
      }),
    );
  });

  it('throws on API error for Tavily', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(webSearch('test', { provider: 'tavily', apiKey: 'bad-key' }))
      .rejects.toThrow('Tavily API error: 401');
  });
});
