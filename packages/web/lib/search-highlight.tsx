import type React from 'react';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightSearchSnippet(snippet: string, query: string): React.ReactNode {
  const words = Array.from(new Set(query.trim().split(/\s+/).filter(Boolean)))
    .sort((a, b) => b.length - a.length);
  if (words.length === 0) return snippet;

  const escaped = words.map(escapeRegExp);
  const splitPattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  const matchPattern = new RegExp(`^(?:${escaped.join('|')})$`, 'i');

  return snippet.split(splitPattern).map((part, i) =>
    matchPattern.test(part)
      ? <mark key={i} className="bg-[var(--amber)]/25 text-foreground rounded-sm px-0.5">{part}</mark>
      : part
  );
}
