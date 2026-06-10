'use client';

import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  Gauge,
  ListChecks,
  MessageSquare,
  Route,
  Server,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { PLATFORMS } from '@/lib/im/platforms';
import type { AgentInfo } from '@/components/settings/types';
import type { AgentBuckets, RiskItem } from './agents-content-model';
import { AgentSectionHeading } from './AgentsPrimitives';
import RecentActivityFeed from './RecentActivityFeed';

interface OverviewCopy {
  connected: string;
  detected: string;
  notFound: string;
  riskQueue: string;
  nextAction: string;
  nextActionHint: string;
  riskLevelError: string;
  riskLevelWarn: string;
  pulseMcp: string;
  pulseTools: string;
  mcpOffline: string;
  colSkills: string;
  toolsUnit: (n: number) => string;
  profilesUnit: (n: number) => string;
  runtimeEndpointsUnit: (n: number) => string;
  entryPointsUnit: (n: number) => string;
  enabledUnit: (n: number) => string;
  agentCount: (n: number) => string;
  runtimeActive: string;
  systemModelTitle: string;
  systemModelDescription: string;
  systemFlowTitle: string;
  systemReadinessTitle: string;
  systemReadinessMeta: (passed: number, total: number) => string;
  systemSignalsTitle: string;
  assistantLabel: string;
  assistantDescription: string;
  agentLabel: string;
  agentDescription: string;
  capabilitiesLabel: string;
  capabilitiesDescription: string;
  runsLabel: string;
  runsDescription: string;
  channelsLabel: string;
  channelsDescription: string;
  flowSummary: string;
  statusTitle: string;
  availableLabel: string;
  readyLabel: string;
  needsAttentionLabel: (n: number) => string;
  assistantStatusMeta: (n: number) => string;
  agentStatusMeta: (connected: number, detected: number) => string;
  capabilitiesStatusMeta: (tools: number, skills: number) => string;
  runsStatusValue: string;
  runsStatusMeta: string;
  channelsStatusValue: string;
  channelsStatusMeta: string;
  nextActionsTitle: string;
  nextActionsHealthyTitle: string;
  nextActionsHealthyHint: string;
  actionMcpStoppedTitle: string;
  actionMcpStoppedHint: string;
  actionDetectedTitle: (n: number) => string;
  actionDetectedHint: string;
  actionSkillsDisabledTitle: string;
  actionSkillsDisabledHint: string;
  actionConfigureAssistantTitle: string;
  actionConfigureAssistantHint: string;
  actionReviewRunsTitle: string;
  actionReviewRunsHint: string;
  actionOpen: string;
  viewAllSignals: string;
  [k: string]: unknown;
}

interface PulseCopy {
  title: string;
  healthy: string;
  needsAttention: (n: number) => string;
  connected: string;
  detected: string;
  notFound: string;
  risk: string;
  enabledSkills: string;
}

type StatusTone = 'ok' | 'warn' | 'neutral';
type NodeHue = 'assistant' | 'agent' | 'capability' | 'channel';
type SystemNodeData = {
  index: string;
  href: string;
  icon: ReactNode;
  hue: NodeHue;
  label: string;
  metric: string;
  status: string;
  tone: StatusTone;
};

