import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  formatAgentRunRuntimeLabel,
  formatAgentRunStatus,
  isAgentRunActive,
} from '@/lib/agent-run-timeline';
import { colors, hairlineWidth, radius, spacing, typography } from '@/lib/theme';
import type {
  AgentRunStatus,
  AgentRunTimelineEvent,
  AgentRunTimelinePart,
  AgentRunTimelineRecord,
} from '@/lib/types';

interface AgentRunTimelineCardProps {
  part: AgentRunTimelinePart;
}

type RunNode = {
  run: AgentRunTimelineRecord;
  children: RunNode[];
};

export default function AgentRunTimelineCard({ part }: AgentRunTimelineCardProps) {
  const runs = part.runs
    .filter((run) => run.agentKind !== 'mindos-main')
    .sort(sortRuns);
  if (runs.length === 0) return null;

  const tree = buildRunTree(runs);
  const eventsByRun = groupEventsByRun(part.events ?? []);
  const activeCount = runs.filter(isAgentRunActive).length;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerTitleRow}>
          <Ionicons name="git-branch-outline" size={13} color={colors.amber} />
          <Text style={styles.headerTitle}>Agent Activity</Text>
        </View>
        <View style={[styles.headerPill, activeCount > 0 && styles.headerPillActive]}>
          {activeCount > 0 ? (
            <Ionicons name="sync-outline" size={11} color={colors.amber} />
          ) : (
            <Ionicons name="time-outline" size={11} color={colors.textSubtle} />
          )}
          <Text style={[styles.headerPillText, activeCount > 0 && styles.headerPillTextActive]}>
            {activeCount > 0 ? `${activeCount} active` : `${runs.length} run${runs.length === 1 ? '' : 's'}`}
          </Text>
        </View>
      </View>

      <View style={styles.runList}>
        {tree.slice(0, 8).map((node) => (
          <RunRow
            key={node.run.id}
            node={node}
            depth={0}
            eventsByRun={eventsByRun}
          />
        ))}
      </View>
    </View>
  );
}

