'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import { apiFetch } from '@/lib/api';

interface UpdateInfo {
  current: string;
  latest: string;
}

export default function UpdateBanner() {
  const { t } = useLocale();
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      if (path === '/setup' || path === '/login') return;
    }

    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch<{ hasUpdate: boolean; latest: string; current: string }>('/api/update-check');
        if (!data.hasUpdate) {
          // Clean up stale badge state from a previous update cycle
          if (localStorage.getItem('mindos_update_latest')) {
            localStorage.removeItem('mindos_update_latest');
            localStorage.removeItem('mindos_update_dismissed');
            window.dispatchEvent(new Event('mindos:update-dismissed'));
          }
          return;
        }

        const dismissed = localStorage.getItem('mindos_update_dismissed');
        if (data.latest === dismissed) return;

        setInfo({ latest: data.latest, current: data.current });
        // Broadcast for ActivityBar & Settings tab badges
        window.dispatchEvent(new CustomEvent('mindos:update-available', { detail: { latest: data.latest } }));
      } catch {
        // Network error / API failure — silent
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  if (!info) return null;

  const handleDismiss = () => {
    localStorage.setItem('mindos_update_dismissed', info.latest);
    setInfo(null);
    window.dispatchEvent(new Event('mindos:update-dismissed'));
  };

  const handleOpenUpdate = () => {
    window.dispatchEvent(new CustomEvent('mindos:open-settings', { detail: { tab: 'update' } }));
    localStorage.setItem('mindos_update_dismissed', info.latest);
    setInfo(null);
    window.dispatchEvent(new Event('mindos:update-dismissed'));
  };

  const u = t.updateBanner;

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs bg-[var(--amber-subtle)] border-b border-border">
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <span className="font-medium text-[var(--amber)]">
          {u?.newVersion
            ? u.newVersion(info.latest, info.current)
            : `MindOS v${info.latest} available (current: v${info.current})`}
        </span>
        <button
          onClick={handleOpenUpdate}
          className="px-2 py-0.5 rounded-md text-xs font-medium bg-[var(--amber)] text-white transition-colors hover:opacity-90"
        >
          {u?.updateNow ?? 'Update'}
        </button>
        <a
          href="https://github.com/GeminiLight/mindos/releases"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground underline hover:text-foreground transition-colors hidden sm:inline"
        >
          {u?.releaseNotes ?? 'Release notes'}
        </a>
      </div>
      <button
        onClick={handleDismiss}
        className="p-0.5 rounded hover:bg-muted transition-colors shrink-0 text-muted-foreground"
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
