'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Lightbulb, X } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';

const DISMISS_KEY = 'mindos:suggestion-dismissed';
const STALE_DAYS = 30;

interface QuickSuggestionProps {
  recent: { path: string; mtime: number }[];
}

/**
 * One-line contextual suggestion based on simple rules.
 * Shows the most relevant suggestion, or nothing if dismissed/no data.
 */
export default function QuickSuggestion({ recent }: QuickSuggestionProps) {
  const { t } = useLocale();
  const sug = t.suggestion;
  const [dismissed, setDismissed] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const key = localStorage.getItem(DISMISS_KEY);
    // Reset daily
    const today = new Date().toDateString();
    setDismissed(key === today);
    setMounted(true);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    localStorage.setItem(DISMISS_KEY, new Date().toDateString());
  };

  if (!mounted || dismissed) return null;

  // Rule: stale files (>30 days without update)
  const cutoff = Date.now() - STALE_DAYS * 86400_000;
  const staleCount = recent.filter(f => f.mtime < cutoff).length;

  if (staleCount === 0) return null;

  return (
    <section className="mb-10">
      <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl border border-border/40 bg-card/50">
        <Lightbulb size={14} className="shrink-0 text-[var(--amber)]" />
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">{sug.staleFiles(staleCount)}</span>
          <Link
            href="/changelog"
            className="text-xs font-medium text-[var(--amber)] hover:opacity-80 transition-opacity"
          >
            {sug.reviewStale}
          </Link>
        </div>
        <button
          onClick={dismiss}
          className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground/40 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={sug.dismiss}
        >
          <X size={12} />
        </button>
      </div>
    </section>
  );
}
