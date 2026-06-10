'use client';

import { Fragment, memo, useMemo, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, ChevronDown, ChevronRight, CircleStop, Clock3, FileText, Loader2, MessageSquareMore, ShieldCheck, Terminal, TextCursorInput } from 'lucide-react';
import type { AgentRunTimelineEvent, AgentRunTimelinePart, AgentRunTimelineRecord } from '@/lib/types';
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

function eventIcon(event: AgentRunTimelineEvent) {
  if (event.category === 'tool') return <Terminal size={11} />;
  if (event.category === 'file') return <FileText size={11} />;
  if (event.category === 'permission') return <ShieldCheck size={11} />;
  if (event.category === 'question') return <MessageSquareMore size={11} />;
  if (event.category === 'text') return <TextCursorInput size={11} />;
  if (event.category === 'error') return <AlertTriangle size={11} />;
  return <Clock3 size={11} />;
}

function eventTone(event: AgentRunTimelineEvent): 'error' | 'active' | 'muted' {
  if (event.category === 'error' || event.type === 'run_failed') return 'error';
  if (event.type === 'tool_started' || event.type === 'permission_requested' || event.type === 'user_question_started') return 'active';
  if (event.data?.kind === 'tool' && (event.data.status === 'started' || event.data.status === 'running')) return 'active';
  if (event.data?.kind === 'permission' && event.data.status === 'requested') return 'active';
  if (event.data?.kind === 'question' && event.data.status === 'requested') return 'active';
  return 'muted';
}

function eventTitle(event: AgentRunTimelineEvent): string {
  if (event.data?.kind === 'tool') {
    return `${event.data.name}${event.data.status ? ` ${event.data.status}` : ''}`;
  }
  if (event.data?.kind === 'file') {
    return `${event.data.action} ${event.data.path}`;
  }
  if (event.data?.kind === 'permission') {
    return `${event.data.action} ${event.data.status}`;
  }
  if (event.data?.kind === 'question') {
    return `user question ${event.data.status}`;
  }
  if (event.data?.kind === 'error') {
    return event.data.message;
  }
  if (event.data?.kind === 'text') {
    return event.data.channel ?? 'text';
  }
  if (event.data?.kind === 'status') {
    return statusLabel(event.data.nextStatus);
  }
  return event.title || event.message || event.type.replace(/_/g, ' ');
}

function eventSummary(event: AgentRunTimelineEvent): string | null {
  if (event.data?.kind === 'tool') {
    return event.data.error || event.data.outputSummary || event.data.inputSummary || event.message || null;
  }
  if (event.data?.kind === 'file') {
    return event.data.summary || event.message || null;
  }
  if (event.data?.kind === 'permission') {
    return event.data.prompt || event.data.resource || event.message || null;
  }
  if (event.data?.kind === 'question') {
    return event.data.summary || event.data.prompt || event.message || null;
  }
  if (event.data?.kind === 'text') {
    return event.data.text || event.message || null;
  }
  if (event.data?.kind === 'status') {
    return event.data.summary || event.message || null;
  }
  return event.message || null;
}

type AgentRunTreeNode = {
  run: AgentRunTimelineRecord;
  children: AgentRunTreeNode[];
};

function sortRuns(a: AgentRunTimelineRecord, b: AgentRunTimelineRecord): number {
  return a.startedAt - b.startedAt || a.id.localeCompare(b.id);
}

function sortTree(nodes: AgentRunTreeNode[]): AgentRunTreeNode[] {
  return nodes
    .sort((a, b) => sortRuns(a.run, b.run))
    .map((node) => ({ ...node, children: sortTree(node.children) }));
}

