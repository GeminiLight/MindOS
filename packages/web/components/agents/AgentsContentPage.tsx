'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Bot, Cable, MessageSquare, Server, Sparkles } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useLocale } from '@/lib/stores/locale-store';
import { useMcpData } from '@/lib/stores/mcp-store';
import { useA2aRegistry } from '@/hooks/useA2aRegistry';
import { copyToClipboard } from '@/lib/clipboard';
import { generateSnippet } from '@/lib/mcp-snippets';
import {
  bucketAgents,
  buildRiskQueue,
  getAgentsNavGroup,
  type AgentsNavGroup,
  type AgentsDashboardTab,
} from './agents-content-model';
import AgentsOverviewSection from './AgentsOverviewSection';
import AgentsMcpSection from './AgentsMcpSection';
import AgentsSkillsSection from './AgentsSkillsSection';
import AgentsPresetsSection from './AgentsPresetsSection';
import AgentsPanelA2aTab from './AgentsPanelA2aTab';
import AgentsPanelSessionsTab from './AgentsPanelSessionsTab';
import AgentActivitySection from './AgentActivitySection';
import AgentsContentChannels from './AgentsContentChannels';
import CustomAgentModal from './CustomAgentModal';
import { ConfirmDialog } from './AgentsPrimitives';
import { BUILTIN_AGENT_PRESETS } from './builtin-agent-presets';
import type { AgentInfo } from '@/components/settings/types';

const DEFAULT_AGENT_NAV_HINTS = {
  overview: 'Map',
  assistant: 'Profiles',
  agent: 'Runtime endpoints',
  capabilities: 'Skills & MCP',
  channels: 'Messaging',
} as const;

