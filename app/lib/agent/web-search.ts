/**
 * Multi-engine web search with automatic fallback.
 *
 * Chain: DuckDuckGo HTML → Bing HTML → Google Lite HTML
 * All engines are free, require no API keys, and use HTML scraping.
 * If an engine returns results, we stop. If it fails or returns empty, we try the next.
 */

const PRIMARY_TIMEOUT_MS = 10_000;
const FALLBACK_TIMEOUT_MS = 6_000;
const MAX_RESULTS = 5;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

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
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(PRIMARY_TIMEOUT_MS) });
  if (!res.ok) return [];

  const html = await res.text();
  const results: SearchResult[] = [];
  const blocks = html.split('class="result__body"').slice(1);

  for (let i = 0; i < Math.min(blocks.length, MAX_RESULTS); i++) {
    const block = blocks[i];
    const titleMatch = block.match(/class="result__title"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/class="result__snippet[^>]*>([\s\S]*?)(?:<\/a>|<\/div>)/i);

    if (titleMatch) {
      let link = titleMatch[1];
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

// ─── Bing HTML ───────────────────────────────────────────────────────────────

async function searchBing(query: string): Promise<SearchResult[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(FALLBACK_TIMEOUT_MS) });
  if (!res.ok) return [];

  const html = await res.text();
  const results: SearchResult[] = [];

  // Bing organic results are in <li class="b_algo">
  const blocks = html.split('<li class="b_algo"').slice(1);

  for (let i = 0; i < Math.min(blocks.length, MAX_RESULTS); i++) {
    const block = blocks[i];
    const linkMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
      ?? block.match(/class="b_caption"[^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/i);

    if (linkMatch) {
      results.push({
        title: linkMatch[2].replace(/<[^>]+>/g, '').trim(),
        url: linkMatch[1],
        snippet: snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '',
      });
    }
  }
  return results;
}

// ─── Google Lite (google.com/search) ─────────────────────────────────────────

async function searchGoogle(query: string): Promise<SearchResult[]> {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&num=${MAX_RESULTS}`;
  const res = await fetch(url, {
    headers: { ...HEADERS, 'Accept': 'text/html' },
    signal: AbortSignal.timeout(FALLBACK_TIMEOUT_MS),
  });
  if (!res.ok) return [];

  const html = await res.text();
  const results: SearchResult[] = [];

  // Google wraps each result in <div class="g"> or data-sokoban-container
  // The reliable pattern: look for <a href="/url?q=REAL_URL&..." inside result divs
  const urlRegex = /<a[^>]*href="\/url\?q=(https?[^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  const seen = new Set<string>();

  while ((match = urlRegex.exec(html)) !== null && results.length < MAX_RESULTS) {
    const rawUrl = decodeURIComponent(match[1]);
    // Skip Google's own URLs and duplicates
    if (rawUrl.includes('google.com') || rawUrl.includes('accounts.google') || seen.has(rawUrl)) continue;
    seen.add(rawUrl);

    const title = match[2].replace(/<[^>]+>/g, '').trim();
    if (!title) continue;

    // Try to find a snippet near this link
    const afterLink = html.slice(match.index + match[0].length, match.index + match[0].length + 2000);
    const snippetMatch = afterLink.match(/<span[^>]*>([\s\S]{20,300}?)<\/span>/i);
    const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    results.push({ title, url: rawUrl, snippet });
  }

  return results;
}

// ─── Fallback chain ──────────────────────────────────────────────────────────

type SearchEngine = {
  name: string;
  search: (query: string) => Promise<SearchResult[]>;
};

const engines: SearchEngine[] = [
  { name: 'DuckDuckGo', search: searchDuckDuckGo },
  { name: 'Bing', search: searchBing },
  { name: 'Google', search: searchGoogle },
];

/**
 * Search the web using a multi-engine fallback chain.
 * Returns the first engine's results that are non-empty.
 * If all engines fail, returns an empty result set.
 */
export async function webSearch(query: string): Promise<SearchResponse> {
  for (const engine of engines) {
    try {
      const results = await engine.search(query);
      if (results.length > 0) {
        return { results, engine: engine.name };
      }
    } catch {
      // Engine failed, try next
    }
  }
  return { results: [], engine: 'none' };
}

/** Format search results as Markdown for the Agent. */
export function formatSearchResults(query: string, response: SearchResponse): string {
  if (response.results.length === 0) {
    return `No web search results found for: "${query}". All search engines were unavailable or returned no results.`;
  }

  const resultMd = response.results.map((r, i) =>
    `### ${i + 1}. ${r.title}\n**URL:** ${r.url}\n${r.snippet ? `**Snippet:** ${r.snippet}\n` : ''}`
  ).join('\n');

  return `## Web Search Results for: "${query}"\n\n${resultMd}\n*Source: ${response.engine}. Use web_fetch with any URL above to read full page content.*`;
}

// Export individual engines for testing
export { searchDuckDuckGo, searchBing, searchGoogle };