function buildRunTree(runs: AgentRunTimelineRecord[]): AgentRunTreeNode[] {
  const nodes = new Map<string, AgentRunTreeNode>();
  for (const run of runs) {
    nodes.set(run.id, { run, children: [] });
  }

  const roots: AgentRunTreeNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.run.parentRunId;
    const parent = parentId && parentId !== node.run.id ? nodes.get(parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return sortTree(roots);
}

type ChildStatusSummary = {
  active: number;
  failed: number;
  timedOut: number;
  canceled: number;
};

function collectChildStatusSummary(node: AgentRunTreeNode): ChildStatusSummary {
  const summary: ChildStatusSummary = { active: 0, failed: 0, timedOut: 0, canceled: 0 };
  const visit = (child: AgentRunTreeNode) => {
    if (child.run.status === 'failed') summary.failed += 1;
    else if (child.run.status === 'timed_out') summary.timedOut += 1;
    else if (child.run.status === 'canceled') summary.canceled += 1;
    else if (!TERMINAL_STATUSES.has(child.run.status)) summary.active += 1;
    for (const grandchild of child.children) visit(grandchild);
  };
  for (const child of node.children) visit(child);
  return summary;
}

function compactCountLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function childStatusBadges(summary: ChildStatusSummary): Array<{ label: string; tone: 'error' | 'active' | 'muted' }> {
  const badges: Array<{ label: string; tone: 'error' | 'active' | 'muted' }> = [];
  if (summary.failed > 0) badges.push({ label: compactCountLabel(summary.failed, 'failed'), tone: 'error' });
  if (summary.timedOut > 0) badges.push({ label: compactCountLabel(summary.timedOut, 'timed out', 'timed out'), tone: 'error' });
  if (summary.active > 0) badges.push({ label: compactCountLabel(summary.active, 'active'), tone: 'active' });
  if (summary.canceled > 0) badges.push({ label: compactCountLabel(summary.canceled, 'canceled'), tone: 'muted' });
  return badges;
}

function AgentRunRow({
  node,
  depth,
  expanded,
  collapsed,
  events,
  onToggle,
}: {
  node: AgentRunTreeNode;
  depth: number;
  expanded: boolean;
  collapsed: ReadonlySet<string>;
  events: AgentRunTimelineEvent[];
  onToggle: (id: string) => void;
}) {
  const { run } = node;
  const duration = formatDuration(run);
  const detail = run.error || run.outputSummary || run.inputSummary;
  const active = !TERMINAL_STATUSES.has(run.status);
  const childCount = node.children.length;
  const childBadges = childStatusBadges(collectChildStatusSummary(node));
  const visibleEvents = events
    .filter((event) => event.visibility !== 'debug')
    .sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))
    .slice(-4);

  return (
    <li className="min-w-0">
      <div className={cn('flex min-w-0 items-start gap-2 rounded-md py-1.5', depth > 0 && 'pl-2')}>
        <div className="mt-0.5 flex w-4 shrink-0 items-center justify-center">
          {childCount > 0 ? (
            <button
              type="button"
              onClick={() => onToggle(run.id)}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${run.displayName || runtimeLabel(run)} child runs`}
              className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <span className="size-4" aria-hidden="true" />
          )}
        </div>
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
            {childCount > 0 && (
              <>
                <span className="shrink-0 text-muted-foreground/60">·</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{childCount} child run{childCount === 1 ? '' : 's'}</span>
              </>
            )}
            {childBadges.map((badge) => (
              <Fragment key={badge.label}>
                <span className="shrink-0 text-muted-foreground/60">·</span>
                <span className={cn(
                  'shrink-0 text-[11px] font-medium',
                  badge.tone === 'error' ? 'text-error' : badge.tone === 'active' ? 'text-[var(--amber)]' : 'text-muted-foreground',
                )}>
                  {badge.label}
                </span>
              </Fragment>
            ))}
          </div>
          {detail && (
            <div className="mt-0.5 [overflow-wrap:anywhere] text-[11px] leading-relaxed text-muted-foreground">
              {truncateText(detail)}
            </div>
          )}
          {visibleEvents.length > 0 && (
            <div className="mt-1 grid gap-1">
              {visibleEvents.map((event) => {
                const summary = eventSummary(event);
                const tone = eventTone(event);
                return (
                  <div
                    key={event.id}
                    className={cn(
                      'flex min-w-0 items-start gap-1.5 rounded-md border border-border/30 bg-background/55 px-2 py-1 text-[10px]',
                      tone === 'error' ? 'text-error' : tone === 'active' ? 'text-[var(--amber)]' : 'text-muted-foreground',
                    )}
                  >
                    <span className="mt-0.5 shrink-0">{eventIcon(event)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{truncateText(eventTitle(event), 90)}</span>
                      {summary && (
                        <span className="text-muted-foreground"> · {truncateText(summary, 120)}</span>
                      )}
                    </span>
                  </div>
                );
              })}
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
      </div>
      {childCount > 0 && expanded && (
        <ul className="ml-6 border-l border-border/30 pl-2">
          {node.children.map((child) => (
            <AgentRunRow
              key={child.run.id}
              node={child}
              depth={depth + 1}
              expanded={child.children.length > 0 && !collapsed.has(child.run.id)}
              collapsed={collapsed}
              events={events.filter((event) => event.runId === child.run.id)}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

const AgentRunTimeline = memo(function AgentRunTimeline({ part }: { part: AgentRunTimelinePart }) {
  const runs = useMemo(() => (
    [...part.runs]
      .filter((run) => run.agentKind !== 'mindos-main')
      .sort(sortRuns)
  ), [part.runs]);
  const tree = useMemo(() => buildRunTree(runs), [runs]);
  const eventsByRun = useMemo(() => {
    const grouped = new Map<string, AgentRunTimelineEvent[]>();
    for (const event of part.events ?? []) {
      if (event.record?.agentKind === 'mindos-main') continue;
      const next = grouped.get(event.runId) ?? [];
      next.push(event);
      grouped.set(event.runId, next);
    }
    return grouped;
  }, [part.events]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  if (runs.length === 0) return null;

  const activeCount = runs.filter((run) => !TERMINAL_STATUSES.has(run.status)).length;
  const toggleRoot = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

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
      <ul className="space-y-0.5">
        {tree.map((node) => (
          <AgentRunRow
            key={node.run.id}
            node={node}
            depth={0}
            expanded={node.children.length > 0 && !collapsed.has(node.run.id)}
            collapsed={collapsed}
            events={eventsByRun.get(node.run.id) ?? []}
            onToggle={toggleRoot}
          />
        ))}
      </ul>
    </div>
  );
});

export default AgentRunTimeline;
