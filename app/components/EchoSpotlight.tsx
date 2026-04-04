'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Feather, ArrowRight } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';

const STORAGE_KEY = 'mindos-echo-daily-line';

/**
 * Echo Spotlight on the homepage.
 * - If user has a daily line → shows it with a subtle edit-in-place
 * - If no daily line → shows a warm invite to record one
 * - Always links to /echo/daily for deeper reflection
 */
export default function EchoSpotlight() {
  const { t } = useLocale();
  const echo = t.echoSpotlight;
  const [dailyLine, setDailyLine] = useState('');
  const [editing, setEditing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDailyLine(localStorage.getItem(STORAGE_KEY) ?? '');
    setMounted(true);
  }, []);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const saveLine = (val: string) => {
    setDailyLine(val);
    localStorage.setItem(STORAGE_KEY, val);
  };

  if (!mounted) return null;

  // ── Has daily line → compact display ──
  if (dailyLine.trim()) {
    return (
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[var(--amber)]"><Feather size={13} /></span>
          <h2 className="text-sm font-semibold font-display text-foreground">{echo.title}</h2>
          <span className="text-xs text-muted-foreground/50 font-display">{echo.dailyLine}</span>
          <Link
            href="/echo/daily"
            className="ml-auto text-xs font-medium text-[var(--amber)] hover:opacity-80 transition-opacity font-display"
          >
            {echo.goToEcho}
          </Link>
        </div>
        <div className="group">
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              value={dailyLine}
              onChange={e => saveLine(e.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={e => { if (e.key === 'Enter') setEditing(false); }}
              className="w-full px-3.5 py-3 rounded-xl border border-[var(--amber)]/40 bg-card text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-display italic"
              placeholder={echo.placeholder}
            />
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="w-full text-left px-3.5 py-3 rounded-xl border border-border/40 hover:border-[var(--amber)]/30 transition-all duration-150 cursor-text group-hover:shadow-sm"
            >
              <p className="text-sm text-foreground/80 font-display italic leading-relaxed">
                &ldquo;{dailyLine}&rdquo;
              </p>
              <p className="text-xs text-muted-foreground/40 mt-1">{echo.savedLocally}</p>
            </button>
          )}
        </div>
      </section>
    );
  }

  // ── No daily line → invite ──
  return (
    <section className="mb-10">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[var(--amber)]"><Feather size={13} /></span>
        <h2 className="text-sm font-semibold font-display text-foreground">{echo.title}</h2>
      </div>
      <div className="flex items-center gap-4 px-3.5 py-3.5 rounded-xl border border-dashed border-border/60 hover:border-[var(--amber)]/30 transition-all duration-150 group">
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={dailyLine}
            onChange={e => saveLine(e.target.value)}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus-visible:outline-none font-display italic"
            placeholder={echo.placeholder}
          />
          <p className="text-xs text-muted-foreground/40 mt-1">{echo.inviteDesc}</p>
        </div>
        <Link
          href="/echo/daily"
          className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-[var(--amber)] hover:opacity-80 transition-opacity"
        >
          {echo.goToEcho}
          <ArrowRight size={11} />
        </Link>
      </div>
    </section>
  );
}
