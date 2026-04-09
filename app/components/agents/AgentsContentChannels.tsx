'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, CheckCircle2, Circle, RefreshCw, AlertCircle } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';

// ─── Types ────────────────────────────────────────────────────────────────────

type PlatformStatus = {
  platform: string;
  connected: boolean;
  botName?: string;
  capabilities: string[];
};

const ALL_PLATFORMS = [
  { id: 'telegram', name: 'Telegram', icon: '📱' },
  { id: 'feishu', name: 'Feishu', icon: '🐦' },
  { id: 'discord', name: 'Discord', icon: '💬' },
  { id: 'slack', name: 'Slack', icon: '💼' },
  { id: 'wecom', name: 'WeCom', icon: '🏢' },
  { id: 'dingtalk', name: 'DingTalk', icon: '🔔' },
  { id: 'wechat', name: 'WeChat', icon: '💚' },
  { id: 'qq', name: 'QQ', icon: '🐧' },
] as const;

// ─── Component ────────────────────────────────────────────────────────────────

export default function AgentsContentChannels() {
  const { t } = useLocale();
  const im = t.panels.im;

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
      <div className="flex justify-center py-16">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <AlertCircle size={24} className="mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground mb-3">{im.fetchError}</p>
        <button
          type="button"
          onClick={() => { setLoading(true); fetchStatuses(); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <RefreshCw size={12} /> {im.retry}
        </button>
      </div>
    );
  }

  const connected = statuses.filter(s => s.connected).length;
  const total = ALL_PLATFORMS.length;
  const getStatus = (id: string) => statuses.find(s => s.platform === id);

  return (
    <div className="max-w-3xl mx-auto px-6 py-6">
      {/* Header */}
      <h1 className="text-lg font-semibold text-foreground mb-1">{im.title}</h1>
      <p className="text-sm text-muted-foreground mb-6">{im.emptyDesc}</p>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-2xs text-muted-foreground uppercase tracking-wider mb-1">{im.statsConnected}</div>
          <div className="text-2xl font-semibold text-foreground tabular-nums">
            {connected}<span className="text-sm text-muted-foreground font-normal">/{total}</span>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-2xs text-muted-foreground uppercase tracking-wider mb-1">{im.statsSupported}</div>
          <div className="text-2xl font-semibold text-foreground tabular-nums">{total}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-2xs text-muted-foreground uppercase tracking-wider mb-1">{im.statsStatus}</div>
          <div className="text-sm text-foreground mt-1">
            {connected > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-success">
                <CheckCircle2 size={14} /> {im.statsReady}
              </span>
            ) : (
              <span className="text-muted-foreground">{im.statsNotConfigured}</span>
            )}
          </div>
        </div>
      </div>

      {/* Platform overview */}
      <h2 className="text-sm font-medium text-foreground mb-3">{im.platformsTitle}</h2>
      <div className="grid grid-cols-2 gap-3">
        {ALL_PLATFORMS.map(({ id, name, icon }) => {
          const status = getStatus(id);
          const isConnected = status?.connected ?? false;

          return (
            <div
              key={id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
            >
              <span className="text-lg">{icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">{name}</div>
                {isConnected && status?.botName ? (
                  <div className="text-2xs text-muted-foreground font-mono truncate">{status.botName}</div>
                ) : (
                  <div className="text-2xs text-muted-foreground">{isConnected ? im.statusConnected : im.notConfigured}</div>
                )}
                {isConnected && status?.capabilities && status.capabilities.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {status.capabilities.slice(0, 3).map(cap => (
                      <span key={cap} className="text-2xs px-1 py-0.5 rounded bg-muted text-muted-foreground/70">{cap}</span>
                    ))}
                  </div>
                )}
              </div>
              {isConnected ? (
                <CheckCircle2 size={16} className="text-success shrink-0" />
              ) : (
                <Circle size={16} className="text-border shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      {/* Hint to use sidebar for configuration */}
      <p className="text-2xs text-muted-foreground/60 mt-6 text-center">
        {im.configHint}
      </p>
    </div>
  );
}
