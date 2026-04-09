'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Circle, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { PLATFORMS, type PlatformStatus } from '@/lib/im/platforms';

/** Simple sidebar nav list for IM channels — icon + name + status dot. */
export default function IMChannelsView() {
  const { t } = useLocale();
  const im = t.panels.im;
  const searchParams = useSearchParams();
  const activePlatform = searchParams.get('platform');

  const [statuses, setStatuses] = useState<PlatformStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchStatuses = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch('/api/im/status');
      if (res.ok) {
        const data = await res.json();
        setStatuses(data.platforms ?? []);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStatuses(); }, [fetchStatuses]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 px-3">
        <AlertCircle size={16} className="text-muted-foreground" />
        <p className="text-2xs text-muted-foreground">{im.fetchError}</p>
        <button
          type="button"
          onClick={() => { setLoading(true); fetchStatuses(); }}
          className="inline-flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw size={11} /> {im.retry}
        </button>
      </div>
    );
  }

  const configuredCount = statuses.filter(s => s.connected).length;
  const getStatus = (id: string) => statuses.find(s => s.platform === id);

  return (
    <div className="flex flex-col py-1">
      {/* Section header */}
      <div className="flex items-center gap-2 px-3 py-1.5 mb-0.5">
        <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">{im.title}</span>
        {configuredCount > 0 && (
          <span className="text-2xs text-muted-foreground/60">{configuredCount} {im.connected}</span>
        )}
      </div>

      {/* Platform list */}
      <div className="flex flex-col">
        {PLATFORMS.map(({ id, name, icon }) => {
          const status = getStatus(id);
          const isConnected = status?.connected ?? false;
          const isActive = activePlatform === id;

          return (
            <Link
              key={id}
              href={`/agents?tab=channels&platform=${id}`}
              className={`
                relative flex items-center gap-2.5 px-3 py-2 text-left rounded-sm transition-colors
                ${isActive
                  ? 'bg-[var(--amber-dim)]/40 pl-3.5'
                  : 'hover:bg-muted/50'
                }
              `}
            >
              {isActive && (
                <span
                  className="pointer-events-none absolute bottom-[22%] left-0 top-[22%] w-0.5 rounded-r-full bg-[var(--amber)]"
                  aria-hidden
                />
              )}
              <span className="text-sm">{icon}</span>
              <span className="text-sm flex-1 truncate text-foreground">{name}</span>
              {isConnected ? (
                <CheckCircle2 size={14} className="text-success shrink-0" />
              ) : (
                <Circle size={14} className="text-border shrink-0" />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
