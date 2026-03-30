'use client';

import { useMemo, useState } from 'react';
import { useLocale } from '@/lib/LocaleContext';
import { useMcpData } from '@/hooks/useMcpData';
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
import AgentsPanelA2aTab from './AgentsPanelA2aTab';

export default function AgentsContentPage({ tab }: { tab: AgentsDashboardTab }) {
  const { t } = useLocale();
  const a = t.agentsContent;
  const mcp = useMcpData();
  const a2a = useA2aRegistry();
  const [copyState, setCopyState] = useState<string | null>(null);
  const pageHeader = useMemo(() => {
    if (tab === 'a2a') {
      return {
        title: a.a2aTabTitle,
        subtitle: a.a2aTabEmptyHint,
      };
    }
    if (tab === 'skills') {
      return {
        title: a.navSkills,
        subtitle: a.skills.capabilityGroups,
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
  const riskQueue = useMemo(
    () =>
      buildRiskQueue({
        mcpRunning: !!mcp.status?.running,
        detectedCount: buckets.detected.length,
        notFoundCount: buckets.notFound.length,
        allSkillsDisabled: mcp.skills.length > 0 && mcp.skills.every((s) => !s.enabled),
        copy: a.overview,
      }),
    [mcp.skills, mcp.status?.running, buckets.detected.length, buckets.notFound.length, a.overview],
  );
  const enabledSkillCount = useMemo(
    () => mcp.skills.filter((skill) => skill.enabled).length,
    [mcp.skills],
  );

  const copySnippet = async (agentKey: string) => {
    const agent = mcp.agents.find((item) => item.key === agentKey);
    if (!agent) return;
    const snippet = generateSnippet(agent, mcp.status, agent.preferredTransport);
    const ok = await copyToClipboard(snippet.snippet);
    if (!ok) return;
    setCopyState(agentKey);
    setTimeout(() => setCopyState(null), 1500);
  };

  return (
    <div className="content-width px-4 md:px-6 py-8 md:py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight font-display text-foreground">{pageHeader.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{pageHeader.subtitle}</p>
      </header>

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
          enabledSkillCount={enabledSkillCount}
          allAgents={mcp.agents}
          pulseCopy={a.workspacePulse}
          a2aCount={a2a.agents.length}
        />
      )}

      {tab === 'mcp' && (
        <AgentsMcpSection copy={{ ...a.mcp, status: a.status }} mcp={mcp} buckets={buckets} copyState={copyState} onCopySnippet={copySnippet} />
      )}

      {tab === 'skills' && (
        <AgentsSkillsSection copy={a.skills} mcp={mcp} buckets={buckets} />
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
    </div>
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