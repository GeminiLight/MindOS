/**
 * Request that the search panel open with a query already filled in.
 *
 * Used by inline tag chips in the reading view: clicking `#project` should land
 * somewhere useful, and the search panel is the surface that already exists.
 * Follows the same CustomEvent pattern as the other `lib/*-events.ts` modules
 * rather than threading a callback through the layout tree.
 */

export const SEARCH_QUERY_REQUEST_EVENT = 'mindos:search-query-request';

export type SearchQueryRequestDetail = { query: string };

/** Ask the shell to focus search with `query`. No-op outside the browser. */
export function requestSearchQuery(query: string): void {
  const trimmed = query.trim();
  if (!trimmed || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<SearchQueryRequestDetail>(
    SEARCH_QUERY_REQUEST_EVENT,
    { detail: { query: trimmed } },
  ));
}

/** Subscribe to search requests. Returns an unsubscribe function. */
export function onSearchQueryRequest(handler: (query: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<SearchQueryRequestDetail>).detail;
    if (detail && typeof detail.query === 'string' && detail.query) handler(detail.query);
  };
  window.addEventListener(SEARCH_QUERY_REQUEST_EVENT, listener);
  return () => window.removeEventListener(SEARCH_QUERY_REQUEST_EVENT, listener);
}
