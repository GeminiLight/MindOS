'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Server, Wrench } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import { useMcpData } from '@/hooks/useMcpData';
import { copyToClipboard } from '@/lib/clipboard';
import { generateSnippet } from '@/lib/mcp-snippets';
import { Toggle } from '@/components/settings/Primitives';
import {
  bucketAgents,
  buildRiskQueue,
  groupSkillsByCapability,
  type AgentsDashboardTab,
} from './agents-content-model';

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
  const skillGroups = useMemo(() => groupSkillsByCapability(mcp.skills), [mcp.skills]);

  const navClass = (target: AgentsDashboardTab) =>
    `px-3 py-1.5 text-xs rounded-md border transition-colors ${
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

      <div className="mb-6 flex items-center gap-2 border-b border-border pb-3">
        <Link href="/agents" className={navClass('overview')}>{a.navOverview}</Link>
        <Link href="/agents?tab=mcp" className={navClass('mcp')}>{a.navMcp}</Link>
        <Link href="/agents?tab=skills" className={navClass('skills')}>{a.navSkills}</Link>
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <StatCard title={a.overview.connected} value={String(buckets.connected.length)} tone="ok" />
            <StatCard title={a.overview.detected} value={String(buckets.detected.length)} tone="warn" />
            <StatCard title={a.overview.notFound} value={String(buckets.notFound.length)} tone="warn" />
          </section>
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-medium text-foreground mb-3">{a.overview.riskQueue}</h2>
            {riskQueue.length === 0 ? (
              <p className="text-sm text-muted-foreground">{a.overview.noRisk}</p>
            ) : (
              <ul className="space-y-2">
                {riskQueue.map((risk) => (
                  <li key={risk.id} className="flex items-start gap-2 text-sm">
                    <AlertTriangle size={14} className={risk.severity === 'error' ? 'text-destructive mt-0.5' : 'text-[var(--amber)] mt-0.5'} />
                    <span className="text-foreground">{risk.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-medium text-foreground mb-3">{a.overview.usagePulse}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <InfoLine label={a.overview.successRate7d} value={a.overview.na} />
              <InfoLine label={a.overview.topSkills} value={mcp.skills.filter((s) => s.enabled).slice(0, 3).map((s) => s.name).join(', ') || a.overview.na} />
              <InfoLine label={a.overview.failedAgents} value={buckets.notFound.map((x) => x.name).slice(0, 3).join(', ') || a.overview.na} />
            </div>
          </section>
        </div>
      )}

      {tab === 'mcp' && (
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Server size={15} className="text-muted-foreground" />
              {a.mcp.title}
            </h2>
            <button
              type="button"
              onClick={() => void mcp.refresh()}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw size={13} />
              {a.mcp.refresh}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border">
                  <th className="py-2 font-medium text-muted-foreground">{a.mcp.table.agent}</th>
                  <th className="py-2 font-medium text-muted-foreground">{a.mcp.table.status}</th>
                  <th className="py-2 font-medium text-muted-foreground">{a.mcp.table.transport}</th>
                  <th className="py-2 font-medium text-muted-foreground">{a.mcp.table.actions}</th>
                </tr>
              </thead>
              <tbody>
                {mcp.agents.map((agent) => (
                  <tr key={agent.key} className="border-b border-border/60">
                    <td className="py-2 text-foreground">
                      <Link href={`/agents/${encodeURIComponent(agent.key)}`} className="hover:underline">{agent.name}</Link>
                    </td>
                    <td className="py-2 text-muted-foreground">{agent.present ? (agent.installed ? a.status.connected : a.status.detected) : a.status.notFound}</td>
                    <td className="py-2 text-muted-foreground">{agent.transport ?? agent.preferredTransport}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => void copySnippet(agent.key)} className="text-xs px-2 py-1 rounded border border-border hover:bg-muted">
                          {copyState === agent.key ? a.mcp.actions.copied : a.mcp.actions.copySnippet}
                        </button>
                        <button type="button" className="text-xs px-2 py-1 rounded border border-border hover:bg-muted">{a.mcp.actions.testConnection}</button>
                        <button type="button" className="text-xs px-2 py-1 rounded border border-border hover:bg-muted">{a.mcp.actions.reconnect}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'skills' && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium text-foreground mb-1">{a.skills.title}</h2>
          <p className="text-xs text-muted-foreground mb-4">{a.skills.capabilityGroups}</p>
          <div className="space-y-4">
            {Object.entries(skillGroups).map(([groupKey, skills]) => (
              <div key={groupKey} className="rounded-md border border-border p-3">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  {a.skills.groupLabels[groupKey as keyof typeof a.skills.groupLabels]} ({skills.length})
                </div>
                {skills.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{a.skills.emptyGroup}</p>
                ) : (
                  <div className="space-y-1.5">
                    {skills.map((skill) => (
                      <div key={skill.name} className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground truncate">{skill.name}</p>
                          <p className="text-2xs text-muted-foreground">{skill.source === 'builtin' ? a.skills.sourceBuiltin : a.skills.sourceUser}</p>
                        </div>
                        <Toggle size="sm" checked={skill.enabled} onChange={(v) => void mcp.toggleSkill(skill.name, v)} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ title, value, tone }: { title: string; value: string; tone: 'ok' | 'warn' }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground">{title}</p>
        {tone === 'ok' ? <CheckCircle2 size={14} className="text-success" /> : <Wrench size={14} className="text-[var(--amber)]" />}
      </div>
      <p className="text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-2xs text-muted-foreground mb-1">{label}</p>
      <p className="text-sm text-foreground truncate">{value}</p>
    </div>
  );
}
