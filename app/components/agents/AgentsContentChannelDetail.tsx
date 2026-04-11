'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertCircle, RefreshCw } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { getPlatform, type PlatformStatus } from '@/lib/im/platforms';
import type { IMActivity } from '@/lib/im/types';

import { SkeletonBlock } from './channel-detail/shared';
import { ChannelHeader } from './channel-detail/ChannelHeader';
import { ChannelSetupFlow } from './channel-detail/ChannelSetupFlow';
import { ChannelStatusBar } from './channel-detail/ChannelStatusBar';
import { ChannelConversation } from './channel-detail/ChannelConversation';
import { ChannelActivityFeed } from './channel-detail/ChannelActivityFeed';
import { ChannelTestSend } from './channel-detail/ChannelTestSend';
import { ChannelSettings } from './channel-detail/ChannelSettings';
import { getCachedStatuses, setCachedStatuses, getCachedActivities, setCachedActivities } from './channel-detail/cache';

type DetailLoadState = 'loading' | 'ready' | 'error';

function LoadingSkeleton() {
  return (
    <div className="max-w-3xl animate-pulse space-y-4">
      <SkeletonBlock className="h-5 w-28" />
      <div className="flex items-start gap-3">
        <SkeletonBlock className="h-10 w-10 rounded-lg" />
        <div className="flex-1 space-y-2">
          <SkeletonBlock className="h-6 w-36" />
          <SkeletonBlock className="h-4 w-48" />
        </div>
      </div>
      <SkeletonBlock className="h-16 w-full rounded-lg" />
      <SkeletonBlock className="h-32 w-full rounded-lg" />
      <SkeletonBlock className="h-24 w-full rounded-lg" />
    </div>
  );
}

export default function AgentsContentChannelDetail({ platformId }: { platformId: string }) {
  const { t, locale } = useLocale();
  const im = t.panels.im;
  const platform = getPlatform(platformId);

  // Stale-while-revalidate: show cached data immediately, fetch in background
  const cachedStatus = getCachedStatuses();
  const cachedActivity = getCachedActivities(platformId);
  const hasCachedData = cachedStatus.data.length > 0;

  const [loadState, setLoadState] = useState<DetailLoadState>(hasCachedData ? 'ready' : 'loading');
  const [status, setStatus] = useState<PlatformStatus | null>(
    hasCachedData ? (cachedStatus.data.find(p => p.platform === platformId) ?? null) : null,
  );
  const [activities, setActivities] = useState<IMActivity[]>(cachedActivity.data);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  const fetchDetail = useCallback(async (background = false) => {
    if (!background) setLoadState('loading');
    else setRefreshing(true);
    try {
      const [statusRes, activityRes] = await Promise.all([
        fetch('/api/im/status'),
        fetch(`/api/im/activity?platform=${platformId}&limit=5`),
      ]);
      if (!mountedRef.current) return;
      if (!statusRes.ok || !activityRes.ok) { if (!background) setLoadState('error'); return; }

      const statusData = await statusRes.json();
      const activityData = await activityRes.json();
      const platforms: PlatformStatus[] = statusData.platforms ?? [];
      const nextActivities: IMActivity[] = activityData.activities ?? [];

      // Update cache
      setCachedStatuses(platforms);
      setCachedActivities(platformId, nextActivities);

      if (!mountedRef.current) return;
      setStatus(platforms.find(p => p.platform === platformId) ?? null);
      setActivities(nextActivities);
      setLoadState('ready');
    } catch {
      if (!background && mountedRef.current) setLoadState('error');
    }
    if (mountedRef.current) setRefreshing(false);
  }, [platformId]);

  useEffect(() => {
    mountedRef.current = true;
    // If we have cached data, do a background revalidation
    if (hasCachedData && cachedStatus.stale) {
      fetchDetail(true);
    } else if (!hasCachedData) {
      fetchDetail(false);
    }
    return () => { mountedRef.current = false; };
  }, [fetchDetail, hasCachedData, cachedStatus.stale]);

  if (!platform) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-muted-foreground">Unknown platform: {platformId}</p>
        <Link href="/agents?tab=channels" className="text-xs text-[var(--amber)] hover:underline mt-2 inline-block">
          {im.backToChannels}
        </Link>
      </div>
    );
  }

  const isConnected = status?.connected ?? false;
  const isFeishu = platformId === 'feishu';
  const webhookState = status?.webhook?.state ?? 'disabled';
  const purpose = locale === 'zh' ? (platform.purposeZh ?? platform.purpose ?? im.emptyDesc) : (platform.purpose ?? im.emptyDesc);
  const recipientExample = locale === 'zh' ? (platform.recipientExampleZh ?? platform.recipientExample) : platform.recipientExample;

  return (
    <div className="max-w-3xl">
      {/* Back link */}
      <div className="flex items-center justify-between mb-6">
        <Link
          href="/agents?tab=channels"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
          {im.backToChannels}
        </Link>
        {refreshing && (
          <span className="text-xs text-muted-foreground/60 animate-pulse">
            <RefreshCw size={12} className="inline animate-spin mr-1" />
          </span>
        )}
      </div>

      {loadState === 'loading' ? (
        <LoadingSkeleton />
      ) : loadState === 'error' ? (
        <div className="rounded-lg border border-border bg-card p-8 shadow-sm text-center">
          <AlertCircle size={22} className="mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-foreground mb-1">{im.fetchError}</p>
          <p className="text-xs text-muted-foreground mb-4">{im.thisIsNotChat}</p>
          <button
            type="button"
            onClick={() => fetchDetail(false)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <RefreshCw size={14} />
            {im.retry}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <ChannelHeader
            platform={platform}
            status={status}
            im={im}
            purpose={purpose}
            isConnected={isConnected}
          />

          {isConnected ? (
            <>
              <ChannelStatusBar
                status={status}
                activities={activities}
                im={im}
                locale={locale}
                isFeishu={isFeishu}
                webhookState={webhookState}
              />

              {isFeishu && (
                <ChannelConversation
                  status={status?.webhook}
                  im={im}
                  platform={platform}
                  onSaved={() => fetchDetail(true)}
                />
              )}

              <ChannelActivityFeed
                activities={activities}
                im={im}
                locale={locale}
              />

              <ChannelTestSend
                platformId={platformId}
                im={im}
                recipientExample={recipientExample}
                onSent={() => fetchDetail(true)}
              />

              <ChannelSettings
                platform={platform}
                im={im}
                onSaved={() => fetchDetail(true)}
                onDisconnected={() => { setActivities([]); fetchDetail(false); }}
              />
            </>
          ) : (
            <ChannelSetupFlow
              platform={platform}
              im={im}
              locale={locale}
              onSaved={() => fetchDetail(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