export default function AgentsOverviewSection({
  copy,
  buckets,
  riskQueue,
  mcpRunning,
  mcpPort,
  mcpToolCount,
  mcpEnabled = true,
  enabledSkillCount,
  assistantCount,
  allAgents,
}: {
  copy: OverviewCopy;
  buckets: AgentBuckets;
  riskQueue: RiskItem[];
  mcpRunning: boolean;
  mcpPort: number | null;
  mcpToolCount: number;
  mcpEnabled?: boolean;
  enabledSkillCount: number;
  assistantCount: number;
  allAgents: AgentInfo[];
  pulseCopy?: PulseCopy;
  onAddCustomAgent?: () => void;
  onEditCustomAgent?: (agent: AgentInfo) => void;
  onRemoveCustomAgent?: (agent: AgentInfo) => void;
}) {
  const visibleAgents = allAgents.filter(agent => agent.present || agent.isCustom);
  const agentNeedsAttention = buckets.detected.length > 0;
  const skillsMcpNeedsAttention = mcpEnabled && !mcpRunning;
  const mcpValue = mcpEnabled && mcpRunning && mcpPort ? `MCP :${mcpPort}` : copy.mcpOffline;
  const supportedChannelCount = PLATFORMS.length;
  const readinessChecks = [
    assistantCount > 0,
    buckets.connected.length > 0,
    !agentNeedsAttention && !skillsMcpNeedsAttention,
    enabledSkillCount > 0,
  ];
  const readinessPassed = readinessChecks.filter(Boolean).length;
  const readinessTotal = readinessChecks.length;
  const readinessPercent = Math.round((readinessPassed / readinessTotal) * 100);
  const readinessTone: StatusTone = readinessPassed === readinessTotal ? 'ok' : 'warn';

  const systemNodes: SystemNodeData[] = [
    {
      index: '01',
      href: '/agents?tab=assistant',
      icon: <Sparkles size={15} />,
      hue: 'assistant',
      label: copy.assistantLabel,
      metric: copy.profilesUnit(assistantCount),
      status: copy.availableLabel,
      tone: 'neutral',
    },
    {
      index: '02',
      href: '/agents?tab=agent',
      icon: <Bot size={15} />,
      hue: 'agent',
      label: copy.agentLabel,
      metric: copy.runtimeEndpointsUnit(visibleAgents.length),
      status: agentNeedsAttention ? copy.needsAttentionLabel(buckets.detected.length) : copy.readyLabel,
      tone: agentNeedsAttention ? 'warn' : 'ok',
    },
    {
      index: '03',
      href: '/agents?tab=capabilities',
      icon: <Server size={15} />,
      hue: 'capability',
      label: copy.capabilitiesLabel,
      metric: copy.toolsUnit(mcpToolCount),
      status: mcpValue,
      tone: skillsMcpNeedsAttention ? 'warn' : 'ok',
    },
    {
      index: '04',
      href: '/agents?tab=channels',
      icon: <MessageSquare size={15} />,
      hue: 'channel',
      label: copy.channelsLabel,
      metric: copy.entryPointsUnit(supportedChannelCount),
      status: copy.channelsStatusValue,
      tone: 'neutral',
    },
  ];

  const nextActions = buildNextActions({
    copy,
    riskQueue,
    detectedCount: buckets.detected.length,
    mcpEnabled,
    enabledSkillCount,
  });

  return (
    <div className="space-y-6">
      <SystemIntelligencePanel
        copy={copy}
        nodes={systemNodes}
        riskQueue={riskQueue}
        readinessPassed={readinessPassed}
        readinessTotal={readinessTotal}
        readinessPercent={readinessPercent}
        readinessTone={readinessTone}
        connectedCount={buckets.connected.length}
        detectedCount={buckets.detected.length}
        mcpToolCount={mcpToolCount}
        enabledSkillCount={enabledSkillCount}
      />

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
        <div className="min-w-0">
          <RecentActivityFeed />
        </div>

        <section
          aria-labelledby="agents-next-actions-title"
          className="min-w-0"
        >
          <div className="mb-5 flex items-start gap-3">
            <AgentSectionHeading
              id="agents-next-actions-title"
              icon={<ListChecks size={13} aria-hidden="true" />}
              title={copy.nextActionsTitle}
            />
          </div>

          <div className="divide-y divide-border/45 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {nextActions.map(action => (
              <NextActionRow key={action.id} action={action} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function buildNextActions({
  copy,
  riskQueue,
  detectedCount,
  mcpEnabled,
  enabledSkillCount,
}: {
  copy: OverviewCopy;
  riskQueue: RiskItem[];
  detectedCount: number;
  mcpEnabled: boolean;
  enabledSkillCount: number;
}): Array<{ id: string; title: string; hint: string; href: string; tone: StatusTone; label: string }> {
  const actions: Array<{ id: string; title: string; hint: string; href: string; tone: StatusTone; label: string }> = [];

  if (riskQueue.some(item => item.id === 'mcp-stopped')) {
    actions.push({
      id: 'mcp-stopped',
      title: copy.actionMcpStoppedTitle,
      hint: copy.actionMcpStoppedHint,
      href: '/agents?tab=capabilities',
      tone: 'warn',
      label: copy.actionOpen,
    });
  }

  if (detectedCount > 0) {
    actions.push({
      id: 'detected-agents',
      title: copy.actionDetectedTitle(detectedCount),
      hint: copy.actionDetectedHint,
      href: '/agents?tab=agent',
      tone: 'warn',
      label: copy.actionOpen,
    });
  }

  if (mcpEnabled && enabledSkillCount === 0) {
    actions.push({
      id: 'skills-disabled',
      title: copy.actionSkillsDisabledTitle,
      hint: copy.actionSkillsDisabledHint,
      href: '/agents?tab=capabilities',
      tone: 'neutral',
      label: copy.actionOpen,
    });
  }

  actions.push({
    id: 'assistant-routing',
    title: copy.actionConfigureAssistantTitle,
    hint: copy.actionConfigureAssistantHint,
    href: '/agents?tab=assistant',
    tone: 'neutral',
    label: copy.actionOpen,
  });

  actions.push({
    id: 'review-runs',
    title: copy.actionReviewRunsTitle,
    hint: copy.actionReviewRunsHint,
    href: '/agents?tab=runs',
    tone: 'ok',
    label: copy.actionOpen,
  });

  return actions.slice(0, 3);
}

function SystemIntelligencePanel({
  copy,
  nodes,
  riskQueue,
  readinessPassed,
  readinessTotal,
  readinessPercent,
  readinessTone,
  connectedCount,
  detectedCount,
  mcpToolCount,
  enabledSkillCount,
}: {
  copy: OverviewCopy;
  nodes: SystemNodeData[];
  riskQueue: RiskItem[];
  readinessPassed: number;
  readinessTotal: number;
  readinessPercent: number;
  readinessTone: StatusTone;
  connectedCount: number;
  detectedCount: number;
  mcpToolCount: number;
  enabledSkillCount: number;
}) {
  const ready = riskQueue.length === 0 && readinessTone === 'ok';
  const attentionSummary = riskQueue.length > 0
    ? copy.needsAttentionLabel(riskQueue.length)
    : copy.systemReadinessMeta(readinessPassed, readinessTotal);
  const firstRisk = riskQueue[0];
  const mcpNode = nodes.find(node => node.href === '/agents?tab=capabilities');

  return (
    <section
      aria-labelledby="agents-system-model-title"
      className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm"
    >
      <div className="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0 p-3.5 xl:pr-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <AgentSectionHeading
              id="agents-system-model-title"
              icon={<Route size={13} aria-hidden="true" />}
              title={copy.systemModelTitle}
              description={copy.flowSummary}
            />
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <SystemStatusPill
                icon={ready ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                label={ready ? copy.nextActionsHealthyTitle : attentionSummary}
                tone={ready ? 'ok' : 'warn'}
              />
              <SystemStatusPill
                icon={<Gauge size={12} />}
                label={`${readinessPercent}%`}
                tone={readinessTone}
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)_24px_minmax(0,1fr)_24px_minmax(0,1fr)] lg:items-center">
            {nodes.map((node, index) => (
              <Fragment key={node.href}>
                <SystemTopologyNode node={node} />
                {index < nodes.length - 1 ? <SystemConnector /> : null}
              </Fragment>
            ))}
          </div>

          <div className="mt-3 border-t border-border/55 pt-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="flex shrink-0 items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                <BarChart3 size={12} aria-hidden="true" />
                {copy.systemSignalsTitle}
              </div>
              <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4 md:divide-x md:divide-border/45">
                <SystemSignalMetric label={copy.connected} value={connectedCount} tone="ok" />
                <SystemSignalMetric label={copy.detected} value={detectedCount} tone={detectedCount > 0 ? 'warn' : 'neutral'} />
                <SystemSignalMetric label={copy.pulseTools} value={mcpToolCount} tone={mcpToolCount > 0 ? 'ok' : 'neutral'} />
                <SystemSignalMetric label={copy.colSkills} value={enabledSkillCount} tone={enabledSkillCount > 0 ? 'ok' : 'neutral'} />
              </div>
              <Link
                href="/agents?tab=capabilities"
                className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-[var(--amber)] transition-opacity duration-150 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {copy.viewAllSignals}
                <ArrowRight size={12} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>

        <aside className="min-w-0 border-t border-border/50 bg-background/25 p-3.5 xl:border-l xl:border-t-0">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="inline-flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                <ShieldCheck size={12} aria-hidden="true" />
                {copy.systemReadinessTitle}
              </span>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {copy.systemReadinessMeta(readinessPassed, readinessTotal)}
              </p>
            </span>
            <ReadinessRing percent={readinessPercent} tone={readinessTone} label={copy.systemReadinessTitle} />
          </div>
          <div className="mt-4 space-y-2.5">
            <ReadinessRow
              label={copy.riskQueue}
              value={ready ? copy.nextActionsHealthyTitle : attentionSummary}
              tone={ready ? 'ok' : 'warn'}
            />
            <ReadinessRow
              label={copy.pulseMcp}
              value={mcpNode?.status ?? copy.mcpOffline}
              tone={mcpNode?.tone ?? 'neutral'}
            />
            <ReadinessRow
              label={copy.colSkills}
              value={copy.enabledUnit(enabledSkillCount)}
              tone={enabledSkillCount > 0 ? 'ok' : 'neutral'}
            />
          </div>
          <SystemRiskLine
            copy={copy}
            risk={firstRisk}
            ready={ready}
            fallback={attentionSummary}
          />
        </aside>
      </div>
    </section>
  );
}

function SystemStatusPill({
  icon,
  label,
  tone,
}: {
  icon: ReactNode;
  label: string;
  tone: StatusTone;
}) {
  const className =
    tone === 'ok'
      ? 'border-success/20 bg-success/10 text-success'
      : tone === 'warn'
        ? 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber-text)]'
        : 'border-border/60 bg-card text-muted-foreground';

  return (
    <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-lg border px-2.5 text-2xs font-medium ${className}`}>
      <span className="shrink-0" aria-hidden="true">{icon}</span>
      <span className="truncate">{label}</span>
    </span>
  );
}

function SystemTopologyNode({ node }: { node: SystemNodeData }) {
  const hue = getNodeHueClasses(node.hue);
  const statusClass = getNodeStatusClass(node);

  return (
    <Link
      href={node.href}
      className="group grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors duration-150 ${hue.icon}`}>
        {node.icon}
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="text-2xs font-semibold tabular-nums text-muted-foreground/45">{node.index}</span>
          <span className={`inline-flex max-w-[120px] items-center rounded-full border px-2 py-0.5 text-2xs font-medium leading-5 ${statusClass}`}>
            <span className="truncate">{node.status}</span>
          </span>
        </span>
        <span className="mt-1.5 block text-sm font-semibold leading-tight text-foreground">{node.label}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${hue.dot}`} aria-hidden="true" />
          <span className="text-xs leading-snug text-muted-foreground">{node.metric}</span>
        </span>
      </span>
    </Link>
  );
}

function SystemConnector() {
  return (
    <div className="hidden items-center gap-1 text-muted-foreground/45 lg:flex" aria-hidden="true">
      <span className="h-px min-w-0 flex-1 bg-border" />
      <ArrowRight size={14} />
      <span className="h-px min-w-0 flex-1 bg-border" />
    </div>
  );
}

function SystemSignalMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: StatusTone;
}) {
  const dotClass =
    tone === 'ok'
      ? 'bg-success'
      : tone === 'warn'
        ? 'bg-[var(--amber)]'
        : 'bg-muted-foreground/45';

  return (
    <div className="flex min-w-0 items-center justify-between gap-2 md:px-1.5">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
        <span className="min-w-0 whitespace-nowrap text-xs text-muted-foreground">{label}</span>
      </span>
      <span className="ml-2 inline-flex min-w-6 shrink-0 justify-center rounded-md bg-background/70 px-1.5 py-0.5 text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function ReadinessRing({
  percent,
  tone,
  label,
}: {
  percent: number;
  tone: StatusTone;
  label: string;
}) {
  const color = tone === 'ok' ? 'var(--success)' : 'var(--amber)';

  return (
    <span
      className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-full"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
      style={{
        background: `conic-gradient(${color} ${percent}%, var(--muted) 0)`,
      }}
    >
      <span className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-card">
        <span className="text-base font-semibold leading-none tabular-nums text-foreground">{percent}</span>
        <span className="ml-px text-[9px] font-medium text-muted-foreground">%</span>
      </span>
    </span>
  );
}

function SystemRiskLine({
  copy,
  risk,
  ready,
  fallback,
}: {
  copy: OverviewCopy;
  risk?: RiskItem;
  ready: boolean;
  fallback: string;
}) {
  if (ready) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-success/20 bg-success/10 px-3 py-2">
        <CheckCircle2 size={13} className="shrink-0 text-success" aria-hidden="true" />
        <span className="min-w-0 truncate text-xs text-muted-foreground">{copy.nextActionsHealthyHint}</span>
      </div>
    );
  }

  return (
    <div className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--amber)]/20 bg-[var(--amber-subtle)] px-3 py-2">
      <AlertTriangle size={13} className="shrink-0 text-[var(--amber)]" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-xs text-foreground">{risk?.title ?? fallback}</span>
      {risk ? (
        <span className="shrink-0 text-2xs font-medium text-[var(--amber-text)]">
          {risk.severity === 'error' ? copy.riskLevelError : copy.riskLevelWarn}
        </span>
      ) : null}
    </div>
  );
}

function getNodeStatusClass(node: SystemNodeData) {
  if (node.tone === 'ok') return 'border-success/20 bg-success/10 text-success';
  if (node.tone === 'warn') return 'border-[var(--amber)]/25 bg-[var(--amber)]/10 text-[var(--amber-text)]';
  return getNodeHueClasses(node.hue).status;
}

function getNodeHueClasses(hue: NodeHue) {
  switch (hue) {
    case 'assistant':
      return {
        icon: 'border-[var(--tool-search)]/20 bg-[var(--tool-search)]/10 text-[var(--tool-search)]',
        dot: 'bg-[var(--tool-search)]',
        status: 'border-[var(--tool-search)]/20 bg-[var(--tool-search)]/10 text-[var(--tool-search)]',
      };
    case 'agent':
      return {
        icon: 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber)]',
        dot: 'bg-[var(--amber)]',
        status: 'border-[var(--amber)]/25 bg-[var(--amber)]/10 text-[var(--amber-text)]',
      };
    case 'capability':
      return {
        icon: 'border-success/20 bg-success/10 text-success',
        dot: 'bg-success',
        status: 'border-success/20 bg-success/10 text-success',
      };
    case 'channel':
      return {
        icon: 'border-[var(--tool-read)]/20 bg-[var(--tool-read)]/10 text-[var(--tool-read)]',
        dot: 'bg-[var(--tool-read)]',
        status: 'border-[var(--tool-read)]/20 bg-[var(--tool-read)]/10 text-[var(--tool-read)]',
      };
  }
}

function ReadinessRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: StatusTone;
}) {
  const dotClass =
    tone === 'ok'
      ? 'bg-success'
      : tone === 'warn'
        ? 'bg-[var(--amber)]'
        : 'bg-muted-foreground/45';

  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
        <span className="truncate text-xs text-muted-foreground">{label}</span>
      </span>
      <span className="max-w-[140px] truncate text-xs font-medium text-foreground">{value}</span>
    </div>
  );
}

function NextActionRow({
  action,
}: {
  action: { title: string; hint: string; href: string; tone: StatusTone; label: string };
}) {
  const dotClass =
    action.tone === 'ok'
      ? 'bg-[var(--success)]'
      : action.tone === 'warn'
        ? 'bg-[var(--amber)]'
        : 'bg-muted-foreground/45';

  return (
    <Link
      href={action.href}
      className="group grid min-h-[58px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{action.title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{action.hint}</span>
      </span>
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card text-xs font-medium text-muted-foreground transition-colors duration-150 group-hover:border-[var(--amber)]/35 group-hover:text-[var(--amber)] sm:w-auto sm:gap-1 sm:px-2">
        <span className="hidden sm:inline">{action.label}</span>
        <ArrowRight size={12} aria-hidden="true" />
      </span>
    </Link>
  );
}
