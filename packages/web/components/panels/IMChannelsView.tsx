'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { countConnectedChannels, resolveChannelListStatus } from '@/lib/im/display';
import { PLATFORMS } from '@/lib/im/platforms';
import { ChannelIcon } from '@/components/agents/ChannelIcon';
import { ChannelStatusIndicator } from '@/components/agents/ChannelStatusIndicator';
import { useChannelStatuses } from '@/components/agents/channel-detail/useChannelStatuses';

export default function IMChannelsView() {
  const { t } = useLocale();
  const im = t.panels.im;
  const searchParams = useSearchParams();
  const activePlatform = searchParams.get('platform');
  const { statuses, loading, error, refresh } = useChannelStatuses();

  if (loading) {
    return (
      <div className="px-3 py-4">
        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          <span>{im.title}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-3">
        <div className="rounded-md border border-border bg-card p-3">
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
            <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">{im.fetchError}</p>
          </div>
          <button
            type="button"
            onClick={() => { void refresh(); }}
            className="mt-2 inline-flex items-center gap-1.5 rounded-sm px-0 text-xs font-medium text-foreground transition-colors hover:text-[var(--amber)]"
          >
            <RefreshCw size={12} /> {im.retry}
          </button>
        </div>
      </div>
    );
  }

  const configuredCount = countConnectedChannels(statuses);
  const total = PLATFORMS.length;
  const getStatus = (id: string) => statuses.find(s => s.platform === id);
  const statusLabels = {
    unconfigured: im.statusUnconfigured,
    configured: im.statusConfigured,
    running: im.statusRunning,
    issue: im.statusIssue,
  };

  return (
    <div className="flex flex-col gap-2 px-2 py-2">
      <div className="flex items-center justify-between gap-2 px-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{im.title}</span>
        <span
          className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] leading-4 text-muted-foreground"
          aria-label={`${configuredCount} / ${total}`}
          title={`${configuredCount} / ${total}`}
        >
          {configuredCount}/{total}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {PLATFORMS.map((platform) => {
          const status = getStatus(platform.id);
          const isActive = activePlatform === platform.id;
          const channelStatus = resolveChannelListStatus(status);

          return (
            <Link
              key={platform.id}
              href={`/agents?tab=channels&platform=${platform.id}`}
              aria-current={isActive ? 'page' : undefined}
              className={`
                group relative grid min-h-[42px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-[background-color,border-color,color,box-shadow] duration-150
                ${isActive
                  ? 'border-[var(--amber)]/35 bg-[var(--amber-dim)]/45 shadow-sm'
                  : 'border-transparent hover:border-border/60 hover:bg-muted/45'
                }
              `}
            >
              <ChannelIcon
                platform={platform}
                size="sm"
                className={isActive ? 'border-[var(--amber)]/35 bg-[var(--amber)]/10' : 'bg-background/80'}
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium leading-5 text-foreground" title={platform.name}>{platform.name}</span>
              </span>
              <ChannelStatusIndicator status={channelStatus} labels={statusLabels} className="h-6 w-6" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