export default function AgentsContentPage({ tab }: { tab: AgentsDashboardTab }) {
  const { t } = useLocale();
  const a = t.agentsContent;
  const mcp = useMcpData();
  const a2a = useA2aRegistry();
  const searchParams = useSearchParams();
  const isChannelDetail = tab === 'channels' && !!searchParams.get('platform');
  const pageHeader = useMemo(() => {
    if (tab === 'channels') {
      return {
        title: a.navChannels ?? 'Channels',
        subtitle: a.channelsSubtitle ?? 'Connect messaging platforms to let MindOS send messages on your behalf.',
      };
    }
    if (tab === 'activity' || tab === 'runs') {
      return {
        title: a.navRuns ?? a.navActivity ?? 'Runs',
        subtitle: a.runsSubtitle ?? a.activitySubtitle ?? 'Sessions and agent operations audit log.',
      };
    }
    if (tab === 'sessions') {
      return {
        title: a.navRuns ?? 'Runs',
        subtitle: a.sessionsSubtitle ?? 'Active ACP agent sessions.',
      };
    }
    if (tab === 'a2a') {
      return {
        title: a.a2aTabTitle ?? a.navNetwork,
        subtitle: a.a2aTabEmptyHint,
      };
    }
    if (tab === 'skills' || tab === 'mcp' || tab === 'capabilities') {
      return {
        title: a.navCapabilities ?? a.navSkills,
        subtitle: a.capabilitiesSubtitle ?? a.skills.capabilityGroups,
      };
    }
    if (tab === 'presets' || tab === 'assistant') {
      return {
        title: a.presets.title,
        subtitle: a.presets.subtitle,
      };
    }
    if (tab === 'agent') {
      return {
        title: a.navAgent ?? a.navMcp,
        subtitle: a.agentSubtitle ?? a.mcp.connectionGraph,
      };
    }
    return {
      title: a.title,
      subtitle: a.subtitle,
    };
  }, [a, tab]);

  const buckets = useMemo(() => bucketAgents(mcp.agents), [mcp.agents]);
  const mcpEnabled = mcp.status?.connectionMode?.mcp ?? false;
  const riskQueue = useMemo(
    () =>
      buildRiskQueue({
        mcpRunning: !!mcp.status?.running,
        mcpEnabled,
        detectedCount: buckets.detected.length,
        notFoundCount: buckets.notFound.length,
        allSkillsDisabled: mcp.skills.length > 0 && mcp.skills.every((s) => !s.enabled),
        copy: a.overview,
      }),
    [mcp.skills, mcp.status?.running, mcpEnabled, buckets.detected.length, buckets.notFound.length, a.overview],
  );
  const enabledSkillCount = useMemo(
    () => mcp.skills.filter((skill) => skill.enabled).length,
    [mcp.skills],
  );

  /* ─── Custom Agent Modal State ─── */
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentInfo | null>(null);
  const [removeAgent, setRemoveAgent] = useState<AgentInfo | null>(null);
  const [, setRemoving] = useState(false);

  const handleAddCustomAgent = useCallback(() => {
    setEditingAgent(null);
    setCustomModalOpen(true);
  }, []);

  const handleEditCustomAgent = useCallback((agent: AgentInfo) => {
    setEditingAgent(agent);
    setCustomModalOpen(true);
  }, []);

  const handleRemoveCustomAgent = useCallback((agent: AgentInfo) => {
    setRemoveAgent(agent);
  }, []);

  const handleConfirmRemove = useCallback(async () => {
    if (!removeAgent) return;
    setRemoving(true);
    try {
      const res = await fetch('/api/agents/custom', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: removeAgent.key }),
      });
      if (res.ok) {
        toast.success(a.overview.customAgentRemoved(removeAgent.name));
        mcp.refresh();
      } else {
        const data = await res.json();
        toast.error(data.error || a.overview.customAgentFailedRemove);
      }
    } catch {
      toast.error(a.overview.customAgentNetworkError);
    } finally {
      setRemoving(false);
      setRemoveAgent(null);
    }
  }, [removeAgent, mcp, a.overview]);

  const handleCustomAgentSuccess = useCallback(() => {
    mcp.refresh();
  }, [mcp]);

  const copySnippet = async (agentKey: string) => {
    const agent = mcp.agents.find((item) => item.key === agentKey);
    if (!agent) return;
    const snippet = generateSnippet(agent, mcp.status, agent.preferredTransport);
    const ok = await copyToClipboard(snippet.snippet);
    if (ok) toast.copy();
  };

  return (
    <div className={`content-width agents-content-page px-4 md:px-6 py-8 md:py-10 ${isChannelDetail ? 'channel-detail-content' : ''}`}>
      {!isChannelDetail && (
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{pageHeader.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{pageHeader.subtitle}</p>
          <AgentsPageNav
            tab={tab}
            copy={a}
            connectedCount={buckets.connected.length}
            detectedCount={buckets.detected.length}
            enabledSkillCount={enabledSkillCount}
            mcpRunning={!!mcp.status?.running}
            mcpEnabled={mcpEnabled}
            mcpPort={mcp.status?.port ?? null}
            presetCount={BUILTIN_AGENT_PRESETS.length}
          />
        </header>
      )}

      {/* Loading skeleton — shown while initial data loads */}
      {mcp.loading && tab === 'overview' && <OverviewSkeleton />}

      {!mcp.loading && tab === 'overview' && (
        <AgentsOverviewSection
          copy={a.overview}
          buckets={buckets}
          riskQueue={riskQueue}
          mcpRunning={!!mcp.status?.running}
          mcpPort={mcp.status?.port ?? null}
          mcpToolCount={mcp.status?.toolCount ?? 0}
          mcpEnabled={mcpEnabled}
          enabledSkillCount={enabledSkillCount}
          assistantCount={BUILTIN_AGENT_PRESETS.length}
          allAgents={mcp.agents}
          pulseCopy={a.workspacePulse}
          onAddCustomAgent={handleAddCustomAgent}
          onEditCustomAgent={handleEditCustomAgent}
          onRemoveCustomAgent={handleRemoveCustomAgent}
        />
      )}

      {(tab === 'mcp' || tab === 'agent' || tab === 'capabilities') && mcpEnabled && (
        <AgentsMcpSection copy={{ ...a.mcp, status: a.status }} mcp={mcp} buckets={buckets} copyState={null} onCopySnippet={copySnippet} />
      )}

      {/* MCP tab accessed but mode disabled — show hint */}
      {(tab === 'mcp' || tab === 'agent' || tab === 'capabilities') && !mcpEnabled && !mcp.loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-muted-foreground">{a.mcp?.mcpDisabledMessage ?? 'MCP mode is not enabled.'}</p>
          <p className="text-xs text-muted-foreground/60 mt-1">{a.mcp?.mcpDisabledHint ?? 'Enable it in Settings → Connections to use MCP agents.'}</p>
        </div>
      )}

      {(tab === 'skills' || tab === 'capabilities') && (
        <div className={tab === 'capabilities' ? 'mt-6' : undefined}>
          <AgentsSkillsSection copy={a.skills} mcp={mcp} buckets={buckets} />
        </div>
      )}

      {(tab === 'presets' || tab === 'assistant') && (
        <AgentsPresetsSection copy={a.presets} />
      )}

      {tab === 'a2a' && (
        <AgentsPanelA2aTab
          agents={a2a.agents}
          discovering={a2a.discovering}
          error={a2a.error}
          onDiscover={a2a.discover}
          onRemove={a2a.remove}
        />
      )}

      {tab === 'sessions' && (
        <AgentsPanelSessionsTab />
      )}

      {(tab === 'activity' || tab === 'runs') && (
        <AgentActivitySection />
      )}

      {tab === 'channels' && (
        <AgentsContentChannels />
      )}

      {/* Custom Agent Modal */}
      <CustomAgentModal
        open={customModalOpen}
        onClose={() => { setCustomModalOpen(false); setEditingAgent(null); }}
        onSuccess={handleCustomAgentSuccess}
        existingAgents={mcp.agents}
        editAgent={editingAgent}
      />

      {/* Remove Confirmation */}
      <ConfirmDialog
        open={!!removeAgent}
        title={removeAgent ? a.overview.customAgentRemoveTitle(removeAgent.name) : ''}
        message={a.overview.customAgentRemoveMessage as string}
        confirmLabel={a.overview.customAgentRemoveConfirm as string}
        cancelLabel={a.overview.customAgentCancel as string}
        onConfirm={handleConfirmRemove}
        onCancel={() => setRemoveAgent(null)}
        variant="destructive"
      />
    </div>
  );
}

