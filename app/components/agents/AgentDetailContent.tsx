'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { ArrowLeft, Server, ShieldCheck, Activity, Compass } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import { useMcpData } from '@/hooks/useMcpData';
import { resolveAgentStatus } from './agents-content-model';

export default function AgentDetailContent({ agentKey }: { agentKey: string }) {
  const { t } = useLocale();
  const a = t.agentsContent;
  const mcp = useMcpData();

  const agent = useMemo(() => mcp.agents.find((item) => item.key === agentKey), [mcp.agents, agentKey]);
  const enabledSkills = useMemo(() => mcp.skills.filter((s) => s.enabled), [mcp.skills]);

  if (!agent) {
    return (
      <div className="content-width px-4 md:px-6 py-8 md:py-10">
        <Link href="/agents" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft size={14} />
          {a.backToOverview}
        </Link>
        <div className="rounded-lg border border-border bg-card p-6">
          <p className="text-sm text-foreground">{a.detailNotFound}</p>
        </div>
      </div>
    );
  }

  const status = resolveAgentStatus(agent);

  return (
    <div className="content-width px-4 md:px-6 py-8 md:py-10 space-y-4">
      <div>
        <Link href="/agents" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft size={14} />
          {a.backToOverview}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight font-display text-foreground">{agent.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{a.detailSubtitle}</p>
      </div>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground mb-2">{a.detail.identity}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <DetailLine label={a.detail.agentKey} value={agent.key} />
          <DetailLine label={a.detail.status} value={status} />
          <DetailLine label={a.detail.transport} value={agent.transport ?? agent.preferredTransport} />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
          <Server size={14} className="text-muted-foreground" />
          {a.detail.connection}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <DetailLine label={a.detail.endpoint} value={mcp.status?.endpoint ?? a.na} />
          <DetailLine label={a.detail.port} value={String(mcp.status?.port ?? a.na)} />
          <DetailLine label={a.detail.auth} value={mcp.status?.authConfigured ? a.detail.authConfigured : a.detail.authMissing} />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
          <ShieldCheck size={14} className="text-muted-foreground" />
          {a.detail.capabilities}
        </h2>
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>{a.detail.projectScope}: {agent.hasProjectScope ? a.detail.yes : a.detail.no}</li>
          <li>{a.detail.globalScope}: {agent.hasGlobalScope ? a.detail.yes : a.detail.no}</li>
          <li>{a.detail.format}: {agent.format}</li>
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground mb-2">{a.detail.skillAssignments}</h2>
        {enabledSkills.length === 0 ? (
          <p className="text-sm text-muted-foreground">{a.detail.noSkills}</p>
        ) : (
          <ul className="text-sm text-muted-foreground space-y-1">
            {enabledSkills.map((skill) => (
              <li key={skill.name}>- {skill.name}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
          <Activity size={14} className="text-muted-foreground" />
          {a.detail.runtimeSignals}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <DetailLine label={a.detail.skillMode} value={agent.skillMode ?? a.na} />
          <DetailLine label={a.detail.hiddenRoot} value={agent.hiddenRootPath ?? a.na} />
          <DetailLine label={a.detail.hiddenRootPresent} value={agent.hiddenRootPresent ? a.detail.yes : a.detail.no} />
          <DetailLine label={a.detail.conversationSignal} value={agent.runtimeConversationSignal ? a.detail.yes : a.detail.no} />
          <DetailLine label={a.detail.usageSignal} value={agent.runtimeUsageSignal ? a.detail.yes : a.detail.no} />
          <DetailLine label={a.detail.lastActivityAt} value={agent.runtimeLastActivityAt ?? a.na} />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
          <Activity size={14} className="text-muted-foreground" />
          {a.detail.recentActivity}
        </h2>
        <p className="text-sm text-muted-foreground">{a.detail.noActivity}</p>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
          <Compass size={14} className="text-muted-foreground" />
          {a.detail.spaceReach}
        </h2>
        <p className="text-sm text-muted-foreground">{a.detail.noSpaceReach}</p>
      </section>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-2xs text-muted-foreground mb-1">{label}</p>
      <p className="text-sm text-foreground truncate">{value}</p>
    </div>
  );
}
