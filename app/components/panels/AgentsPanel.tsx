'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, RefreshCw, ChevronDown, ChevronRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import type { McpStatus, AgentInfo } from '../settings/types';
import PanelHeader from './PanelHeader';

interface AgentsPanelProps {
  active: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
}

export default function AgentsPanel({ active, maximized, onMaximize }: AgentsPanelProps) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showNotDetected, setShowNotDetected] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

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

  // Fetch when panel becomes active + 30s auto-refresh
  const prevActive = useRef(false);
  useEffect(() => {
    if (active && !prevActive.current) {
      fetchAll();
    }
    prevActive.current = active;
  }, [active, fetchAll]);

  useEffect(() => {
    if (!active) {
      clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => fetchAll(true), 30_000);
    return () => clearInterval(intervalRef.current);
  }, [active, fetchAll]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchAll();
  };

  // Group agents
  const connected = agents.filter(a => a.present && a.installed);
  const detected = agents.filter(a => a.present && !a.installed);
  const notFound = agents.filter(a => !a.present);
  const connectedCount = connected.length;

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      <PanelHeader title="Agents" maximized={maximized} onMaximize={onMaximize}>
        <div className="flex items-center gap-1.5">
          {!loading && (
            <span className="text-2xs text-muted-foreground">{connectedCount} connected</span>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
            aria-label="Refresh"
            title="Refresh agent status"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </PanelHeader>

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={16} className="animate-spin text-muted-foreground" />
          </div>
        ) : error && agents.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center px-4">
            <p className="text-xs text-destructive">Failed to load agents</p>
            <button
              onClick={handleRefresh}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <RefreshCw size={11} /> Retry
            </button>
          </div>
        ) : (
          <div className="px-3 py-3 space-y-4">
            {/* MCP Server Status — compact */}
            <div className="rounded-lg border border-border bg-card/50 px-3 py-2.5 flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">MCP Server</span>
              {mcpStatus?.running ? (
                <span className="flex items-center gap-1.5 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                  <span className="text-emerald-600 dark:text-emerald-400">:{mcpStatus.port}</span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 inline-block" />
                  <span className="text-muted-foreground">Stopped</span>
                </span>
              )}
            </div>

            {/* Connected */}
            {connected.length > 0 && (
              <section>
                <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Connected ({connected.length})
                </h3>
                <div className="space-y-1.5">
                  {connected.map(agent => (
                    <AgentCard key={agent.key} agent={agent} status="connected" />
                  ))}
                </div>
              </section>
            )}

            {/* Detected but not configured */}
            {detected.length > 0 && (
              <section>
                <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Detected ({detected.length})
                </h3>
                <div className="space-y-1.5">
                  {detected.map(agent => (
                    <AgentCard
                      key={agent.key}
                      agent={agent}
                      status="detected"
                      onInstalled={() => fetchAll()}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Not Detected — collapsible */}
            {notFound.length > 0 && (
              <section>
                <button
                  onClick={() => setShowNotDetected(!showNotDetected)}
                  className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2 hover:text-foreground transition-colors"
                >
                  {showNotDetected ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  Not Detected ({notFound.length})
                </button>
                {showNotDetected && (
                  <div className="space-y-1.5">
                    {notFound.map(agent => (
                      <AgentCard key={agent.key} agent={agent} status="notFound" />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Empty state */}
            {agents.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No agents detected.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border shrink-0">
        <p className="text-2xs text-muted-foreground/60">Auto-refresh every 30s</p>
      </div>
    </div>
  );
}

/* ── Agent Card (panel-compact variant) ── */

function AgentCard({
  agent,
  status,
  onInstalled,
}: {
  agent: AgentInfo;
  status: 'connected' | 'detected' | 'notFound';
  onInstalled?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const dot =
    status === 'connected' ? 'bg-emerald-500' :
    status === 'detected' ? 'bg-amber-500' :
    'bg-zinc-400';

  const handleInstall = async () => {
    setInstalling(true);
    setResult(null);
    try {
      const res = await apiFetch<{ results: Array<{ key: string; ok: boolean; error?: string }> }>('/api/mcp/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agents: [{ key: agent.key, scope: agent.hasProjectScope ? 'project' : 'global', transport: agent.preferredTransport }],
          transport: 'auto',
        }),
      });
      const r = res.results?.[0];
      if (r?.ok) {
        setResult({ type: 'success', text: `${agent.name} connected` });
        setTimeout(() => onInstalled?.(), 1500);
      } else {
        setResult({ type: 'error', text: r?.error ?? 'Install failed' });
      }
    } catch {
      setResult({ type: 'error', text: 'Network error' });
    }
    setInstalling(false);
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/30 overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
          <span className="text-xs font-medium text-foreground truncate">{agent.name}</span>
          {status === 'connected' && agent.transport && (
            <span className="text-2xs px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{agent.transport}</span>
          )}
        </div>
        {status === 'detected' && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 px-2 py-0.5 text-2xs rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors shrink-0"
          >
            Connect
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        )}
      </div>

      {/* Inline connect panel */}
      {status === 'detected' && expanded && (
        <div className="px-3 pb-2.5 pt-1 border-t border-border/40 space-y-2">
          <div className="flex items-center justify-between text-2xs text-muted-foreground">
            <span>Transport: <span className="font-medium text-foreground">{agent.preferredTransport}</span></span>
            <span>Scope: <span className="font-medium text-foreground">{agent.hasProjectScope ? 'project' : 'global'}</span></span>
          </div>
          <button
            onClick={handleInstall}
            disabled={installing}
            className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-2xs rounded-md font-medium text-white disabled:opacity-50 transition-colors"
            style={{ background: 'var(--amber)' }}
          >
            {installing ? <Loader2 size={11} className="animate-spin" /> : null}
            {installing ? 'Installing...' : `Install ${agent.name}`}
          </button>
          {result && (
            <div className={`flex items-center gap-1.5 text-2xs ${result.type === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
              {result.type === 'success' ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
              {result.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
