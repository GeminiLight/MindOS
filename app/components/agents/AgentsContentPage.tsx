'use client';

import { useMemo, useState } from 'react';
import { useLocale } from '@/lib/LocaleContext';
import { useMcpData } from '@/hooks/useMcpData';
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

export default function AgentsContentPage({ tab }: { tab: AgentsDashboardTab }) {
  const { t } = useLocale();
  const a = t.agentsContent;
  const mcp = useMcpData();
  const [copyState, setCopyState] = useState<string | null>(null);
  const pageHeader = useMemo(() => {
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
      }),
    [mcp.skills, mcp.status?.running, buckets.detected.length, buckets.notFound.length],
  );
  const workspacePulse = useMemo(() => {
    const enabledSkills = mcp.skills.filter((skill) => skill.enabled).length;
    return {
      connected: buckets.connected.length,
      detected: buckets.detected.length,
      notFound: buckets.notFound.length,
      risk: riskQueue.length,
      enabledSkills,
    };
  }, [buckets.connected.length, buckets.detected.length, buckets.notFound.length, mcp.skills, riskQueue.length]);

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
      <section className="mb-6 rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">{a.workspacePulse.title}</h2>
          <span className="text-2xs text-muted-foreground">
            {workspacePulse.risk === 0 ? a.workspacePulse.healthy : a.workspacePulse.needsAttention(workspacePulse.risk)}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <PulseMetric label={a.workspacePulse.connected} value={workspacePulse.connected} tone="ok" />
          <PulseMetric label={a.workspacePulse.detected} value={workspacePulse.detected} tone="warn" />
          <PulseMetric label={a.workspacePulse.notFound} value={workspacePulse.notFound} tone="warn" />
          <PulseMetric label={a.workspacePulse.risk} value={workspacePulse.risk} tone={workspacePulse.risk > 0 ? 'warn' : 'ok'} />
          <PulseMetric label={a.workspacePulse.enabledSkills} value={workspacePulse.enabledSkills} tone="ok" />
        </div>
      </section>

      {tab === 'overview' && (
        <AgentsOverviewSection
          copy={a.overview}
          buckets={buckets}
          riskQueue={riskQueue}
          topSkillsLabel={a.overview.topSkills}
          failedAgentsLabel={a.overview.failedAgents}
          topSkillsValue={mcp.skills.filter((s) => s.enabled).slice(0, 3).map((s) => s.name).join(', ') || a.overview.na}
          failedAgentsValue={buckets.notFound.map((x) => x.name).slice(0, 3).join(', ') || a.overview.na}
        />
      )}

      {tab === 'mcp' && (
        <AgentsMcpSection copy={{ ...a.mcp, status: a.status }} mcp={mcp} buckets={buckets} copyState={copyState} onCopySnippet={copySnippet} />
      )}

      {tab === 'skills' && (
        <AgentsSkillsSection copy={a.skills} mcp={mcp} buckets={buckets} />
      )}
    </div>
  );
}

function PulseMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'ok' | 'warn';
}) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <p className="text-2xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-sm font-medium tabular-nums ${tone === 'ok' ? 'text-success' : 'text-[var(--amber)]'}`}>{value}</p>
    </div>
  );
}
