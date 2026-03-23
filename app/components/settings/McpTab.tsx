import { useState, useMemo, useRef, useEffect } from 'react';
import { Loader2, ChevronDown, Copy, Check, Monitor, Globe, AlertCircle, RotateCcw, RefreshCw } from 'lucide-react';
import { useMcpDataOptional } from '@/hooks/useMcpData';
import { generateSnippet } from '@/lib/mcp-snippets';
import { copyToClipboard } from '@/lib/clipboard';
import { apiFetch } from '@/lib/api';
import type { McpTabProps, McpStatus, AgentInfo } from './types';
import AgentInstall from './McpAgentInstall';
import SkillsSection from './McpSkillsSection';

// Re-export types for backward compatibility
export type { McpStatus, AgentInfo, SkillInfo, McpTabProps } from './types';

/* ── Main McpTab ───────────────────────────────────────────────── */

export function McpTab({ t }: McpTabProps) {
  const mcp = useMcpDataOptional();
  const m = t.settings?.mcp;

  const [restarting, setRestarting] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio');
  const [copied, setCopied] = useState(false);
  const restartPollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Cleanup restart poll on unmount
  useEffect(() => () => clearInterval(restartPollRef.current), []);

  if (!mcp || mcp.loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 size={18} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const connectedAgents = mcp.agents.filter(a => a.present && a.installed);
  const detectedAgents = mcp.agents.filter(a => a.present && !a.installed);
  const notFoundAgents = mcp.agents.filter(a => !a.present);

  // Auto-select first agent if none selected
  const effectiveSelected = selectedAgent || (mcp.agents[0]?.key ?? '');
  const currentAgent = mcp.agents.find(a => a.key === effectiveSelected);

  return (
    <div className="space-y-6">
      {/* Server status with restart */}
      <McpStatusCard
        status={mcp.status}
        restarting={restarting}
        onRestart={async () => {
          setRestarting(true);
          try { await apiFetch('/api/mcp/restart', { method: 'POST' }); } catch {}
          const deadline = Date.now() + 60_000;
          clearInterval(restartPollRef.current);
          restartPollRef.current = setInterval(async () => {
            if (Date.now() > deadline) { clearInterval(restartPollRef.current); setRestarting(false); return; }
            try {
              const s = await apiFetch<McpStatus>('/api/mcp/status', { timeout: 3000 });
              if (s.running) { clearInterval(restartPollRef.current); setRestarting(false); mcp.refresh(); }
            } catch {}
          }, 3000);
        }}
        onRefresh={mcp.refresh}
        m={m}
      />

      {/* MCP Config Viewer */}
      {mcp.agents.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-foreground mb-3">MCP</h3>
          <AgentConfigViewer
            connectedAgents={connectedAgents}
            detectedAgents={detectedAgents}
            notFoundAgents={notFoundAgents}
            currentAgent={currentAgent ?? null}
            mcpStatus={mcp.status}
            selectedAgent={effectiveSelected}
            onSelectAgent={(key) => setSelectedAgent(key)}
            transport={transport}
            onTransportChange={setTransport}
            copied={copied}
            onCopy={async (snippet) => {
              const ok = await copyToClipboard(snippet);
              if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
            }}
            m={m}
          />
        </div>
      )}

      {/* Skills */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">{m?.skillsTitle ?? 'Skills'}</h3>
        <SkillsSection t={t} />
      </div>

      {/* Batch Agent Install */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">{m?.agentsTitle ?? 'Agent Configuration'}</h3>
        <AgentInstall agents={mcp.agents} t={t} onRefresh={mcp.refresh} />
      </div>
    </div>
  );
}

/* ── MCP Status Card ── */

function McpStatusCard({ status, restarting, onRestart, onRefresh, m }: {
  status: McpStatus | null;
  restarting: boolean;
  onRestart: () => void;
  onRefresh: () => void;
  m: Record<string, any> | undefined;
}) {
  if (!status) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between">
      <div className="flex items-center gap-2.5 text-xs">
        {restarting ? (
          <>
            <Loader2 size={12} className="animate-spin" style={{ color: 'var(--amber)' }} />
            <span style={{ color: 'var(--amber)' }}>{m?.restarting ?? 'Restarting...'}</span>
          </>
        ) : (
          <>
            <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${status.running ? 'bg-success' : 'bg-muted-foreground'}`} />
            <span className="text-foreground font-medium">
              {status.running ? (m?.running ?? 'Running') : (m?.stopped ?? 'Stopped')}
            </span>
            {status.running && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="font-mono text-muted-foreground">{status.endpoint}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{status.toolCount} tools</span>
              </>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        {!status.running && !restarting && (
          <button onClick={onRestart}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg font-medium text-white transition-colors"
            style={{ background: 'var(--amber)' }}>
            <RotateCcw size={12} /> {m?.restart ?? 'Restart'}
          </button>
        )}
        <button onClick={onRefresh}
          className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <RefreshCw size={12} />
        </button>
      </div>
    </div>
  );
}

/* ── Agent Config Viewer (dropdown + snippet) ── */

function AgentConfigViewer({ connectedAgents, detectedAgents, notFoundAgents, currentAgent, mcpStatus, selectedAgent, onSelectAgent, transport, onTransportChange, copied, onCopy, m }: {
  connectedAgents: AgentInfo[];
  detectedAgents: AgentInfo[];
  notFoundAgents: AgentInfo[];
  currentAgent: AgentInfo | null;
  mcpStatus: McpStatus | null;
  selectedAgent: string;
  onSelectAgent: (key: string) => void;
  transport: 'stdio' | 'http';
  onTransportChange: (t: 'stdio' | 'http') => void;
  copied: boolean;
  onCopy: (snippet: string) => void;
  m: Record<string, any> | undefined;
}) {
  const snippet = useMemo(
    () => currentAgent ? generateSnippet(currentAgent, mcpStatus, transport) : null,
    [currentAgent, mcpStatus, transport]
  );

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      {/* Agent selector */}
      <div className="relative">
        <select
          value={selectedAgent}
          onChange={(e) => onSelectAgent(e.target.value)}
          className="w-full appearance-none px-3 py-2 pr-8 text-xs rounded-lg border border-border bg-background text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {connectedAgents.length > 0 && (
            <optgroup label={m?.connectedGroup ?? 'Connected'}>
              {connectedAgents.map(a => (
                <option key={a.key} value={a.key}>
                  ✓ {a.name} — {a.transport ?? 'stdio'} · {a.scope ?? 'global'}
                </option>
              ))}
            </optgroup>
          )}
          {detectedAgents.length > 0 && (
            <optgroup label={m?.detectedGroup ?? 'Detected (not configured)'}>
              {detectedAgents.map(a => (
                <option key={a.key} value={a.key}>
                  ○ {a.name} — {m?.notConfigured ?? 'not configured'}
                </option>
              ))}
            </optgroup>
          )}
          {notFoundAgents.length > 0 && (
            <optgroup label={m?.notFoundGroup ?? 'Not Installed'}>
              {notFoundAgents.map(a => (
                <option key={a.key} value={a.key}>
                  · {a.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      </div>

      {currentAgent && (
        <>
          {/* Transport toggle */}
          <div className="flex items-center rounded-lg border border-border overflow-hidden w-fit">
            <button
              onClick={() => onTransportChange('stdio')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                transport === 'stdio' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Monitor size={12} /> {m?.transportLocal ?? 'Local (stdio)'}
            </button>
            <button
              onClick={() => onTransportChange('http')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                transport === 'http' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Globe size={12} /> {m?.transportRemote ?? 'Remote (HTTP)'}
            </button>
          </div>

          {/* Auth warning */}
          {transport === 'http' && mcpStatus && !mcpStatus.authConfigured && (
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--amber)' }}>
              <AlertCircle size={12} />
              {m?.noAuthWarning ?? 'Auth not configured. Run `mindos token` to set up.'}
            </p>
          )}

          {/* Snippet */}
          {snippet && (
            <>
              <pre className="text-[11px] font-mono bg-muted/50 border border-border rounded-lg p-3 overflow-x-auto whitespace-pre select-all max-h-[240px] overflow-y-auto">
                {snippet.displaySnippet}
              </pre>
              <div className="flex items-center gap-3 text-xs">
                <button onClick={() => onCopy(snippet.snippet)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0">
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? (m?.copied ?? 'Copied!') : (m?.copyConfig ?? 'Copy config')}
                </button>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono text-muted-foreground truncate text-2xs">{snippet.path}</span>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
