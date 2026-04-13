// ─── Web Search Extension ──────────────────────────────────────────────────────
// Registers our own `web_search` tool that uses the free HTML-scraping chain
// (DuckDuckGo → Bing → Google) by default, with optional paid API providers
// (Tavily, Brave, Serper, Bing API) via ~/.mindos/settings.json.
//
// Loaded BEFORE pi-web-access so this tool takes priority. pi-web-access's
// fetch_content, code_search, get_search_content remain unaffected.

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { webSearch, formatSearchResults } from './web-search';
import { readSettings } from '../settings';

export default function webSearchExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'web_search',
    label: 'Web Search',
    description:
      'Search the web for any topic and return ranked results with titles, URLs, and snippets. ' +
      'ALWAYS use this tool FIRST when the user asks to search, look up, or find information online — ' +
      'do NOT use fetch_content to guess URLs. After getting results, use fetch_content on specific URLs if deeper content is needed. ' +
      'Works without any API key (DuckDuckGo → Bing → Google fallback chain).',
    promptSnippet:
      'Use web_search to find URLs, then ALWAYS call fetch_content on the top results to read full page content before answering.',
    parameters: Type.Object({
      query: Type.String({ description: 'The search query' }),
      numResults: Type.Optional(Type.Integer({ 
        minimum: 1, 
        maximum: 20, 
        description: 'Number of results to return (default: 5)' 
      })),
    }),
    async execute(_toolCallId, params) {
      const { query, numResults } = params as { query: string; numResults?: number };
      if (!query.trim()) {
        return { content: [{ type: 'text' as const, text: 'Error: query cannot be empty.' }], details: undefined };
      }

      try {
        const config = readSettings().webSearch;
        const result = await webSearch(query.trim(), config);
        // Optionally limit results if requested
        const limitedResults = numResults && numResults > 0 
          ? { ...result, results: result.results.slice(0, numResults) }
          : result;
        const text = formatSearchResults(query.trim(), limitedResults);
        return { content: [{ type: 'text' as const, text }], details: { engine: result.engine } };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Web search error: ${msg}` }], details: undefined };
      }
    },
  });
}
