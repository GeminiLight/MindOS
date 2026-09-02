'use client';

import { Bell, Check, CircleAlert, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  StudioAutomationApproval,
  StudioAutomationNotification,
  StudioAutomationPayload,
} from '@/lib/studio-automations';
import { cn } from '@/lib/utils';
import type { StudioAutomationCopy } from './StudioAutomationView';

export function AutomationOperations({
  payload,
  copy,
  busyId,
  onResolveApproval,
  onDismissNotification,
  onDismissAllNotifications,
}: {
  payload: StudioAutomationPayload;
  copy: StudioAutomationCopy;
  busyId: string | null;
  onResolveApproval: (approval: StudioAutomationApproval, decision: 'allow' | 'deny') => void;
  onDismissNotification: (notification: StudioAutomationNotification) => void;
  onDismissAllNotifications: () => void;
}) {
  const pendingApprovals = payload.approvals.filter((approval) => approval.status === 'pending');
  const unreadNotifications = payload.notifications.filter((notification) => !notification.readAt);
  const workerLabel = !payload.worker
    ? copy.executorOffline
    : payload.worker.status === 'running' || payload.worker.status === 'idle'
      ? copy.executorOnline
      : payload.worker.status === 'error'
        ? copy.executorError
        : copy.executorStopped;
  const workerHealthy = payload.worker?.status === 'running' || payload.worker?.status === 'idle';

  return (
    <div data-studio-automation-operations className="grid gap-3 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
      <section className="rounded-lg border border-border/60 bg-background/35 p-3" aria-label={workerLabel}>
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className={cn('flex size-7 items-center justify-center rounded-md', workerHealthy ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>
            {workerHealthy ? <Check size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
          </span>
          {workerLabel}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {payload.worker?.lastError || copy.runtimeNote}
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-lg border border-border/60 bg-background/35 p-3" aria-label={copy.pendingApprovals}>
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <ShieldCheck size={14} className="text-[var(--amber)]" aria-hidden="true" />
            {copy.pendingApprovals}
            <span className="ml-auto text-muted-foreground">{pendingApprovals.length}</span>
          </div>
          {pendingApprovals.slice(0, 3).map((approval) => (
            <div key={approval.id} className="mt-3 border-t border-border/50 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-medium text-foreground">{approval.toolName}</span>
                <span className="text-[10px] uppercase text-muted-foreground">{approval.runtime}</span>
              </div>
              {approval.resource ? <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{approval.resource}</p> : null}
              {approval.risk?.summary ? <p className="mt-1 text-xs text-muted-foreground">{approval.risk.summary}</p> : null}
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="amber" disabled={busyId === approval.id} onClick={() => onResolveApproval(approval, 'allow')}>{copy.allowOnce}</Button>
                <Button size="sm" variant="outline" disabled={busyId === approval.id} onClick={() => onResolveApproval(approval, 'deny')}>{copy.deny}</Button>
              </div>
            </div>
          ))}
        </section>

        <section className="rounded-lg border border-border/60 bg-background/35 p-3" aria-label={copy.notifications}>
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Bell size={14} className="text-[var(--amber)]" aria-hidden="true" />
            {copy.notifications}
            <span className="ml-auto text-muted-foreground">{unreadNotifications.length}</span>
            {unreadNotifications.length > 1 ? (
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={onDismissAllNotifications}>{copy.dismissAll}</Button>
            ) : null}
          </div>
          {unreadNotifications.slice(0, 3).map((notification) => (
            <div key={notification.id} className="mt-3 border-t border-border/50 pt-3">
              <p className="text-xs font-medium text-foreground">{notification.title}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{notification.body}</p>
              <Button size="sm" variant="ghost" className="mt-1 px-0" disabled={busyId === notification.id} onClick={() => onDismissNotification(notification)}>{copy.dismiss}</Button>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
