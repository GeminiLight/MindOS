import type { MobileIconName } from './mobile-icons';

export interface SearchStatusInput {
  query: string;
  searched: boolean;
  loading: boolean;
  resultCount: number;
  error?: unknown;
}

export interface SearchEmptyState {
  icon: MobileIconName;
  title: string;
  message: string;
  actionLabel?: string;
}

const MIN_SEARCH_QUERY_LENGTH = 2;
const FALLBACK_SEARCH_ERROR = 'Search is temporarily unavailable.';

export function getSearchErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return FALLBACK_SEARCH_ERROR;
}

export function getNormalizedSearchQuery(query: string): string {
  return query.trim();
}

export function canRunSearch(query: string): boolean {
  return getNormalizedSearchQuery(query).length >= MIN_SEARCH_QUERY_LENGTH;
}

export function getSearchEmptyState({
  query,
  searched,
  loading,
  resultCount,
  error,
}: SearchStatusInput): SearchEmptyState | null {
  const normalizedQuery = getNormalizedSearchQuery(query);
  if (loading || resultCount > 0) return null;

  if (error) {
    return {
      icon: 'cloud-offline-outline',
      title: 'Search unavailable',
      message: getSearchErrorMessage(error),
      actionLabel: normalizedQuery ? 'Retry search' : undefined,
    };
  }

  if (!searched) {
    return {
      icon: 'search-outline',
      title: 'Search your MindOS',
      message: 'Find notes by title, path, or a phrase from the content.',
    };
  }

  if (!canRunSearch(normalizedQuery)) {
    return {
      icon: 'search-outline',
      title: 'Keep typing',
      message: 'Enter at least two characters to search.',
    };
  }

  return {
    icon: 'search-outline',
    title: 'No matches',
    message: `No notes matched "${normalizedQuery}".`,
  };
}
