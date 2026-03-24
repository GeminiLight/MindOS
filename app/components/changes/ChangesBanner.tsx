'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

interface ChangeSummaryPayload {
  unreadCount: number;
}

export default function ChangesBanner() {
  const [unreadCount, setUnreadCount] = useState(0);

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

  if (unreadCount <= 0) return null;

  return (
    <div className="sticky top-[52px] md:top-0 z-20 border-b bg-[var(--amber-dim)]" style={{ borderColor: 'color-mix(in srgb, var(--amber) 35%, var(--border))' }}>
      <div className="px-4 md:px-6 py-2">
        <div className="content-width xl:mr-[220px] flex items-center justify-between gap-3">
          <p className="text-xs md:text-sm text-foreground font-display">
            {unreadCount} content change{unreadCount === 1 ? '' : 's'} detected.
          </p>
          <Link
            href="/changes"
            className="text-xs md:text-sm text-[var(--amber)] hover:underline focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            Review changes
          </Link>
        </div>
      </div>
    </div>
  );
}
