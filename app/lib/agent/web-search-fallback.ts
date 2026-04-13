/**
 * afterToolCall hook: falls back to free HTML-scraping search chain
 * (DuckDuckGo → Bing → Google) when pi-web-access web_search fails.
 */

import { webSearch, formatSearchResults } from './web-search';

/**
 * Install as agent.setAfterToolCall(handleWebSearchFallback).
 * When the web_search tool errors, retries with our free search chain.
 */
export async function handleWebSearchFallback(
  context: { toolCall: { name: string }; args: unknown; result: { content?: Array<{ type: string; text?: string }> }; isError: boolean },
): Promise<{ content?: Array<{ type: string; text: string }>; isError?: boolean } | undefined> {
  if (context.toolCall.name !== 'web_search') return undefined;
  if (!context.isError) return undefined;

  // Extract query from tool args (pi-web-access accepts query or queries)
  const args = (context.args ?? {}) as Record<string, unknown>;
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return undefined;

  const originalError = context.result?.content
    ?.find(c => c.type === 'text')
    ?.text?.slice(0, 120) ?? 'unknown error';
  console.warn(`[web-search-fallback] web_search failed (${originalError}). Trying free search chain...`);

  try {
    const freeResult = await webSearch(query);
    if (freeResult.results.length === 0) return undefined;

    return {
      content: [{ type: 'text' as const, text: formatSearchResults(query, freeResult) }],
      isError: false,
    };
  } catch {
    return undefined; // free search also failed, keep original error
  }
}
