'use client';

import Link from 'next/link';
import { RefreshCw, Server } from 'lucide-react';
import type { McpContextValue } from '@/hooks/useMcpData';
import type { AgentBuckets } from './agents-content-model';

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
    table: { agent: string; status: string; transport: string; actions: string };
    actions: { copySnippet: string; copied: string; testConnection: string; reconnect: string };
    status: { connected: string; detected: string; notFound: string };
  };
  mcp: McpContextValue;
  buckets: AgentBuckets;
  copyState: string | null;
  onCopySnippet: (agentKey: string) => Promise<void>;
}) {
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
            {mcp.agents.map((agent) => (
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
          </tbody>
        </table>
      </div>
    </section>
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
