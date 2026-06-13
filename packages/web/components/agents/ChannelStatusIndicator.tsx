'use client';

import { AlertCircle, CheckCircle2, Circle, Radio } from 'lucide-react';
import type { ChannelListStatus } from '@/lib/im/display';
import { cn } from '@/lib/utils';

type ChannelStatusLabels = Record<ChannelListStatus, string>;

function statusClassName(status: ChannelListStatus): string {
  if (status === 'running') return 'border-success/25 bg-success/10 text-success';
  if (status === 'configured') return 'border-[var(--amber)]/25 bg-[var(--amber)]/10 text-[var(--amber-text)]';
  if (status === 'issue') return 'border-error/25 bg-error/10 text-error';
  return 'border-border bg-muted text-muted-foreground';
}

function StatusIcon({ status }: { status: ChannelListStatus }) {
  if (status === 'running') return <Radio size={13} aria-hidden="true" />;
  if (status === 'configured') return <CheckCircle2 size={13} aria-hidden="true" />;
  if (status === 'issue') return <AlertCircle size={13} aria-hidden="true" />;
  return <Circle size={13} aria-hidden="true" />;
}

export function ChannelStatusIndicator({
  status,
  labels,
  className,
}: {
  status: ChannelListStatus;
  labels: ChannelStatusLabels;
  className?: string;
}) {
  const label = labels[status];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
        statusClassName(status),
        className,
      )}
    >
      <StatusIcon status={status} />
    </span>
  );
}
