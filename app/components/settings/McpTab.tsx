import { useState, useMemo, useRef, useEffect } from 'react';
import { Loader2, Copy, Monitor, Globe, AlertCircle, RotateCcw, RefreshCw } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useMcpDataOptional } from '@/hooks/useMcpData';
import { generateSnippet } from '@/lib/mcp-snippets';
import { copyToClipboard } from '@/lib/clipboard';
import { apiFetch } from '@/lib/api';
import CustomSelect from '@/components/CustomSelect';
import type { SelectItem } from '@/components/CustomSelect';
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
          try {
            await apiFetch('/api/mcp/restart', { method: 'POST' });
          } catch (err) {
            console.error('[McpTab] Restart request failed:', err);
            setRestarting(false);
            return; // Exit early, don't start polling if restart request fails
          }
          const deadline = Date.now() + 60_000;
          clearInterval(restartPollRef.current);
          restartPollRef.current = setInterval(async () => {
            if (Date.now() > deadline) {
              clearInterval(restartPollRef.current);
              setRestarting(false);
              console.warn('[McpTab] MCP restart timed out after 60s');
              return;
            }
            try {
              const s = await apiFetch<McpStatus>('/api/mcp/status', { timeout: 3000 });
              if (s.running) {
                clearInterval(restartPollRef.current);
                setRestarting(false);
                mcp.refresh();
              }
            } catch (err) {
              console.warn('[McpTab] Status poll attempt failed:', err);
              // Continue polling on individual failures
            }
          }, 3000);
        }}
        onRefresh={mcp.refresh}
        m={m}
      />

      {/* MCP Config Viewer */}
      {mcp.agents.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">MCP</p>
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
            onCopy={async (snippet) => {
              const ok = await copyToClipboard(snippet);
              if (ok) toast.copy();
            }}
            m={m}
          />
        </div>
      )}

      {/* Skills */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">{m?.skillsTitle ?? 'Skills'}</p>
        <SkillsSection t={t} />
      </div>

      {/* Batch Agent Install */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">{m?.agentsTitle ?? 'Agent Configuration'}</p>
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
            <Loader2 size={12} className="animate-spin text-[var(--amber)]" />
            <span className="text-[var(--amber)]">{m?.restarting ?? 'Restarting...'}</span>
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
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg font-medium text-[var(--amber-foreground)] bg-[var(--amber)] transition-colors">
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

function AgentConfigViewer({ connectedAgents, detectedAgents, notFoundAgents, currentAgent, mcpStatus, selectedAgent, onSelectAgent, transport, onTransportChange, onCopy, m }: {
  connectedAgents: AgentInfo[];
  detectedAgents: AgentInfo[];
  notFoundAgents: AgentInfo[];
  currentAgent: AgentInfo | null;
  mcpStatus: McpStatus | null;
  selectedAgent: string;
  onSelectAgent: (key: string) => void;
  transport: 'stdio' | 'http';
  onTransportChange: (t: 'stdio' | 'http') => void;
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
      <CustomSelect
        value={selectedAgent}
        onChange={onSelectAgent}
        options={[
          ...(connectedAgents.length > 0 ? [{
            label: m?.connectedGroup ?? 'Connected',
            options: connectedAgents.map(a => ({
              value: a.key,
              label: `${a.name} — ${a.transport ?? 'stdio'} · ${a.scope ?? 'global'}`,
            })),
          }] : []),
          ...(detectedAgents.length > 0 ? [{
            label: m?.detectedGroup ?? 'Detected (not configured)',
            options: detectedAgents.map(a => ({
              value: a.key,
              label: `${a.name} — ${m?.notConfigured ?? 'not configured'}`,
            })),
          }] : []),
          ...(notFoundAgents.length > 0 ? [{
            label: m?.notFoundGroup ?? 'Not Installed',
            options: notFoundAgents.map(a => ({
              value: a.key,
              label: a.name,
            })),
          }] : []),
        ] as SelectItem[]}
      />

      {currentAgent && (
        <>
          {/* Agent status badge */}
          <div className="flex items-center gap-2">
            {currentAgent.present && currentAgent.installed ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium bg-success/10 text-success">
                <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
                {m?.tagConnected ?? 'Connected'}
              </span>
            ) : currentAgent.present && !currentAgent.installed ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium bg-[var(--amber-subtle)] text-[var(--amber-text)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] inline-block" />
                {m?.tagDetected ?? 'Detected — not configured'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium bg-muted text-muted-foreground">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground inline-block" />
                {m?.tagNotInstalled ?? 'Not installed'}
              </span>
            )}
            {currentAgent.transport && (
              <span className="px-1.5 py-0.5 rounded text-2xs bg-muted text-muted-foreground">{currentAgent.transport}</span>
            )}
            {currentAgent.scope && (
              <span className="px-1.5 py-0.5 rounded text-2xs bg-muted text-muted-foreground">{currentAgent.scope}</span>
            )}
          </div>

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
            <p className="flex items-center gap-1.5 text-xs text-[var(--amber-text)]">
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
                  <Copy size={12} />
                  {m?.copyConfig ?? 'Copy config'}
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
