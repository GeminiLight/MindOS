/**
 * Multi-provider web search.
 *
 * Providers:
 *   - 'free' (default): DuckDuckGo HTML scraping. No API key.
 *   - 'tavily': Tavily Search API (AI-optimized, structured summaries)
 *   - 'brave':  Brave Search API (privacy-first)
 *   - 'serper': Serper.dev (Google results proxy)
 *   - 'bing-api': Bing Web Search API (Microsoft)
 */

import type { WebSearchConfig } from '../settings';

const PRIMARY_TIMEOUT_MS = 10_000;
const MAX_RESULTS = 5;

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

/** Detect if query contains CJK characters and return appropriate Accept-Language header */
function getHeaders(query: string): Record<string, string> {
  const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(query);
  return {
    ...BASE_HEADERS,
    'Accept-Language': hasCJK
      ? 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7'
      : 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
  };
}

/** Unescape common HTML entities in href attributes */
function unescapeHtml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
  engine: string;
}

// ─── DuckDuckGo HTML ─────────────────────────────────────────────────────────

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: getHeaders(query), signal: AbortSignal.timeout(PRIMARY_TIMEOUT_MS) });
  if (!res.ok) return [];

  const html = await res.text();
  const results: SearchResult[] = [];
  const blocks = html.split('class="result__body"').slice(1);

  for (let i = 0; i < Math.min(blocks.length, MAX_RESULTS); i++) {
    const block = blocks[i];
    const titleMatch = block.match(/class="result__title"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/class="result__snippet[^>]*>([\s\S]*?)(?:<\/a>|<\/div>)/i);

    if (titleMatch) {
      let link = unescapeHtml(titleMatch[1]);
      if (link.startsWith('//duckduckgo.com/l/?uddg=')) {
        const urlParam = new URL('https:' + link).searchParams.get('uddg');
        if (urlParam) link = decodeURIComponent(urlParam);
      }
      results.push({
        title: titleMatch[2].replace(/<[^>]+>/g, '').trim(),
        url: link,
        snippet: snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '',
      });
    }
  }
  return results;
}

// ─── Free search ─────────────────────────────────────────────────────────────

async function searchFree(query: string): Promise<SearchResponse> {
  try {
    const results = await searchDuckDuckGo(query);
    if (results.length > 0) {
      return { results, engine: 'DuckDuckGo' };
    }
  } catch {
    // DuckDuckGo failed
  }
  return { results: [], engine: 'none' };
}

/**
 * Search the web. Dispatches to the configured provider.
 * Falls back to DuckDuckGo HTML scraping if no config or provider='free'.
 */
export async function webSearch(query: string, config?: WebSearchConfig): Promise<SearchResponse> {
  const provider = config?.provider ?? 'free';
  const apiKey = config?.apiKey ?? '';

  switch (provider) {
    case 'tavily':  return searchTavily(query, apiKey);
    case 'brave':   return searchBraveApi(query, apiKey);
    case 'serper':  return searchSerper(query, apiKey);
    case 'bing-api': return searchBingApi(query, apiKey);
    default:        return searchFree(query);
  }
}

/** Format search results as Markdown for the Agent. */
export function formatSearchResults(query: string, response: SearchResponse): string {
  if (response.results.length === 0) {
    return `No web search results found for: "${query}". All search engines were unavailable or returned no results.`;
  }

  const resultMd = response.results.map((r, i) =>
    `### ${i + 1}. ${r.title}\n**URL:** ${r.url}\n${r.snippet ? `**Snippet:** ${r.snippet}\n` : ''}`
  ).join('\n');

  return `## Web Search Results for: "${query}"\n\n${resultMd}\n*Source: ${response.engine}. These are snippets only — use fetch_content on the most relevant URLs above to read the full page content before answering.*`;
}

// Export individual engines for testing
export { searchDuckDuckGo };

// ─── Tavily Search API ────────────────────────────────────────────────────────

async function searchTavily(query: string, apiKey: string): Promise<SearchResponse> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: MAX_RESULTS, include_answer: false, search_depth: 'basic' }),
    signal: AbortSignal.timeout(PRIMARY_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Tavily API error: ${res.status}`);
  const data = await res.json();
  const results: SearchResult[] = ((data as Record<string, unknown>).results as Array<Record<string, unknown>> ?? []).map(r => ({
    title: String(r.title ?? ''),
    url: String(r.url ?? ''),
    snippet: String(r.content ?? ''),
  }));
  return { results: results.slice(0, MAX_RESULTS), engine: 'Tavily' };
}

// ─── Brave Search API ─────────────────────────────────────────────────────────

async function searchBraveApi(query: string, apiKey: string): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, count: String(MAX_RESULTS) });
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(PRIMARY_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Brave API error: ${res.status}`);
  const data = await res.json() as { web?: { results?: Array<Record<string, unknown>> } };
  const results: SearchResult[] = (data.web?.results ?? []).map(r => ({
    title: String(r.title ?? ''),
    url: String(r.url ?? ''),
    snippet: String(r.description ?? ''),
  }));
  return { results: results.slice(0, MAX_RESULTS), engine: 'Brave' };
}

// ─── Serper.dev (Google results proxy) ────────────────────────────────────────

async function searchSerper(query: string, apiKey: string): Promise<SearchResponse> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ q: query, num: MAX_RESULTS }),
    signal: AbortSignal.timeout(PRIMARY_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Serper API error: ${res.status}`);
  const data = await res.json() as { organic?: Array<Record<string, unknown>> };
  const results: SearchResult[] = (data.organic ?? []).map(r => ({
    title: String(r.title ?? ''),
    url: String(r.link ?? ''),
    snippet: String(r.snippet ?? ''),
  }));
  return { results: results.slice(0, MAX_RESULTS), engine: 'Serper' };
}

// ─── Bing Web Search API (Microsoft) ─────────────────────────────────────────

async function searchBingApi(query: string, apiKey: string): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, count: String(MAX_RESULTS) });
  const res = await fetch(`https://api.bing.microsoft.com/v7.0/search?${params}`, {
    headers: { 'Ocp-Apim-Subscription-Key': apiKey },
    signal: AbortSignal.timeout(PRIMARY_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Bing API error: ${res.status}`);
  const data = await res.json() as { webPages?: { value?: Array<Record<string, unknown>> } };
  const results: SearchResult[] = (data.webPages?.value ?? []).map(r => ({
    title: String(r.name ?? ''),
    url: String(r.url ?? ''),
    snippet: String(r.snippet ?? ''),
  }));
  return { results: results.slice(0, MAX_RESULTS), engine: 'Bing API' };
}

// Re-export API providers for testing
export { searchTavily, searchBraveApi, searchSerper, searchBingApi };
