'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Activity, Bot, Cable, MessageSquare, Network, Sparkles, TerminalSquare, Wrench } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useLocale } from '@/lib/stores/locale-store';
import { useMcpData } from '@/lib/stores/mcp-store';
import { useA2aRegistry } from '@/hooks/useA2aRegistry';
import { copyToClipboard } from '@/lib/clipboard';
import { generateSnippet } from '@/lib/mcp-snippets';
import {
  bucketAgents,
  buildRiskQueue,
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
  overview: 'Health',
  presets: 'Built-ins',
  mcp: 'Protocol',
  skills: 'Capabilities',
  channels: 'Messaging',
  network: 'Remote',
  sessions: 'Runs',
  activity: 'Audit',
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
    if (tab === 'activity') {
      return {
        title: a.navActivity ?? 'Activity',
        subtitle: a.activitySubtitle ?? 'Agent operations audit log.',
      };
    }
    if (tab === 'sessions') {
      return {
        title: 'Sessions',
        subtitle: 'Active ACP agent sessions.',
      };
    }
    if (tab === 'a2a') {
      return {
        title: a.navNetwork,
        subtitle: a.a2aTabEmptyHint,
      };
    }
    if (tab === 'skills') {
      return {
        title: a.navSkills,
        subtitle: a.skills.capabilityGroups,
      };
    }
    if (tab === 'presets') {
      return {
        title: a.presets.title,
        subtitle: a.presets.subtitle,
      };
    }
    if (tab === 'mcp') {
      return {
        title: a.navMcp,
        subtitle: a.mcp.connectionGraph,
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
    <div className={`content-width px-4 md:px-6 py-8 md:py-10 ${isChannelDetail ? 'channel-detail-content' : ''}`}>
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
            mcpPort={mcp.status?.port ?? null}
            presetCount={BUILTIN_AGENT_PRESETS.length}
            a2aCount={a2a.agents.length}
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
          allAgents={mcp.agents}
          pulseCopy={a.workspacePulse}
          a2aCount={a2a.agents.length}
          onAddCustomAgent={handleAddCustomAgent}
          onEditCustomAgent={handleEditCustomAgent}
          onRemoveCustomAgent={handleRemoveCustomAgent}
        />
      )}

      {tab === 'mcp' && mcpEnabled && (
        <AgentsMcpSection copy={{ ...a.mcp, status: a.status }} mcp={mcp} buckets={buckets} copyState={null} onCopySnippet={copySnippet} />
      )}

      {/* MCP tab accessed but mode disabled — show hint */}
      {tab === 'mcp' && !mcpEnabled && !mcp.loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-muted-foreground">{a.mcp?.mcpDisabledMessage ?? 'MCP mode is not enabled.'}</p>
          <p className="text-xs text-muted-foreground/60 mt-1">{a.mcp?.mcpDisabledHint ?? 'Enable it in Settings → Connections to use MCP agents.'}</p>
        </div>
      )}

      {tab === 'skills' && (
        <AgentsSkillsSection copy={a.skills} mcp={mcp} buckets={buckets} />
      )}

      {tab === 'presets' && (
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

      {tab === 'activity' && (
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
  mcpPort,
  presetCount,
  a2aCount,
}: {
  tab: AgentsDashboardTab;
  copy: ReturnType<typeof useLocale>['t']['agentsContent'];
  connectedCount: number;
  detectedCount: number;
  enabledSkillCount: number;
  mcpRunning: boolean;
  mcpPort: number | null;
  presetCount: number;
  a2aCount: number;
}) {
  const navHints = copy.navHints ?? DEFAULT_AGENT_NAV_HINTS;
  const navItems: Array<{
    id: AgentsDashboardTab;
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
      badge: connectedCount > 0 ? `${connectedCount}` : undefined,
      tone: detectedCount > 0 ? 'warn' : 'ok',
    },
    {
      id: 'presets',
      href: '/agents?tab=presets',
      label: copy.navPresets,
      hint: navHints.presets,
      icon: <Sparkles size={14} />,
      badge: `${presetCount}`,
      tone: 'neutral',
    },
    {
      id: 'mcp',
      href: '/agents?tab=mcp',
      label: copy.navMcp,
      hint: navHints.mcp,
      icon: <Cable size={14} />,
      badge: mcpRunning && mcpPort ? `:${mcpPort}` : copy.navBadgeOff,
      tone: mcpRunning ? 'ok' : 'warn',
    },
    {
      id: 'skills',
      href: '/agents?tab=skills',
      label: copy.navSkills,
      hint: navHints.skills,
      icon: <Wrench size={14} />,
      badge: `${enabledSkillCount}`,
      tone: 'ok',
    },
    {
      id: 'channels',
      href: '/agents?tab=channels',
      label: copy.navChannels,
      hint: navHints.channels,
      icon: <MessageSquare size={14} />,
      tone: 'neutral',
    },
    {
      id: 'a2a',
      href: '/agents?tab=a2a',
      label: copy.navNetwork,
      hint: navHints.network,
      icon: <Network size={14} />,
      badge: a2aCount > 0 ? `${a2aCount}` : undefined,
      tone: 'neutral',
    },
    {
      id: 'sessions',
      href: '/agents?tab=sessions',
      label: copy.navSessions,
      hint: navHints.sessions,
      icon: <TerminalSquare size={14} />,
      tone: 'neutral',
    },
    {
      id: 'activity',
      href: '/agents?tab=activity',
      label: copy.navActivity,
      hint: navHints.activity,
      icon: <Activity size={14} />,
      tone: 'neutral',
    },
  ];

  return (
    <nav aria-label={copy.navAriaLabel} className="mt-5 overflow-x-auto pb-1">
      <div className="flex w-max min-w-full overflow-hidden rounded-xl border border-border/60 bg-card/35 shadow-sm lg:grid lg:w-auto lg:grid-cols-8">
        {navItems.map(item => (
          <Link
            key={item.id}
            href={item.href}
            aria-current={tab === item.id ? 'page' : undefined}
            className={`group min-h-[68px] w-[104px] shrink-0 border-r border-border/45 px-2.5 py-2.5 transition-colors last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-[112px] lg:w-auto lg:px-3 lg:py-3 ${
              tab === item.id
                ? 'bg-[var(--amber)]/[0.08] text-foreground'
                : 'text-muted-foreground hover:bg-muted/45 hover:text-foreground'
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${
                tab === item.id ? 'bg-[var(--amber)] text-[var(--amber-foreground)]' : 'bg-background text-muted-foreground group-hover:text-foreground'
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
