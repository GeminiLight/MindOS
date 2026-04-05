'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Search, Server } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import type { McpContextValue } from '@/lib/stores/mcp-store';
import type { AgentBuckets, AgentStatusFilter, AgentTransportFilter } from './agents-content-model';
import {
  ActionButton,
  AddAvatarButton,
  AgentAvatar,
  AgentPickerPopover,
  BulkMessage,
  ConfirmDialog,
  EmptyState,
  PillButton,
  SearchInput,
  StatusDot,
} from './AgentsPrimitives';
import {
  aggregateCrossAgentMcpServers,

  filterAgentsForMcpWorkspace,
  resolveAgentStatus,
  sortAgentsByStatus,
  summarizeMcpBulkReconnectResults,
} from './agents-content-model';

type McpView = 'byAgent' | 'byServer';

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
    tabs: { byAgent: string; byServer: string; [k: string]: string };
    searchPlaceholder: string;
    emptyState: string;
    resultCount: (n: number) => string;
    crossAgentServersEmpty: string;
    riskMcpStopped: string;
    bulkReconnectFiltered: string;
    bulkRunning: string;
    bulkSummary: (ok: number, failed: number) => string;
    installMindos: string;
    mcpServerLabel: string;
    searchServersPlaceholder: string;
    serverAgentCount: (n: number) => string;
    addAgent: string;
    removeFromServer: string;
    confirmRemoveTitle: string;
    confirmRemoveMessage: (agent: string, server: string) => string;
    cancel: string;
    noAvailableAgents: string;
    manualRemoveHint: string;
    removeSuccess: string;
    removeFailed: string;
    reconnectAllInServer: string;
    reconnectAllRunning: string;
    reconnectAllDone: (ok: number, failed: number) => string;
    serverTransport: (t: string) => string;
    transportFilters: { all: string; stdio: string; http: string; other: string };
    filters: { all: string; connected: string; detected: string; notFound: string };
    table: { status: string; transport: string; [k: string]: string };
    actions: { copySnippet: string; copied: string; reconnect: string; [k: string]: string };
    status: { connected: string; detected: string; notFound: string };
  };
  mcp: McpContextValue;
  buckets: AgentBuckets;
  copyState: string | null;
  onCopySnippet: (agentKey: string) => Promise<void>;
}) {
  const [view, setView] = useState<McpView>('byServer');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AgentStatusFilter>('all');
  const [transportFilter, setTransportFilter] = useState<AgentTransportFilter>('all');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  const sortedAgents = useMemo(() => sortAgentsByStatus(mcp.agents), [mcp.agents]);
  const filteredAgents = useMemo(
    () => sortAgentsByStatus(filterAgentsForMcpWorkspace(mcp.agents, { query, status: statusFilter, transport: transportFilter })),
    [mcp.agents, query, statusFilter, transportFilter],
  );
  const crossAgentServers = useMemo(() => aggregateCrossAgentMcpServers(mcp.agents), [mcp.agents]);
  const filteredServers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return crossAgentServers;
    return crossAgentServers.filter((srv) => srv.serverName.toLowerCase().includes(q));
  }, [crossAgentServers, query]);

  async function handleReconnect(agent: (typeof mcp.agents)[number]) {
    setBusyAction(`reconnect:${agent.key}`);
    try {
      const scope = agent.scope === 'project' ? 'project' : 'global';
      const transport = agent.transport === 'http' ? 'http' : 'stdio';
      await mcp.installAgent(agent.key, { scope, transport });
      await mcp.refresh();
    } catch (err) {
      console.error('[mcp] reconnect failed', err);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleInstallMindos(agentKey: string) {
    setBusyAction(`install:${agentKey}`);
    try {
      await mcp.installAgent(agentKey, { scope: 'global', transport: 'stdio' });
      await mcp.refresh();
    } catch (err) {
      console.error('[mcp] install mindos failed', err);
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

  const isRefreshing = busyAction === 'refresh';

  return (
    <section className="space-y-4 overflow-hidden" aria-label={copy.title}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-muted/50 flex items-center justify-center">
              <Server size={13} className="text-muted-foreground/70" aria-hidden="true" />
            </div>
            {copy.title}
          </h2>
          <button
            type="button"
            onClick={() => { setBusyAction('refresh'); void mcp.refresh().finally(() => setBusyAction(null)); }}
            disabled={isRefreshing}
            aria-label={copy.refresh}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md px-1.5 py-1 hover:bg-muted disabled:opacity-50 transition-colors duration-150"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
            {copy.refresh}
          </button>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5 bg-background" role="tablist" aria-label={copy.title}>
          <PillButton active={view === 'byServer'} label={copy.tabs.byServer} onClick={() => setView('byServer')} />
          <PillButton active={view === 'byAgent'} label={copy.tabs.byAgent} onClick={() => setView('byAgent')} />
        </div>
      </div>

      {/* Compact status strip + risk alerts */}
      <div className="rounded-xl border border-border/60 bg-gradient-to-r from-card to-card/80 p-3.5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <StatusDot tone="ok" label={copy.filters.connected} count={buckets.connected.length} />
          <StatusDot tone="warn" label={copy.filters.detected} count={buckets.detected.length} />
          {buckets.notFound.length > 0 && (
            <StatusDot tone="neutral" label={copy.filters.notFound} count={buckets.notFound.length} />
          )}
          <span className="text-muted-foreground/40" aria-hidden="true">|</span>
          <StatusDot tone={mcp.status?.running ? 'ok' : 'neutral'} label={copy.mcpServerLabel} count={mcp.status?.running ? 1 : 0} />
        </div>
        {!mcp.status?.running && (
          <div className="mt-2 pt-2 border-t border-border/60" role="alert">
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" aria-hidden="true" />
              {copy.riskMcpStopped}
            </p>
          </div>
        )}
      </div>

      {/* Search */}
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={view === 'byAgent' ? copy.searchPlaceholder : copy.searchServersPlaceholder}
        ariaLabel={copy.searchPlaceholder}
        icon={Search}
      />

      {view === 'byAgent' ? (
        <ByAgentView
          copy={copy}
          agents={filteredAgents}
          busyAction={busyAction}
          copyState={copyState}
          bulkMessage={bulkMessage}
          statusFilter={statusFilter}
          transportFilter={transportFilter}
          onStatusFilter={setStatusFilter}
          onTransportFilter={setTransportFilter}
          onCopySnippet={onCopySnippet}
          onReconnect={handleReconnect}
          onInstallMindos={handleInstallMindos}
          onBulkReconnect={handleBulkReconnect}
        />
      ) : (
        <ByServerView
          copy={copy}
          servers={filteredServers}
          allAgents={sortedAgents}
          busyAction={busyAction}
          onInstallMindos={handleInstallMindos}
          onReconnect={handleReconnect}
        />
      )}
    </section>
  );
}

/* ────────── By Agent View ────────── */

function ByAgentView({
  copy,
  agents,
  busyAction,
  copyState,
  bulkMessage,
  statusFilter,
  transportFilter,
  onStatusFilter,
  onTransportFilter,
  onCopySnippet,
  onReconnect,
  onInstallMindos,
  onBulkReconnect,
}: {
  copy: Parameters<typeof AgentsMcpSection>[0]['copy'];
  agents: ReturnType<typeof sortAgentsByStatus>;
  busyAction: string | null;
  copyState: string | null;
  bulkMessage: string | null;
  statusFilter: AgentStatusFilter;
  transportFilter: AgentTransportFilter;
  onStatusFilter: (f: AgentStatusFilter) => void;
  onTransportFilter: (f: AgentTransportFilter) => void;
  onCopySnippet: (agentKey: string) => Promise<void>;
  onReconnect: (agent: ReturnType<typeof sortAgentsByStatus>[number]) => Promise<void>;
  onInstallMindos: (agentKey: string) => Promise<void>;
  onBulkReconnect: () => Promise<void>;
}) {
  return (
    <>
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div role="group" aria-label={copy.table.status} className="flex items-center gap-0.5 rounded-md border border-border p-0.5 bg-background">
          <PillButton active={statusFilter === 'all'} label={copy.filters.all} onClick={() => onStatusFilter('all')} />
          <PillButton active={statusFilter === 'connected'} label={copy.filters.connected} onClick={() => onStatusFilter('connected')} />
          <PillButton active={statusFilter === 'detected'} label={copy.filters.detected} onClick={() => onStatusFilter('detected')} />
          <PillButton active={statusFilter === 'notFound'} label={copy.filters.notFound} onClick={() => onStatusFilter('notFound')} />
        </div>
        <div role="group" aria-label={copy.table.transport} className="flex items-center gap-0.5 rounded-md border border-border p-0.5 bg-background">
          <PillButton active={transportFilter === 'all'} label={copy.transportFilters.all} onClick={() => onTransportFilter('all')} />
          <PillButton active={transportFilter === 'stdio'} label={copy.transportFilters.stdio} onClick={() => onTransportFilter('stdio')} />
          <PillButton active={transportFilter === 'http'} label={copy.transportFilters.http} onClick={() => onTransportFilter('http')} />
          <PillButton active={transportFilter === 'other'} label={copy.transportFilters.other} onClick={() => onTransportFilter('other')} />
        </div>
      </div>

      {/* Bulk actions + result count */}
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton
          onClick={() => void onBulkReconnect()}
          disabled={busyAction !== null || agents.length === 0}
          busy={busyAction === 'bulk'}
          label={copy.bulkReconnectFiltered}
        />
        <span className="text-2xs text-muted-foreground tabular-nums">{copy.resultCount(agents.length)}</span>
        <BulkMessage message={bulkMessage} />
      </div>

      {/* Agent cards */}
      {agents.length === 0 ? (
        <EmptyState message={copy.emptyState} />
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => {
            const status = resolveAgentStatus(agent);
            const mcpServers = agent.configuredMcpServers ?? [];
            const nativeSkillCount = (agent.installedSkillNames ?? []).length;
            return (
              <div key={agent.key} className={`rounded-xl border bg-card group hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-150 ${status === 'detected' ? 'border-l-2 border-l-[var(--amber)] border-border' : status === 'notFound' ? 'border-l-2 border-l-error border-border' : 'border-border'}`}>
                {/* Card header with avatar */}
                <div className="flex items-center gap-3 p-3">
                  <AgentAvatar name={agent.name} status={status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link href={`/agents/${encodeURIComponent(agent.key)}`} className="text-sm font-medium text-foreground hover:underline cursor-pointer truncate">
                        {agent.name}
                      </Link>
                      <span className="text-2xs text-muted-foreground font-mono shrink-0">{agent.transport ?? agent.preferredTransport}</span>
                      <span className={`text-2xs px-1.5 py-0.5 rounded shrink-0 ${status === 'connected' ? 'bg-muted text-muted-foreground' : status === 'detected' ? 'bg-[var(--amber-dim)] text-[var(--amber-text)]' : 'bg-error/10 text-error'}`}>
                        {copy.status[status]}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-2xs text-muted-foreground">
                      <span className="tabular-nums">{mcpServers.length} MCP</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{nativeSkillCount} skills</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity duration-150">
                    <ActionButton
                      onClick={() => void onCopySnippet(agent.key)}
                      disabled={false}
                      busy={false}
                      label={copyState === agent.key ? copy.actions.copied : copy.actions.copySnippet}
                    />
                    {agent.installed ? (
                      <ActionButton
                        onClick={() => void onReconnect(agent)}
                        disabled={busyAction !== null}
                        busy={busyAction === `reconnect:${agent.key}`}
                        label={copy.actions.reconnect}
                      />
                    ) : (
                      <ActionButton
                        onClick={() => void onInstallMindos(agent.key)}
                        disabled={busyAction !== null}
                        busy={busyAction === `install:${agent.key}`}
                        label={copy.installMindos}
                        variant="primary"
                      />
                    )}
                    {!agent.installed && (
                      <span className="text-2xs text-muted-foreground/60">or CLI Skill</span>
                    )}
                  </div>
                </div>

                {/* MCP server chips */}
                {mcpServers.length > 0 && (
                  <div className="flex flex-wrap gap-1 px-3 pb-3 ml-12">
                    {mcpServers.map((name) => (
                      <span key={name} className="inline-flex items-center gap-1.5 rounded-full bg-muted/40 border border-border/30 px-2.5 py-0.5 text-2xs text-muted-foreground hover:bg-muted/60 transition-colors duration-100">
                        <span className="w-1 h-1 rounded-full bg-[var(--amber)]" aria-hidden="true" />
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ────────── By Server View (Avatar Grid) ────────── */

function ByServerView({
  copy,
  servers,
  allAgents,
  busyAction,
  onInstallMindos,
  onReconnect,
}: {
  copy: Parameters<typeof AgentsMcpSection>[0]['copy'];
  servers: ReturnType<typeof aggregateCrossAgentMcpServers>;
  allAgents: ReturnType<typeof sortAgentsByStatus>;
  busyAction: string | null;
  onInstallMindos: (agentKey: string) => Promise<void>;
  onReconnect: (agent: ReturnType<typeof sortAgentsByStatus>[number]) => Promise<void>;
}) {
  const [pickerServer, setPickerServer] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{ agentKey: string; agentName: string; serverName: string } | null>(null);
  const [hintMessage, setHintMessage] = useState<string | null>(null);
  const [reconnectingServer, setReconnectingServer] = useState<string | null>(null);
  const [reconnectMsg, setReconnectMsg] = useState<Record<string, string>>({});

  const handleAddAgent = useCallback(
    async (agentKey: string, _serverName: string) => {
      setPickerServer(null);
      await onInstallMindos(agentKey);
    },
    [onInstallMindos],
  );

  const handleConfirmRemove = useCallback(async () => {
    if (!confirmState) return;
    const { agentKey } = confirmState;
    setConfirmState(null);

    // Find agent info to determine scope
    const agent = allAgents.find(a => a.key === agentKey);
    const scope = agent?.scope === 'project' ? 'project' : 'global';

    try {
      await apiFetch('/api/mcp/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agents: [{ key: agentKey, scope }] }),
      });
      setHintMessage(copy.removeSuccess ?? 'Removed. Restart your agent to apply.');
    } catch {
      setHintMessage(copy.removeFailed ?? 'Failed to remove. Try editing the config file manually.');
    }
    setTimeout(() => setHintMessage(null), 4000);
  }, [confirmState, allAgents, copy]);

  const handleReconnectAllInServer = useCallback(
    async (serverName: string, agents: typeof allAgents) => {
      setReconnectingServer(serverName);
      setReconnectMsg((prev) => ({ ...prev, [serverName]: copy.reconnectAllRunning }));
      let ok = 0;
      let failed = 0;
      for (const agent of agents) {
        try {
          await onReconnect(agent);
          ok++;
        } catch {
          failed++;
        }
      }
      setReconnectMsg((prev) => ({ ...prev, [serverName]: copy.reconnectAllDone(ok, failed) }));
      setReconnectingServer(null);
      setTimeout(() => setReconnectMsg((prev) => { const next = { ...prev }; delete next[serverName]; return next; }), 4000);
    },
    [copy, onReconnect],
  );

  if (servers.length === 0) {
    return <EmptyState message={copy.crossAgentServersEmpty} />;
  }

  return (
    <>
      <div className="space-y-3">
        <p className="text-2xs text-muted-foreground tabular-nums">{copy.resultCount(servers.length)}</p>
        {hintMessage && (
          <div role="status" aria-live="polite" className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground animate-in fade-in duration-200">
            {hintMessage}
          </div>
        )}
        {servers.map((srv) => {
          const agentDetails = srv.agents
            .map((name) => allAgents.find((a) => a.name === name))
            .filter(Boolean) as typeof allAgents;
          const orphanNames = srv.agents.filter((name) => !agentDetails.some((a) => a.name === name));
          const availableToAdd = allAgents.filter((a) => !srv.agents.includes(a.name));

          const connectedCount = agentDetails.filter((a) => resolveAgentStatus(a) === 'connected').length;
          const detectedCount = agentDetails.filter((a) => resolveAgentStatus(a) === 'detected').length;
          const notFoundCount = agentDetails.length - connectedCount - detectedCount + orphanNames.length;

          return (
            <div key={srv.serverName} className="rounded-xl border border-border bg-card p-4 hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-200">
              {/* Server header */}
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-[var(--amber)]/[0.08] flex items-center justify-center shrink-0">
                    <Server size={13} className="text-[var(--amber)]" aria-hidden="true" />
                  </div>
                  <span className="text-sm font-semibold text-foreground truncate">{srv.serverName}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {agentDetails.length > 0 && (
                    <ActionButton
                      onClick={() => void handleReconnectAllInServer(srv.serverName, agentDetails)}
                      disabled={reconnectingServer !== null || busyAction !== null}
                      busy={reconnectingServer === srv.serverName}
                      label={copy.reconnectAllInServer}
                      busyLabel={copy.reconnectAllRunning}
                    />
                  )}
                  <div className="relative">
                      <AddAvatarButton
                        onClick={() => setPickerServer(pickerServer === srv.serverName ? null : srv.serverName)}
                        label={copy.addAgent}
                        size="sm"
                      />
                      <AgentPickerPopover
                        open={pickerServer === srv.serverName}
                        agents={availableToAdd.map((a) => ({ key: a.key, name: a.name }))}
                        emptyLabel={copy.noAvailableAgents}
                        onSelect={(key) => void handleAddAgent(key, srv.serverName)}
                        onClose={() => setPickerServer(null)}
                      />
                    </div>
                </div>
              </div>

              {/* Agent status breakdown */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground mb-3">
                <span className="tabular-nums">{copy.serverAgentCount(srv.agents.length)}</span>
                {connectedCount > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" aria-hidden="true" />
                    {connectedCount}
                  </span>
                )}
                {detectedCount > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)]" aria-hidden="true" />
                    {detectedCount}
                  </span>
                )}
                {notFoundCount > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" aria-hidden="true" />
                    {notFoundCount}
                  </span>
                )}
              </div>

              {reconnectMsg[srv.serverName] && (
                <p role="status" className="text-2xs text-muted-foreground mb-2 animate-in fade-in duration-200">{reconnectMsg[srv.serverName]}</p>
              )}

              {/* Agent avatar grid */}
              <div className="flex flex-wrap items-center gap-2">
                {agentDetails.map((agent) => {
                  const agentStatus = resolveAgentStatus(agent);
                  return (
                    <Link key={agent.key} href={`/agents/${encodeURIComponent(agent.key)}`} className="cursor-pointer">
                      <AgentAvatar
                        name={agent.name}
                        status={agentStatus}
                        onRemove={() => setConfirmState({ agentKey: agent.key, agentName: agent.name, serverName: srv.serverName })}
                      />
                    </Link>
                  );
                })}
                {orphanNames.map((name) => (
                  <AgentAvatar key={name} name={name} status="notFound" />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirmState !== null}
        title={copy.confirmRemoveTitle}
        message={confirmState ? copy.confirmRemoveMessage(confirmState.agentName, confirmState.serverName) : ''}
        confirmLabel={copy.removeFromServer}
        cancelLabel={copy.cancel}
        onConfirm={handleConfirmRemove}
        onCancel={() => setConfirmState(null)}
        variant="destructive"
      />
    </>
  );
}