function AgentsPageNav({
  tab,
  copy,
  connectedCount,
  detectedCount,
  enabledSkillCount,
  mcpRunning,
  mcpEnabled,
  mcpPort,
  presetCount,
}: {
  tab: AgentsDashboardTab;
  copy: ReturnType<typeof useLocale>['t']['agentsContent'];
  connectedCount: number;
  detectedCount: number;
  enabledSkillCount: number;
  mcpRunning: boolean;
  mcpEnabled: boolean;
  mcpPort: number | null;
  presetCount: number;
}) {
  const navHints = copy.navHints ?? DEFAULT_AGENT_NAV_HINTS;
  const activeGroup = getAgentsNavGroup(tab);
  const navItems: Array<{
    id: AgentsNavGroup;
    href: string;
    label: string;
    hint: string;
    icon: React.ReactNode;
    badge?: string;
    tone?: 'ok' | 'warn' | 'neutral';
  }> = [
    {
      id: 'overview',
      href: '/agents',
      label: copy.navOverview,
      hint: navHints.overview,
      icon: <Bot size={14} />,
      tone: detectedCount > 0 ? 'warn' : 'ok',
    },
    {
      id: 'assistant',
      href: '/agents?tab=assistant',
      label: copy.navAssistant ?? copy.navPresets,
      hint: navHints.assistant ?? navHints.presets,
      icon: <Sparkles size={14} />,
      badge: `${presetCount}`,
      tone: 'neutral',
    },
    {
      id: 'agent',
      href: '/agents?tab=agent',
      label: copy.navAgent ?? copy.navMcp,
      hint: navHints.agent ?? navHints.mcp,
      icon: <Cable size={14} />,
      badge: detectedCount > 0 ? copy.navBadgeAttention?.(detectedCount) ?? `${detectedCount}` : connectedCount > 0 ? `${connectedCount}` : undefined,
      tone: detectedCount > 0 ? 'warn' : 'ok',
    },
    {
      id: 'capabilities',
      href: '/agents?tab=capabilities',
      label: copy.navCapabilities ?? copy.navSkills,
      hint: navHints.capabilities ?? navHints.skills,
      icon: <Server size={14} />,
      badge: mcpRunning && mcpPort ? `MCP :${mcpPort}` : `${enabledSkillCount}`,
      tone: mcpEnabled && !mcpRunning ? 'warn' : mcpRunning || enabledSkillCount > 0 ? 'ok' : 'neutral',
    },
    {
      id: 'channels',
      href: '/agents?tab=channels',
      label: copy.navChannels,
      hint: navHints.channels ?? 'Messaging',
      icon: <MessageSquare size={14} />,
      tone: 'neutral',
    },
  ];

  return (
    <nav aria-label={copy.navAriaLabel} className="mt-5 overflow-x-auto pb-1">
      <div className="flex w-max min-w-full overflow-hidden rounded-xl border border-border/60 bg-card/35 shadow-sm lg:grid lg:w-auto lg:grid-cols-5">
        {navItems.map(item => (
          <Link
            key={item.id}
            href={item.href}
            aria-current={activeGroup === item.id ? 'page' : undefined}
            className={`group min-h-[70px] w-[156px] shrink-0 border-r border-border/45 px-3 py-2.5 transition-colors last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-auto lg:px-4 lg:py-3 ${
              activeGroup === item.id
                ? 'bg-[var(--amber)]/[0.08] text-foreground'
                : 'text-muted-foreground hover:bg-muted/45 hover:text-foreground'
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${
                activeGroup === item.id ? 'bg-[var(--amber)] text-[var(--amber-foreground)]' : 'bg-background text-muted-foreground group-hover:text-foreground'
              }`}>
                {item.icon}
              </span>
              {item.badge ? (
                <span className={`rounded-full px-2 py-0.5 text-2xs font-medium tabular-nums ${
                  item.tone === 'ok'
                    ? 'bg-success/10 text-success'
                    : item.tone === 'warn'
                      ? 'bg-[var(--amber)]/10 text-[var(--amber-text)]'
                      : 'bg-muted text-muted-foreground'
                }`}>
                  {item.badge}
                </span>
              ) : null}
            </span>
            <span className="mt-2 block text-xs font-medium text-foreground">{item.label}</span>
            <span className="mt-0.5 block truncate text-2xs text-muted-foreground/65 lg:block">{item.hint}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

/* ────────── Loading skeleton for Overview ────────── */

function OverviewSkeleton() {
  return (
    <div className="space-y-5 animate-pulse" aria-busy="true" aria-label="Loading">
      {/* Stats bar skeleton */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-muted/10">
          <div className="h-4 w-32 bg-muted rounded" />
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 divide-x divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="px-3 py-3.5 flex flex-col items-center gap-2">
              <div className="h-3 w-16 bg-muted rounded" />
              <div className="h-5 w-8 bg-muted rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Quick nav skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-20 bg-muted rounded" />
              <div className="h-3 w-full bg-muted rounded" />
            </div>
          </div>
        ))}
      </div>

      {/* Agent cards skeleton */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="h-4 w-24 bg-muted rounded" />
          <div className="h-3 w-16 bg-muted rounded" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-7 h-7 rounded-full bg-muted" />
                <div className="flex-1 h-4 bg-muted rounded" />
                <div className="h-4 w-16 bg-muted rounded" />
              </div>
              <div className="h-3 w-2/3 bg-muted rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
