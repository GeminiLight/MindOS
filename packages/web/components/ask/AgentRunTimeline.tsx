'use client';

import { memo, useMemo } from 'react';
import { AlertTriangle, Bot, CheckCircle2, CircleStop, Clock3, Loader2, ShieldCheck } from 'lucide-react';
import type { AgentRunTimelinePart, AgentRunTimelineRecord } from '@/lib/types';
import { cn } from '@/lib/utils';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled', 'timed_out']);

function runtimeLabel(run: AgentRunTimelineRecord): string {
  if (run.agentKind === 'native-runtime') {
    const kind = typeof run.metadata?.runtimeKind === 'string' ? run.metadata.runtimeKind : run.runtimeId;
    if (kind === 'codex') return 'Codex';
    if (kind === 'claude') return 'Claude Code';
  }
  if (run.agentKind === 'pi-subagent') return 'Subagent';
  if (run.agentKind === 'acp') return 'ACP Agent';
  if (run.agentKind === 'a2a') return 'Remote Agent';
  if (run.agentKind === 'mindos-headless') return 'MindOS Headless';
  return 'MindOS Agent';
}

function statusLabel(status: AgentRunTimelineRecord['status']): string {
  if (status === 'queued') return 'Queued';
  if (status === 'running') return 'Running';
  if (status === 'streaming') return 'Streaming';
  if (status === 'completed') return 'Completed';
  if (status === 'failed') return 'Failed';
  if (status === 'canceled') return 'Canceled';
  return 'Timed out';
}

function statusIcon(status: AgentRunTimelineRecord['status']) {
  if (status === 'completed') return <CheckCircle2 size={13} className="text-success" />;
  if (status === 'failed' || status === 'timed_out') return <AlertTriangle size={13} className="text-error" />;
  if (status === 'canceled') return <CircleStop size={13} className="text-muted-foreground" />;
  return <Loader2 size={13} className="animate-spin text-[var(--amber)]" />;
}

function formatDuration(run: AgentRunTimelineRecord): string {
  const duration = run.durationMs ?? (
    run.completedAt && run.startedAt ? Math.max(0, run.completedAt - run.startedAt) : undefined
  );
  if (duration === undefined) return '';
  if (duration < 1000) return `${duration}ms`;
  return `${(duration / 1000).toFixed(duration < 10_000 ? 1 : 0)}s`;
}

function truncateText(text: string, max = 140): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}...` : compact;
}

function AgentRunRow({ run }: { run: AgentRunTimelineRecord }) {
  const duration = formatDuration(run);
  const detail = run.error || run.outputSummary || run.inputSummary;
  const active = !TERMINAL_STATUSES.has(run.status);

  return (
    <li className="flex min-w-0 items-start gap-2 py-1.5">
      <div className="mt-0.5 shrink-0">{statusIcon(run.status)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          <span className="truncate font-medium text-foreground">{run.displayName || runtimeLabel(run)}</span>
          <span className="shrink-0 text-muted-foreground/60">·</span>
          <span className={cn(
            'shrink-0 text-[11px] font-medium',
            active ? 'text-[var(--amber)]' : run.status === 'completed' ? 'text-success' : run.status === 'failed' || run.status === 'timed_out' ? 'text-error' : 'text-muted-foreground',
          )}>
            {statusLabel(run.status)}
          </span>
          {duration && (
            <>
              <span className="shrink-0 text-muted-foreground/60">·</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{duration}</span>
            </>
          )}
        </div>
        {detail && (
          <div className="mt-0.5 [overflow-wrap:anywhere] text-[11px] leading-relaxed text-muted-foreground">
            {truncateText(detail)}
          </div>
        )}
      </div>
      <div
        title={`Permission: ${run.permissionMode}`}
        className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-border/40 bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
      >
        <ShieldCheck size={10} />
        <span>{run.permissionMode}</span>
      </div>
    </li>
  );
}

const AgentRunTimeline = memo(function AgentRunTimeline({ part }: { part: AgentRunTimelinePart }) {
  const runs = useMemo(() => (
    [...part.runs]
      .filter((run) => run.agentKind !== 'mindos-main')
      .sort((a, b) => a.startedAt - b.startedAt)
  ), [part.runs]);

  if (runs.length === 0) return null;

  const activeCount = runs.filter((run) => !TERMINAL_STATUSES.has(run.status)).length;

  return (
    <div className="my-2 rounded-lg border border-border/40 bg-muted/25 px-2.5 py-2" aria-label="Agent activity">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase text-muted-foreground">
          <Bot size={12} />
          <span>Agent activity</span>
        </div>
        <div className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          {activeCount > 0 ? (
            <>
              <Loader2 size={11} className="animate-spin text-[var(--amber)]" />
              <span>{activeCount} active</span>
            </>
          ) : (
            <>
              <Clock3 size={11} />
              <span>{runs.length} run{runs.length === 1 ? '' : 's'}</span>
            </>
          )}
        </div>
      </div>
      <ul className="divide-y divide-border/25">
        {runs.map((run) => <AgentRunRow key={run.id} run={run} />)}
      </ul>
    </div>
  );
});

export default AgentRunTimeline;
