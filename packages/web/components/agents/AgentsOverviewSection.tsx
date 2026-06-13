'use client';

import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import {
  ArrowRight,
  Bot,
  ListChecks,
  MessageSquare,
  Route,
  Server,
  Sparkles,
} from 'lucide-react';
import { PLATFORMS } from '@/lib/im/platforms';
import type { AgentInfo } from '@/components/settings/types';
import type { AgentBuckets, RiskItem } from './agents-content-model';
import { AgentSectionHeading } from './AgentsPrimitives';
import RecentActivityFeed from './RecentActivityFeed';

interface OverviewCopy {
  toolsUnit: (n: number) => string;
  profilesUnit: (n: number) => string;
  runtimeEndpointsUnit: (n: number) => string;
  entryPointsUnit: (n: number) => string;
  systemModelTitle: string;
  assistantLabel: string;
  agentLabel: string;
  capabilitiesLabel: string;
  channelsLabel: string;
  nextActionsTitle: string;
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
};

export default function AgentsOverviewSection({
  copy,
  buckets,
  riskQueue,
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
  const supportedChannelCount = PLATFORMS.length;
  const systemNodes: SystemNodeData[] = [
    {
      index: '01',
      href: '/agents?tab=assistant',
      icon: <Sparkles size={15} />,
      hue: 'assistant',
      label: copy.assistantLabel,
      metric: copy.profilesUnit(assistantCount),
    },
    {
      index: '02',
      href: '/agents?tab=agent',
      icon: <Bot size={15} />,
      hue: 'agent',
      label: copy.agentLabel,
      metric: copy.runtimeEndpointsUnit(visibleAgents.length),
    },
    {
      index: '03',
      href: '/agents?tab=skills',
      icon: <Server size={15} />,
      hue: 'capability',
      label: copy.capabilitiesLabel,
      metric: copy.toolsUnit(mcpToolCount),
    },
    {
      index: '04',
      href: '/agents?tab=channels',
      icon: <MessageSquare size={15} />,
      hue: 'channel',
      label: copy.channelsLabel,
      metric: copy.entryPointsUnit(supportedChannelCount),
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
      />

      <RecentActivityFeed />
      <NextActionsStrip copy={copy} actions={nextActions} />
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
      href: '/agents?tab=mcp',
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
      href: '/agents?tab=skills',
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
}: {
  copy: OverviewCopy;
  nodes: SystemNodeData[];
}) {
  return (
    <section
      aria-labelledby="agents-system-model-title"
      className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm"
    >
      <div className="min-w-0 p-3.5">
        <AgentSectionHeading
          id="agents-system-model-title"
          icon={<Route size={13} aria-hidden="true" />}
          title={copy.systemModelTitle}
        />

        <div className="mt-3.5 grid grid-cols-2 gap-2 lg:flex lg:items-center lg:gap-0">
          {nodes.map((node, index) => (
            <Fragment key={node.href}>
              <SystemTopologyNode node={node} />
              {index < nodes.length - 1 ? <SystemConnector /> : null}
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

function SystemTopologyNode({ node }: { node: SystemNodeData }) {
  const hue = getNodeHueClasses(node.hue);

  return (
    <Link
      href={node.href}
      className="group grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 py-2 transition-colors duration-150 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:basis-[158px] lg:shrink-0"
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors duration-150 ${hue.icon}`}>
        {node.icon}
      </span>
      <span className="min-w-0">
        <span className="text-2xs font-semibold tabular-nums text-muted-foreground/45">{node.index}</span>
        <span className="mt-1 block text-sm font-semibold leading-tight text-foreground">{node.label}</span>
        <span className={`mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium leading-5 ${hue.metric}`}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${hue.dot}`} aria-hidden="true" />
          <span className="truncate">{node.metric}</span>
        </span>
      </span>
    </Link>
  );
}

function SystemConnector() {
  return (
    <div className="hidden min-w-10 flex-1 items-center justify-center px-2 text-muted-foreground/45 lg:flex" aria-hidden="true">
      <span className="h-px min-w-0 flex-1 bg-border" />
      <ArrowRight size={14} className="mx-1.5 shrink-0" />
      <span className="h-px min-w-0 flex-1 bg-border" />
    </div>
  );
}

function getNodeHueClasses(hue: NodeHue) {
  switch (hue) {
    case 'assistant':
      return {
        icon: 'border-[var(--tool-search)]/20 bg-[var(--tool-search)]/10 text-[var(--tool-search)]',
        dot: 'bg-[var(--tool-search)]',
        metric: 'border-[var(--tool-search)]/15 bg-[var(--tool-search)]/10 text-[var(--tool-search)]',
      };
    case 'agent':
      return {
        icon: 'border-[var(--amber)]/25 bg-[var(--amber-subtle)] text-[var(--amber)]',
        dot: 'bg-[var(--amber)]',
        metric: 'border-[var(--amber)]/20 bg-[var(--amber-subtle)] text-[var(--amber-text)]',
      };
    case 'capability':
      return {
        icon: 'border-success/20 bg-success/10 text-success',
        dot: 'bg-success',
        metric: 'border-success/15 bg-success/10 text-success',
      };
    case 'channel':
      return {
        icon: 'border-[var(--tool-read)]/20 bg-[var(--tool-read)]/10 text-[var(--tool-read)]',
        dot: 'bg-[var(--tool-read)]',
        metric: 'border-[var(--tool-read)]/15 bg-[var(--tool-read)]/10 text-[var(--tool-read)]',
      };
  }
}

function NextActionsStrip({
  copy,
  actions,
}: {
  copy: OverviewCopy;
  actions: Array<{ id: string; title: string; hint: string; href: string; tone: StatusTone; label: string }>;
}) {
  if (actions.length === 0) return null;

  return (
    <section aria-labelledby="agents-next-actions-title" className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <AgentSectionHeading
          id="agents-next-actions-title"
          icon={<ListChecks size={13} aria-hidden="true" />}
          title={copy.nextActionsTitle}
          size="sm"
          className="mr-1"
        />
        {actions.map(action => (
          <NextActionPill key={action.id} action={action} />
        ))}
      </div>
    </section>
  );
}

function NextActionPill({
  action,
}: {
  action: { title: string; hint: string; href: string; tone: StatusTone; label: string };
}) {
  const toneClass =
    action.tone === 'ok'
      ? 'border-success/20 bg-success/10 text-success hover:border-success/35'
      : action.tone === 'warn'
        ? 'border-[var(--amber)]/25 bg-[var(--amber)]/10 text-[var(--amber-text)] hover:border-[var(--amber)]/40'
        : 'border-border bg-card text-muted-foreground hover:border-[var(--amber)]/30 hover:text-foreground';

  return (
    <Link
      href={action.href}
      title={action.hint}
      aria-label={`${action.title}. ${action.hint}`}
      className={`inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-2xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${toneClass}`}
    >
      <span className="truncate">{action.title}</span>
      <ArrowRight size={11} className="shrink-0" aria-hidden="true" />
      <span className="sr-only">{action.label}</span>
    </Link>
  );
}
