import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, RefreshCw, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import type { McpStatus, AgentInfo } from './types';
import type { Messages } from '@/lib/i18n';

interface AgentsTabProps {
  t: Messages;
}

export function AgentsTab({ t }: AgentsTabProps) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showNotDetected, setShowNotDetected] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const a = t.settings?.agents as Record<string, unknown> | undefined;

  // i18n helpers with fallbacks
  const txt = (key: string, fallback: string) => (a?.[key] as string) ?? fallback;
  const txtFn = <T,>(key: string, fallback: (v: T) => string) =>
    (a?.[key] as ((v: T) => string) | undefined) ?? fallback;

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setError(false);
    try {
      const [statusData, agentsData] = await Promise.all([
        apiFetch<McpStatus>('/api/mcp/status'),
        apiFetch<{ agents: AgentInfo[] }>('/api/mcp/agents'),
      ]);
      setMcpStatus(statusData);
      setAgents(agentsData.agents);
      setError(false);
    } catch {
      if (!silent) setError(true);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  // Initial fetch + 30s auto-refresh
  useEffect(() => {
    fetchAll();
    intervalRef.current = setInterval(() => fetchAll(true), 30_000);
    return () => clearInterval(intervalRef.current);
  }, [fetchAll]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchAll();
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 size={18} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && agents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-sm text-destructive">{txt('fetchError', 'Failed to load agent data')}</p>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <RefreshCw size={12} />
          {txt('refresh', 'Refresh')}
        </button>
      </div>
    );
  }

  // Group agents
  const connected = agents.filter(a => a.present && a.installed);
  const detected = agents.filter(a => a.present && !a.installed);
  const notFound = agents.filter(a => !a.present);

  return (
    <div className="space-y-5">
      {/* MCP Server Status */}
      <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground">{txt('mcpServer', 'MCP Server')}</span>
          {mcpStatus?.running ? (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              <span className="text-emerald-600 dark:text-emerald-400">
                {txt('running', 'Running')} {txtFn<number>('onPort', (p) => `on :${p}`)(mcpStatus.port)}
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="w-2 h-2 rounded-full bg-zinc-400 inline-block" />
              <span className="text-muted-foreground">{txt('stopped', 'Not running')}</span>
            </span>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? txt('refreshing', 'Refreshing...') : txt('refresh', 'Refresh')}
        </button>
      </div>

      {/* Connected Agents */}
      {connected.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            {txtFn<number>('connectedCount', (n) => `Connected (${n})`)(connected.length)}
          </h3>
          <div className="space-y-2">
            {connected.map(agent => (
              <AgentCard key={agent.key} agent={agent} status="connected" />
            ))}
          </div>
        </section>
      )}

      {/* Detected but not configured */}
      {detected.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
            {txtFn<number>('detectedCount', (n) => `Detected but not configured (${n})`)(detected.length)}
          </h3>
          <div className="space-y-2">
            {detected.map(agent => (
              <AgentCard
                key={agent.key}
                agent={agent}
                status="detected"
                connectLabel={txt('connect', 'Connect')}
              />
            ))}
          </div>
        </section>
      )}

      {/* Not Detected */}
      {notFound.length > 0 && (
        <section>
          <button
            onClick={() => setShowNotDetected(!showNotDetected)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 hover:text-foreground transition-colors"
          >
            {showNotDetected ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {txtFn<number>('notDetectedCount', (n) => `Not Detected (${n})`)(notFound.length)}
          </button>
          {showNotDetected && (
            <div className="space-y-2">
              {notFound.map(agent => (
                <AgentCard key={agent.key} agent={agent} status="notFound" />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Empty state */}
      {agents.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          {txt('noAgents', 'No agents detected on this machine.')}
        </p>
      )}

      {/* Auto-refresh hint */}
      <p className="text-[10px] text-muted-foreground/60 text-center">
        {txt('autoRefresh', 'Auto-refresh every 30s')}
      </p>
    </div>
  );
}

/* ── Agent Card ──────────────────────────────────────────────── */

function AgentCard({
  agent,
  status,
  connectLabel,
}: {
  agent: AgentInfo;
  status: 'connected' | 'detected' | 'notFound';
  connectLabel?: string;
}) {
  const dot =
    status === 'connected' ? 'bg-emerald-500' :
    status === 'detected' ? 'bg-amber-500' :
    'bg-zinc-400';

  return (
    <div className="rounded-lg border border-border bg-card/50 px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        <span className="text-sm font-medium text-foreground truncate">{agent.name}</span>
        {status === 'connected' && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="px-1.5 py-0.5 rounded bg-muted">{agent.transport}</span>
            <span className="px-1.5 py-0.5 rounded bg-muted">{agent.scope}</span>
            {agent.configPath && (
              <span className="truncate max-w-[200px]" title={agent.configPath}>
                {agent.configPath.replace(/^.*[/\\]/, '')}
              </span>
            )}
          </div>
        )}
      </div>
      {status === 'detected' && (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            // Navigate to MCP tab by dispatching a custom event
            const settingsModal = document.querySelector('[role="dialog"][aria-label="Settings"]');
            if (settingsModal) {
              const mcpBtn = settingsModal.querySelectorAll('button');
              for (const btn of mcpBtn) {
                if (btn.textContent?.trim() === 'MCP') {
                  btn.click();
                  break;
                }
              }
            }
          }}
          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors shrink-0"
        >
          {connectLabel ?? 'Connect'}
          <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
}