function RunRow({
  node,
  depth,
  eventsByRun,
}: {
  node: RunNode;
  depth: number;
  eventsByRun: Map<string, AgentRunTimelineEvent[]>;
}) {
  const { run } = node;
  const active = isAgentRunActive(run);
  const statusTone = statusToneForRun(run.status);
  const detail = run.error || run.outputSummary || run.inputSummary;
  const events = (eventsByRun.get(run.id) ?? [])
    .filter((event) => event.visibility !== 'debug')
    .sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))
    .slice(-3);

  return (
    <View style={[styles.runBlock, depth > 0 && styles.childRunBlock]}>
      <View style={styles.runHeader}>
        <View style={[styles.statusIconShell, statusTone === 'active' && styles.statusIconShellActive]}>
          <Ionicons name={statusIcon(run.status)} size={13} color={statusColor(statusTone)} />
        </View>
        <View style={styles.runCopy}>
          <View style={styles.runTitleRow}>
            <Text style={styles.runName} numberOfLines={1}>
              {run.displayName || formatAgentRunRuntimeLabel(run)}
            </Text>
            <Text style={[styles.runStatus, statusTone === 'error' && styles.runStatusError, active && styles.runStatusActive]}>
              {formatAgentRunStatus(run.status)}
            </Text>
          </View>
          {detail ? (
            <Text style={styles.runDetail} numberOfLines={2}>
              {compactText(detail)}
            </Text>
          ) : null}
        </View>
        <View style={styles.permissionPill}>
          <Ionicons name="shield-checkmark-outline" size={10} color={colors.textSubtle} />
          <Text style={styles.permissionText}>{run.permissionMode}</Text>
        </View>
      </View>

      {events.length > 0 ? (
        <View style={styles.eventList}>
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </View>
      ) : null}

      {node.children.length > 0 ? (
        <View style={styles.children}>
          {node.children.map((child) => (
            <RunRow key={child.run.id} node={child} depth={depth + 1} eventsByRun={eventsByRun} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function EventRow({ event }: { event: AgentRunTimelineEvent }) {
  const tone = eventTone(event);
  const title = eventTitle(event);
  const summary = eventSummary(event);

  return (
    <View style={[styles.eventRow, tone === 'error' && styles.eventRowError, tone === 'active' && styles.eventRowActive]}>
      <Ionicons name={eventIcon(event)} size={11} color={eventColor(tone)} />
      <Text style={[styles.eventText, tone === 'error' && styles.eventTextError, tone === 'active' && styles.eventTextActive]} numberOfLines={2}>
        <Text style={styles.eventTitle}>{title}</Text>
        {summary ? <Text style={styles.eventSummary}> · {compactText(summary, 120)}</Text> : null}
      </Text>
    </View>
  );
}

function buildRunTree(runs: AgentRunTimelineRecord[]): RunNode[] {
  const nodes = new Map<string, RunNode>();
  for (const run of runs) nodes.set(run.id, { run, children: [] });

  const roots: RunNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.run.parentRunId;
    const parent = parentId && parentId !== node.run.id ? nodes.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return sortTree(roots);
}

function sortTree(nodes: RunNode[]): RunNode[] {
  return nodes
    .sort((a, b) => sortRuns(a.run, b.run))
    .map((node) => ({ ...node, children: sortTree(node.children) }));
}

function sortRuns(a: AgentRunTimelineRecord, b: AgentRunTimelineRecord): number {
  return a.startedAt - b.startedAt || a.id.localeCompare(b.id);
}

function groupEventsByRun(events: AgentRunTimelineEvent[]): Map<string, AgentRunTimelineEvent[]> {
  const grouped = new Map<string, AgentRunTimelineEvent[]>();
  for (const event of events) {
    const next = grouped.get(event.runId) ?? [];
    next.push(event);
    grouped.set(event.runId, next);
  }
  return grouped;
}

function statusToneForRun(status: AgentRunStatus): 'active' | 'success' | 'error' | 'muted' {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'timed_out') return 'error';
  if (status === 'canceled') return 'muted';
  return 'active';
}

function statusIcon(status: AgentRunStatus) {
  if (status === 'completed') return 'checkmark-circle-outline';
  if (status === 'failed' || status === 'timed_out') return 'warning-outline';
  if (status === 'canceled') return 'stop-circle-outline';
  return 'sync-outline';
}

function statusColor(tone: 'active' | 'success' | 'error' | 'muted'): string {
  if (tone === 'success') return colors.success;
  if (tone === 'error') return colors.errorText;
  if (tone === 'active') return colors.amber;
  return colors.textSubtle;
}

function eventTone(event: AgentRunTimelineEvent): 'active' | 'error' | 'muted' {
  if (event.category === 'error' || event.type === 'run_failed' || event.status === 'failed' || event.status === 'timed_out') {
    return 'error';
  }
  if (
    event.type === 'tool_started'
    || event.type === 'permission_requested'
    || event.type === 'user_question_started'
    || (event.data?.kind === 'permission' && event.data.status === 'requested')
    || (event.data?.kind === 'question' && event.data.status === 'requested')
  ) {
    return 'active';
  }
  return 'muted';
}

function eventIcon(event: AgentRunTimelineEvent) {
  if (event.category === 'tool') return 'terminal-outline';
  if (event.category === 'file') return 'document-text-outline';
  if (event.category === 'permission') return 'shield-outline';
  if (event.category === 'question') return 'chatbubble-ellipses-outline';
  if (event.category === 'error') return 'warning-outline';
  return 'ellipse-outline';
}

function eventColor(tone: 'active' | 'error' | 'muted'): string {
  if (tone === 'error') return colors.errorText;
  if (tone === 'active') return colors.amber;
  return colors.textSubtle;
}

function eventTitle(event: AgentRunTimelineEvent): string {
  if (event.data?.kind === 'tool') return `${event.data.name}${event.data.status ? ` ${event.data.status}` : ''}`;
  if (event.data?.kind === 'file') return `${event.data.action} ${event.data.path}`;
  if (event.data?.kind === 'permission') return `${event.data.action} ${event.data.status}`;
  if (event.data?.kind === 'question') return `user question ${event.data.status}`;
  if (event.data?.kind === 'error') return event.data.message;
  if (event.data?.kind === 'status') return formatAgentRunStatus(event.data.nextStatus);
  return event.title || event.message || event.type.replace(/_/g, ' ');
}

function eventSummary(event: AgentRunTimelineEvent): string | null {
  if (event.data?.kind === 'tool') return event.data.error || event.data.outputSummary || event.data.inputSummary || event.message || null;
  if (event.data?.kind === 'file') return event.data.summary || event.message || null;
  if (event.data?.kind === 'permission') {
    return event.data.status === 'requested'
      ? 'Waiting on the host permission bridge; mobile approval needs the pending-request API.'
      : event.data.decisionLabel || event.data.prompt || event.message || null;
  }
  if (event.data?.kind === 'question') {
    return event.data.status === 'requested'
      ? 'Waiting for user input on the host; mobile answer sheets need the pending-question API.'
      : event.data.summary || event.data.prompt || event.message || null;
  }
  if (event.data?.kind === 'text') return event.data.text || event.message || null;
  if (event.data?.kind === 'status') return event.data.summary || event.message || null;
  return event.message || null;
}

function compactText(text: string, max = 150): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}...` : compact;
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceMuted,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerTitle: {
    fontSize: typography.caption,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  headerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  headerPillActive: {
    backgroundColor: colors.amberSoft,
  },
  headerPillText: {
    fontSize: 11,
    color: colors.textSubtle,
  },
  headerPillTextActive: {
    color: colors.amber,
  },
  runList: {
    gap: spacing.sm,
  },
  runBlock: {
    gap: spacing.xs,
  },
  childRunBlock: {
    marginLeft: spacing.md,
    paddingLeft: spacing.md,
    borderLeftWidth: hairlineWidth,
    borderLeftColor: colors.border,
  },
  runHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  statusIconShell: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  statusIconShellActive: {
    backgroundColor: colors.amberSoft,
  },
  runCopy: {
    flex: 1,
    gap: 2,
  },
  runTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  runName: {
    flex: 1,
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.text,
  },
  runStatus: {
    fontSize: 11,
    color: colors.success,
    fontWeight: '600',
  },
  runStatusActive: {
    color: colors.amber,
  },
  runStatusError: {
    color: colors.errorText,
  },
  runDetail: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSubtle,
  },
  permissionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  permissionText: {
    fontSize: 10,
    color: colors.textSubtle,
  },
  eventList: {
    gap: 4,
    paddingLeft: 30,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  eventRowActive: {
    backgroundColor: colors.amberSoft,
  },
  eventRowError: {
    backgroundColor: colors.errorSoft,
  },
  eventText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textSubtle,
  },
  eventTextActive: {
    color: colors.amber,
  },
  eventTextError: {
    color: colors.errorText,
  },
  eventTitle: {
    fontWeight: '700',
  },
  eventSummary: {
    fontWeight: '400',
  },
  children: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
});
