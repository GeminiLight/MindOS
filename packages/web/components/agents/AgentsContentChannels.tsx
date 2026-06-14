'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, CheckCircle2, RefreshCw, AlertCircle, MessageSquare } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { countConnectedChannels, resolveChannelListStatus } from '@/lib/im/display';
import { PLATFORMS } from '@/lib/im/platforms';
import AgentsContentChannelDetail from './AgentsContentChannelDetail';
import { AgentSectionHeading } from './AgentsPrimitives';
import { ChannelStatusIndicator } from './ChannelStatusIndicator';
import { ChannelIcon } from './ChannelIcon';
import { useChannelStatuses } from './channel-detail/useChannelStatuses';

export default function AgentsContentChannels() {
  const searchParams = useSearchParams();
  const platformId = searchParams.get('platform');

  // If a specific platform is selected, show detail page
  if (platformId) {
    return <AgentsContentChannelDetail platformId={platformId} />;
  }

  // Otherwise show overview
  return <ChannelsOverview />;
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function ChannelsOverview() {
  const { t } = useLocale();
  const im = t.panels.im;
  const { statuses, loading, error, refresh } = useChannelStatuses();

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16">
        <AlertCircle size={24} className="mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground mb-3">{im.fetchError}</p>
        <button
          type="button"
          onClick={() => { void refresh(); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <RefreshCw size={12} /> {im.retry}
        </button>
      </div>
    );
  }

  const configured = countConnectedChannels(statuses);
  const total = PLATFORMS.length;
  const getStatus = (id: string) => statuses.find(s => s.platform === id);
  const statusLabels = {
    unconfigured: im.statusUnconfigured,
    configured: im.statusConfigured,
    running: im.statusRunning,
    issue: im.statusIssue,
  };

  return (
    <div className="max-w-4xl">
      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{im.statsConnected}</div>
          <div className="text-3xl font-semibold text-foreground tabular-nums">
            {configured}<span className="text-sm text-muted-foreground font-normal ml-1">/ {total}</span>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{im.statsSupported}</div>
          <div className="text-3xl font-semibold text-foreground tabular-nums">{total}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{im.statsStatus}</div>
          <div className="text-sm text-foreground">
            {configured > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-success">
                <CheckCircle2 size={14} /> {im.statsReady}
              </span>
            ) : (
              <span className="text-muted-foreground">{im.statsNotConfigured}</span>
            )}
          </div>
        </div>
      </div>

      {/* Platform grid — clickable */}
      <AgentSectionHeading
        icon={<MessageSquare size={13} aria-hidden="true" />}
        title={im.platformsTitle}
        className="mb-4"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PLATFORMS.map((platform) => {
          const status = getStatus(platform.id);
          const channelStatus = resolveChannelListStatus(status);

          return (
            <Link
              key={platform.id}
              href={`/agents?tab=channels&platform=${platform.id}`}
              className="grid min-h-[64px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm transition-all hover:border-[var(--amber)]/50 hover:bg-card/80 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChannelIcon platform={platform} size="md" />
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-medium text-foreground" title={platform.name}>{platform.name}</div>
              </div>
              <ChannelStatusIndicator status={channelStatus} labels={statusLabels} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
