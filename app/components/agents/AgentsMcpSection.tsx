'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Search, Server } from 'lucide-react';
import type { McpContextValue } from '@/hooks/useMcpData';
import type { AgentBuckets } from './agents-content-model';
import type { AgentStatusFilter, AgentTransportFilter } from './agents-content-model';
import {
  buildMcpRiskQueue,
  filterAgentsForMcpWorkspace,
  summarizeMcpBulkReconnectResults,
} from './agents-content-model';

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
    tabs: {
      manage: string;
      topology: string;
    };
    searchPlaceholder: string;
    emptyState: string;
    resultCount: (n: number) => string;
    filteredSummaryTitle: string;
    filteredConnected: (n: number) => string;
    filteredDetected: (n: number) => string;
    filteredNotFound: (n: number) => string;
    configVisibilityTitle: string;
    hiddenRootDetected: (n: number, total: number) => string;
    runtimeSignalDetected: (n: number, total: number) => string;
    riskQueueTitle: string;
    riskMcpStopped: string;
    riskDetected: (n: number) => string;
    riskNotFound: (n: number) => string;
    bulkReconnectFiltered: string;
    bulkRunning: string;
    bulkSummary: (ok: number, failed: number) => string;
    transportFilters: {
      all: string;
      stdio: string;
      http: string;
      other: string;
    };
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
  const [transportFilter, setTransportFilter] = useState<AgentTransportFilter>('all');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [view, setView] = useState<'manage' | 'topology'>('manage');
  const filteredAgents = useMemo(
    () =>
      filterAgentsForMcpWorkspace(mcp.agents, {
        query,
        status: statusFilter,
        transport: transportFilter,
      }),
    [mcp.agents, query, statusFilter, transportFilter],
  );
  const riskQueue = useMemo(
    () =>
      buildMcpRiskQueue({
        mcpRunning: !!mcp.status?.running,
        detectedCount: buckets.detected.length,
        notFoundCount: buckets.notFound.length,
      }),
    [mcp.status?.running, buckets.detected.length, buckets.notFound.length],
  );
  const filteredSummary = useMemo(
    () => ({
      connected: filteredAgents.filter((agent) => agent.present && agent.installed).length,
      detected: filteredAgents.filter((agent) => agent.present && !agent.installed).length,
      notFound: filteredAgents.filter((agent) => !agent.present).length,
    }),
    [filteredAgents],
  );
  const hiddenRootDetectedCount = useMemo(
    () => mcp.agents.filter((agent) => !!agent.hiddenRootPresent).length,
    [mcp.agents],
  );
  const runtimeSignalDetectedCount = useMemo(
    () =>
      mcp.agents.filter(
        (agent) => !!agent.runtimeConversationSignal || !!agent.runtimeUsageSignal,
      ).length,
    [mcp.agents],
  );

  async function handleTestConnection(agentKey: string) {
    setBusyAction(`test:${agentKey}`);
    try {
      await mcp.refresh();
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReconnect(agent: typeof mcp.agents[number]) {
    setBusyAction(`reconnect:${agent.key}`);
    try {
      const scope = agent.scope === 'project' ? 'project' : 'global';
      const transport = agent.transport === 'http' ? 'http' : 'stdio';
      await mcp.installAgent(agent.key, { scope, transport });
      await mcp.refresh();
    } finally {
      setBusyAction(null);
    }
  }

  async function handleBulkReconnect() {
    if (busyAction !== null || filteredAgents.length === 0) return;
    setBusyAction('bulk');
    setBulkMessage(copy.bulkRunning);
    const results: Array<{ agentKey: string; ok: boolean }> = [];
    for (const agent of filteredAgents) {
      const scope = agent.scope === 'project' ? 'project' : 'global';
      const transport = agent.transport === 'http' ? 'http' : 'stdio';
      const ok = await mcp.installAgent(agent.key, { scope, transport });
      results.push({ agentKey: agent.key, ok });
    }
    await mcp.refresh();
    const summary = summarizeMcpBulkReconnectResults(results);
    setBulkMessage(copy.bulkSummary(summary.succeeded, summary.failed));
    setBusyAction(null);
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
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
        <div className="flex items-center gap-1 rounded-md border border-border p-1 bg-background">
          <StatusFilterButton active={view === 'manage'} label={copy.tabs.manage} onClick={() => setView('manage')} />
          <StatusFilterButton active={view === 'topology'} label={copy.tabs.topology} onClick={() => setView('topology')} />
        </div>
      </div>

      {view === 'topology' ? (
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
      ) : (
        <>
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
            <div role="group" aria-label={copy.table.status} className="flex items-center gap-1 rounded-md border border-border p-1 bg-background">
              <StatusFilterButton active={statusFilter === 'all'} label={copy.filters.all} onClick={() => setStatusFilter('all')} />
              <StatusFilterButton active={statusFilter === 'connected'} label={copy.filters.connected} onClick={() => setStatusFilter('connected')} />
              <StatusFilterButton active={statusFilter === 'detected'} label={copy.filters.detected} onClick={() => setStatusFilter('detected')} />
              <StatusFilterButton active={statusFilter === 'notFound'} label={copy.filters.notFound} onClick={() => setStatusFilter('notFound')} />
            </div>
          </div>
          <div role="group" aria-label={copy.table.transport} className="flex flex-wrap items-center gap-1 rounded-md border border-border p-1 bg-background">
            <StatusFilterButton active={transportFilter === 'all'} label={copy.transportFilters.all} onClick={() => setTransportFilter('all')} />
            <StatusFilterButton active={transportFilter === 'stdio'} label={copy.transportFilters.stdio} onClick={() => setTransportFilter('stdio')} />
            <StatusFilterButton active={transportFilter === 'http'} label={copy.transportFilters.http} onClick={() => setTransportFilter('http')} />
            <StatusFilterButton active={transportFilter === 'other'} label={copy.transportFilters.other} onClick={() => setTransportFilter('other')} />
          </div>
          <div className="rounded-md border border-border bg-background p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">{copy.filteredSummaryTitle}</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-muted-foreground mb-2">
              <span className="rounded-md border border-border px-2 py-1.5">{copy.filteredConnected(filteredSummary.connected)}</span>
              <span className="rounded-md border border-border px-2 py-1.5">{copy.filteredDetected(filteredSummary.detected)}</span>
              <span className="rounded-md border border-border px-2 py-1.5">{copy.filteredNotFound(filteredSummary.notFound)}</span>
            </div>
          </div>
          <div className="rounded-md border border-border bg-background p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">{copy.configVisibilityTitle}</p>
            <ul className="space-y-1.5 text-xs text-muted-foreground mb-3">
              <li>{copy.hiddenRootDetected(hiddenRootDetectedCount, mcp.agents.length)}</li>
              <li>{copy.runtimeSignalDetected(runtimeSignalDetectedCount, mcp.agents.length)}</li>
            </ul>
          </div>
          <div className="rounded-md border border-border bg-background p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">{copy.riskQueueTitle}</p>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {!mcp.status?.running ? <li>{copy.riskMcpStopped}</li> : null}
              {buckets.detected.length > 0 ? <li>{copy.riskDetected(buckets.detected.length)}</li> : null}
              {buckets.notFound.length > 0 ? <li>{copy.riskNotFound(buckets.notFound.length)}</li> : null}
              {riskQueue.length === 0 ? <li>{copy.emptyState}</li> : null}
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleBulkReconnect()}
              disabled={busyAction !== null || filteredAgents.length === 0}
              className="text-xs px-2 py-1 rounded border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {copy.bulkReconnectFiltered}
            </button>
            {bulkMessage ? <span className="text-2xs text-muted-foreground">{bulkMessage}</span> : null}
          </div>
          <p className="text-2xs text-muted-foreground">{copy.resultCount(filteredAgents.length)}</p>

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
                        <button
                          type="button"
                          onClick={() => void handleTestConnection(agent.key)}
                          disabled={!agent.installed || busyAction !== null}
                          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {copy.actions.testConnection}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleReconnect(agent)}
                          disabled={busyAction !== null}
                          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                        >
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
        </>
      )}
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
      aria-pressed={active}
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
