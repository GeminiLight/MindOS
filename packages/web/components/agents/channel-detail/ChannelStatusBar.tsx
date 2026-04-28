import type { PlatformStatus } from '@/lib/im/platforms';
import type { IMActivity } from '@/lib/im/types';
import { formatRelativeTime, StatusDot } from './shared';
import { maskForLog } from '@/lib/im/format';

export function ChannelStatusBar({ status, activities, im, locale, isFeishu, webhookState }: {
  status: PlatformStatus | null;
  activities: IMActivity[];
  im: Record<string, any>;
  locale: string;
  isFeishu: boolean;
  webhookState: string;
}) {
  const latestActivity = activities[0] ?? null;
  const relativeTime = latestActivity
    ? locale === 'zh' ? new Date(latestActivity.timestamp).toLocaleString('zh-CN') : formatRelativeTime(latestActivity.timestamp)
    : null;

  const modeLabel = isFeishu && webhookState === 'ready' ? im.twoWayConversation : im.notificationsOnly;

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border">
        <StatusCell label="Bot" value={status?.botName || '--'} mono />
        <StatusCell label={im.lastActivity} value={relativeTime || im.notAvailable} />
        <StatusCell label={im.currentMode} badge={modeLabel} />
        <StatusCell
          label={im.lastRecipient}
          value={latestActivity ? maskForLog(latestActivity.recipient) : '--'}
          mono
        />
      </div>
    </div>
  );
}

function StatusCell({ label, value, badge, mono }: {
  label: string;
  value?: string;
  badge?: string;
  mono?: boolean;
}) {
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      {badge ? (
        <span className="inline-flex items-center rounded-md bg-[var(--amber-dim)] px-2 py-0.5 text-xs font-medium text-[var(--amber)]">
          {badge}
        </span>
      ) : (
        <p className={`text-sm text-foreground truncate ${mono ? 'font-mono' : ''}`}>{value}</p>
      )}
    </div>
  );
}
