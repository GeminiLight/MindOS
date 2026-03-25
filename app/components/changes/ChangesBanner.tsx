'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { History, X } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/LocaleContext';

interface ChangeSummaryPayload {
  unreadCount: number;
}

export default function ChangesBanner() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [dismissedAtCount, setDismissedAtCount] = useState<number | null>(null);
  const [isRendered, setIsRendered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const pathname = usePathname();
  const { t } = useLocale();

  useEffect(() => {
    let active = true;
    const fetchSummary = async () => {
      try {
        const summary = await apiFetch<ChangeSummaryPayload>('/api/changes?op=summary');
        if (active) setUnreadCount(summary.unreadCount);
      } catch {
        if (active) setUnreadCount(0);
      }
    };
    void fetchSummary();
    const timer = setInterval(() => void fetchSummary(), 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const shouldShow = useMemo(() => {
    if (unreadCount <= 0) return false;
    if (pathname?.startsWith('/changes')) return false;
    if (dismissedAtCount !== null && unreadCount <= dismissedAtCount) return false;
    return true;
  }, [dismissedAtCount, pathname, unreadCount]);

  useEffect(() => {
    const durationMs = 160;
    if (shouldShow) {
      setIsRendered(true);
      const raf = requestAnimationFrame(() => setIsVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setIsVisible(false);
    const timer = setTimeout(() => setIsRendered(false), durationMs);
    return () => clearTimeout(timer);
  }, [shouldShow]);

  async function handleMarkAllRead() {
    try {
      await apiFetch('/api/changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'mark_seen' }),
      });
    } catch {
      // Keep UI resilient; polling will recover server state.
    } finally {
      setUnreadCount(0);
      setDismissedAtCount(0);
    }
  }

  if (!isRendered) return null;

  return (
    <div
      className={`fixed right-3 top-[60px] md:right-6 md:top-4 z-30 transition-all duration-150 ease-out ${
        isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-2 scale-[0.98] pointer-events-none'
      }`}
    >
      <div
        className="rounded-2xl border bg-card/95 backdrop-blur px-3 py-2.5 shadow-lg min-w-[260px] max-w-[350px]"
        style={{
          borderColor: 'color-mix(in srgb, var(--amber) 45%, var(--border))',
          boxShadow: '0 12px 28px color-mix(in srgb, var(--amber) 14%, rgba(0,0,0,.24))',
        }}
      >
        <div className="flex items-start gap-2.5">
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--amber)]"
            style={{ background: 'color-mix(in srgb, var(--amber) 18%, transparent)' }}
          >
            <History size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-foreground font-display whitespace-nowrap">
              {t.changes.unreadBanner(unreadCount)}
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              <Link
                href="/changes"
                className="inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium bg-[var(--amber)] text-white focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
              >
                {t.changes.reviewNow}
              </Link>
              <button
                type="button"
                onClick={() => void handleMarkAllRead()}
                className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium bg-muted text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t.changes.markAllRead}
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissedAtCount(unreadCount)}
            aria-label={t.changes.dismiss}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
