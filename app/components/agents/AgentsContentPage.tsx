'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
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

  const navClass = (target: AgentsDashboardTab) =>
    `px-3 py-1.5 text-xs rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      tab === target
        ? 'border-border bg-[var(--amber-dim)] text-[var(--amber)]'
        : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
    }`;

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
        <h1 className="text-2xl font-semibold tracking-tight font-display text-foreground">{a.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{a.subtitle}</p>
      </header>

      <div className="mb-6 flex items-center gap-2 border-b border-border pb-3" role="tablist" aria-label={a.title}>
        <Link href="/agents" role="tab" id="agents-tab-overview" aria-controls="agents-panel-overview" aria-selected={tab === 'overview'} className={navClass('overview')}>{a.navOverview}</Link>
        <Link href="/agents?tab=mcp" role="tab" id="agents-tab-mcp" aria-controls="agents-panel-mcp" aria-selected={tab === 'mcp'} className={navClass('mcp')}>{a.navMcp}</Link>
        <Link href="/agents?tab=skills" role="tab" id="agents-tab-skills" aria-controls="agents-panel-skills" aria-selected={tab === 'skills'} className={navClass('skills')}>{a.navSkills}</Link>
      </div>

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
