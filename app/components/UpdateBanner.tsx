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
    // Don't check for updates on setup or login pages
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      if (path === '/setup' || path === '/login') return;
    }

    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch<{ hasUpdate: boolean; latest: string; current: string }>('/api/update-check');
        if (!data.hasUpdate) return;

        const dismissed = localStorage.getItem('mindos_update_dismissed');
        if (data.latest === dismissed) return;

        setInfo({ latest: data.latest, current: data.current });
      } catch {
        // Network error / API failure — silent
      }
    }, 3000); // Check 3s after page load, don't block first paint

    return () => clearTimeout(timer);
  }, []);

  if (!info) return null;

  const handleDismiss = () => {
    localStorage.setItem('mindos_update_dismissed', info.latest);
    setInfo(null);
  };

  const updateT = t.updateBanner;

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2 text-xs"
      style={{ background: 'var(--amber-subtle, rgba(200,135,30,0.08))', borderBottom: '1px solid var(--border)' }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-medium" style={{ color: 'var(--amber)' }}>
          {updateT?.newVersion
            ? updateT.newVersion(info.latest, info.current)
            : `MindOS v${info.latest} available (current: v${info.current})`}
        </span>
        <span className="text-muted-foreground">
          {updateT?.runUpdate ?? 'Run'}{' '}
          <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs">mindos update</code>
          {updateT?.orSee ? (
            <>
              {' '}{updateT.orSee}{' '}
              <a
                href="https://github.com/GeminiLight/mindos/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground transition-colors"
              >
                {updateT.releaseNotes}
              </a>
            </>
          ) : (
            <>
              {' '}or{' '}
              <a
                href="https://github.com/GeminiLight/mindos/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground transition-colors"
              >
                view release notes
              </a>
            </>
          )}
        </span>
      </div>
      <button
        onClick={handleDismiss}
        className="p-0.5 rounded hover:bg-muted transition-colors shrink-0"
        style={{ color: 'var(--muted-foreground)' }}
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
