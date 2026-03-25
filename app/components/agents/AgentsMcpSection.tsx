'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Search, Server } from 'lucide-react';
import type { McpContextValue } from '@/hooks/useMcpData';
import type { AgentBuckets } from './agents-content-model';
import type { AgentStatusFilter } from './agents-content-model';
import { filterAgentsForMcpTable } from './agents-content-model';

export default function AgentsMcpSection({
  copy,
  mcp,
  buckets,
  copyState,
  onCopySnippet,
}: {
  copy: {
    title: string;
    refresh: string;
    connectionGraph: string;
    searchPlaceholder: string;
    emptyState: string;
    filters: {
      all: string;
      connected: string;
      detected: string;
      notFound: string;
    };
    table: { agent: string; status: string; transport: string; actions: string };
    actions: { copySnippet: string; copied: string; testConnection: string; reconnect: string };
    status: { connected: string; detected: string; notFound: string };
  };
  mcp: McpContextValue;
  buckets: AgentBuckets;
  copyState: string | null;
  onCopySnippet: (agentKey: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AgentStatusFilter>('all');
  const filteredAgents = useMemo(
    () => filterAgentsForMcpTable(mcp.agents, query, statusFilter),
    [mcp.agents, query, statusFilter],
  );

  return (
    <section role="tabpanel" id="agents-panel-mcp" aria-labelledby="agents-tab-mcp" className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
          <Server size={15} className="text-muted-foreground" />
          {copy.title}
        </h2>
        <button
          type="button"
          onClick={() => void mcp.refresh()}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          <RefreshCw size={13} />
          {copy.refresh}
        </button>
      </div>

      <div className="rounded-md border border-border bg-background p-3">
        <p className="text-xs font-medium text-muted-foreground mb-2">{copy.connectionGraph}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <NodePill label={copy.status.connected} count={buckets.connected.length} tone="ok" />
          <span className="text-muted-foreground">→</span>
          <NodePill label={copy.status.detected} count={buckets.detected.length} tone="warn" />
          <span className="text-muted-foreground">→</span>
          <NodePill label={copy.status.notFound} count={buckets.notFound.length} tone="neutral" />
          <span className="mx-2 text-muted-foreground">|</span>
          <NodePill label={copy.title} count={mcp.status?.running ? 1 : 0} tone={mcp.status?.running ? 'ok' : 'neutral'} />
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-2">
        <label className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={copy.searchPlaceholder}
            className="w-full h-9 rounded-md border border-border bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <div className="flex items-center gap-1 rounded-md border border-border p-1 bg-background">
          <StatusFilterButton active={statusFilter === 'all'} label={copy.filters.all} onClick={() => setStatusFilter('all')} />
          <StatusFilterButton active={statusFilter === 'connected'} label={copy.filters.connected} onClick={() => setStatusFilter('connected')} />
          <StatusFilterButton active={statusFilter === 'detected'} label={copy.filters.detected} onClick={() => setStatusFilter('detected')} />
          <StatusFilterButton active={statusFilter === 'notFound'} label={copy.filters.notFound} onClick={() => setStatusFilter('notFound')} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-border">
              <th className="py-2 font-medium text-muted-foreground">{copy.table.agent}</th>
              <th className="py-2 font-medium text-muted-foreground">{copy.table.status}</th>
              <th className="py-2 font-medium text-muted-foreground">{copy.table.transport}</th>
              <th className="py-2 font-medium text-muted-foreground">{copy.table.actions}</th>
            </tr>
          </thead>
          <tbody>
            {filteredAgents.map((agent) => (
              <tr key={agent.key} className="border-b border-border/60">
                <td className="py-2 text-foreground">
                  <Link href={`/agents/${encodeURIComponent(agent.key)}`} className="hover:underline">{agent.name}</Link>
                </td>
                <td className="py-2 text-muted-foreground">{agent.present ? (agent.installed ? copy.status.connected : copy.status.detected) : copy.status.notFound}</td>
                <td className="py-2 text-muted-foreground">{agent.transport ?? agent.preferredTransport}</td>
                <td className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void onCopySnippet(agent.key)}
                      className="text-xs px-2 py-1 rounded border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {copyState === agent.key ? copy.actions.copied : copy.actions.copySnippet}
                    </button>
                    <button type="button" className="text-xs px-2 py-1 rounded border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {copy.actions.testConnection}
                    </button>
                    <button type="button" className="text-xs px-2 py-1 rounded border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {copy.actions.reconnect}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredAgents.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-sm text-muted-foreground text-center">
                  {copy.emptyState}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusFilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 h-7 rounded text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? 'bg-[var(--amber-dim)] text-[var(--amber)]' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
    >
      {label}
    </button>
  );
}

function NodePill({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: 'ok' | 'warn' | 'neutral';
}) {
  const cls =
    tone === 'ok'
      ? 'bg-success/10 text-success'
      : tone === 'warn'
        ? 'bg-[var(--amber-dim)] text-[var(--amber)]'
        : 'bg-muted text-muted-foreground';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md ${cls}`}>
      <span>{label}</span>
      <span className="tabular-nums">{count}</span>
    </span>
  );
}
