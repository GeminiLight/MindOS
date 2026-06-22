'use client';

export function agentReviewHref(path?: string): string {
  const params = new URLSearchParams({ source: 'agent' });
  const trimmedPath = path?.trim();
  if (trimmedPath) params.set('path', trimmedPath);
  return `/changelog?${params.toString()}`;
}
