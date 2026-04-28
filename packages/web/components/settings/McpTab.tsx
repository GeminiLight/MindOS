import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Loader2, Copy, Check, Monitor, Globe, AlertCircle, RotateCcw, RefreshCw, Eye, EyeOff, ChevronDown, ChevronRight, Link2, Shield, Terminal, Plug, CheckCircle2, Sparkles, Users } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useMcpDataOptional } from '@/lib/stores/mcp-store';
import { generateSnippet } from '@/lib/mcp-snippets';
import { copyToClipboard } from '@/lib/clipboard';
import { apiFetch } from '@/lib/api';
import CustomSelect from '@/components/CustomSelect';
import type { SelectItem } from '@/components/CustomSelect';
import type { McpTabProps, McpStatus, AgentInfo, ConnectionMode } from './types';
import AgentInstall from './McpAgentInstall';
import SkillsSection from './McpSkillsSection';
import McpExternalTools from './McpExternalTools';

/* ── Main Connections Tab ────────────────────────────────────────── */

export function McpTab({ t }: McpTabProps) {
  const mcp = useMcpDataOptional();
  const m = t.settings?.mcp;

  const [mode, setMode] = useState<'cli' | 'mcp'>('cli');
  const [restarting, setRestarting] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [savingMode, setSavingMode] = useState(false);
  const restartPollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Derive mcpEnabled from server state
  const serverConnectionMode = mcp?.status?.connectionMode;
  const mcpEnabled = serverConnectionMode?.mcp ?? false;

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
  const effectiveSelected = selectedAgent || (mcp.agents[0]?.key ?? '');
  const currentAgent = mcp.agents.find(a => a.key === effectiveSelected);

  // Determine active skill name based on which mindos skill is enabled
  const mindosEnabled = mcp.skills?.find(s => s.name === 'mindos')?.enabled ?? true;
  const activeSkillName = mindosEnabled ? 'mindos' : 'mindos-zh';

  const handleToggleMcp = async (enabled: boolean) => {
    setSavingMode(true);
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionMode: { cli: true, mcp: enabled },
        }),
      });
      await mcp.refresh();
      // Switch view to MCP tab when enabling
      if (enabled) setMode('mcp');
    } catch {
      toast.error('Failed to toggle connection mode');
    } finally {
      setSavingMode(false);
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await apiFetch('/api/mcp/restart', { method: 'POST' });
    } catch (err) {
      console.error('[McpTab] Restart request failed:', err);
      setRestarting(false);
      return;
    }
    const deadline = Date.now() + 60_000;
    clearInterval(restartPollRef.current);
    restartPollRef.current = setInterval(async () => {
      if (Date.now() > deadline) {
        clearInterval(restartPollRef.current);
        setRestarting(false);
        return;
      }
      try {
        const s = await apiFetch<McpStatus>('/api/mcp/status', { timeout: 3000 });
        if (s.running) {
          clearInterval(restartPollRef.current);
          setRestarting(false);
          mcp.refresh();
        }
      } catch { /* continue polling */ }
    }, 3000);
  };

  return (
    <div className="space-y-6">
      {/* 1. Connection Mode Toggle */}
      <ConnectionModeCard
        mcpEnabled={mcpEnabled}
        onToggle={handleToggleMcp}
        saving={savingMode}
        mcpRunning={mcp.status?.running ?? false}
        m={m}
      />

      {/* 2. Auth Token */}
      <AuthTokenCard status={mcp.status} m={m} />

      {/* 3. Connect Agents (CLI/MCP guides + detected agents + MCP port) */}
      <ConnectCard
        mode={mode}
        onModeChange={setMode}
        status={mcp.status}
        agents={mcp.agents}
        connectedAgents={connectedAgents}
        detectedAgents={detectedAgents}
        notFoundAgents={notFoundAgents}
        currentAgent={currentAgent ?? null}
        selectedAgent={effectiveSelected}
        onSelectAgent={setSelectedAgent}
        restarting={restarting}
        onRestart={handleRestart}
        onRefresh={mcp.refresh}
        activeSkillName={activeSkillName}
        mcpEnabled={mcpEnabled}
        m={m}
        t={t}
      />

      {/* 4. External MCP Tools */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
          <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Plug size={14} className="text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{m?.externalToolsTitle ?? 'External MCP Tools'}</h3>
            <p className="text-2xs text-muted-foreground">{m?.externalToolsDesc ?? 'Configure tool access mode for external MCP servers.'}</p>
          </div>
        </div>
        <div className="px-4 pb-4">
          <McpExternalTools />
        </div>
      </div>

      {/* 5. Skills */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
          <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Sparkles size={14} className="text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{m?.skillsTitle ?? 'Skills'}</h3>
            <p className="text-2xs text-muted-foreground">{m?.skillsDesc ?? 'Teach agents how to operate your knowledge base.'}</p>
          </div>
        </div>
        <div className="px-4 pb-4">
          <SkillsSection t={t} />
        </div>
      </div>
    </div>
  );
}

/* ── Connection Mode Card ── */

function ConnectionModeCard({ mcpEnabled, onToggle, saving, mcpRunning, m }: {
  mcpEnabled: boolean;
  onToggle: (enabled: boolean) => void;
  saving: boolean;
  mcpRunning: boolean;
  m: Record<string, any> | undefined;
}) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <div className="w-7 h-7 rounded-lg bg-[var(--amber-subtle)] flex items-center justify-center shrink-0">
          <Plug size={14} className="text-[var(--amber)]" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{m?.modeCardTitle ?? 'Connection Mode'}</h3>
          <p className="text-2xs text-muted-foreground">{m?.modeCardDesc ?? 'Choose how agents connect to MindOS.'}</p>
        </div>
      </div>
      <div className="px-4 pb-4 space-y-2">
        {/* CLI - always on */}
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-muted/30 border border-border/50">
          <input type="checkbox" checked disabled className="w-3.5 h-3.5 rounded accent-[var(--amber)]" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <Terminal size={12} className="text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground">CLI</span>
              <span className="text-2xs px-1.5 py-0.5 rounded-full bg-success/10 text-success font-medium leading-none">
                {m?.alwaysOn ?? 'Always On'}
              </span>
            </div>
            <p className="text-2xs text-muted-foreground mt-0.5">{m?.cliModeDesc ?? 'Claude Code, Gemini CLI, Codex, etc.'}</p>
          </div>
        </div>

        {/* MCP - toggleable */}
        <label className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
          mcpEnabled
            ? 'border-[var(--amber)]/40 bg-[var(--amber)]/[0.03]'
            : 'border-border/50 bg-muted/30 hover:bg-muted/50'
        }`}>
          <input
            type="checkbox"
            checked={mcpEnabled}
            disabled={saving}
            onChange={(e) => onToggle(e.target.checked)}
            className="w-3.5 h-3.5 rounded accent-[var(--amber)] cursor-pointer"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <Plug size={12} className={mcpEnabled ? 'text-[var(--amber)]' : 'text-muted-foreground'} />
              <span className="text-xs font-semibold text-foreground">MCP</span>
              {mcpEnabled && (
                <span className={`text-2xs px-1.5 py-0.5 rounded-full font-medium leading-none ${
                  mcpRunning ? 'bg-success/10 text-success' : 'bg-[var(--amber-subtle)] text-[var(--amber-text)]'
                }`}>
                  {mcpRunning ? (m?.mcpRunning ?? 'Running') : (m?.mcpStopped ?? 'Stopped')}
                </span>
              )}
            </div>
            <p className="text-2xs text-muted-foreground mt-0.5">{m?.mcpModeDesc ?? 'Claude Desktop, Cursor, Windsurf, etc.'}</p>
          </div>
          {saving && <Loader2 size={14} className="animate-spin text-[var(--amber)] shrink-0" />}
        </label>

        {/* Hint text */}
        <p className="text-2xs text-muted-foreground px-1 leading-relaxed">
          {mcpEnabled
            ? (m?.mcpEnabledHint ?? 'MCP mode enabled. Disable to simplify the interface if you only use CLI agents.')
            : (m?.mcpDisabledHint ?? 'Enable MCP to connect Desktop clients like Claude Desktop or Cursor.')}
        </p>
      </div>
    </div>
  );
}

/* ── Auth Token Card ── */

function AuthTokenCard({ status, m }: {
  status: McpStatus | null;
  m: Record<string, any> | undefined;
}) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => () => setRevealed(false), []);
  useEffect(() => {
    if (!copiedField) return;
    const t = setTimeout(() => setCopiedField(null), 2000);
    return () => clearTimeout(t);
  }, [copiedField]);

  const handleCopy = useCallback(async (text: string, field: string) => {
    if (!text) return;
    const ok = await copyToClipboard(text);
    if (ok) { setCopiedField(field); toast.copy(); }
  }, []);

  if (!status) return null;

  const hasToken = status.authConfigured && !!status.authToken;
  const displayToken = revealed ? (status.authToken ?? '') : (status.maskedToken ?? '');

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Shield size={14} className="text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{m?.tokenCardTitle ?? 'Auth Token'}</h3>
          <p className="text-2xs text-muted-foreground">{m?.tokenCardDesc ?? 'Used by CLI remote mode and MCP connections.'}</p>
        </div>
      </div>
      <div className="px-4 pb-4">
        {hasToken ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 bg-muted/50 border border-border rounded-lg min-h-[34px]">
              <code className="flex-1 text-xs font-mono text-foreground break-all select-all leading-relaxed">{displayToken}</code>
            </div>
            <button type="button" onClick={() => setRevealed(v => !v)}
              className="shrink-0 p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:ring-2 focus-visible:ring-ring"
              title={revealed ? (m?.tokenHide ?? 'Hide') : (m?.tokenShow ?? 'Show')}>
              {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
            <CopyButton onCopy={() => handleCopy(status.authToken ?? '', 'token-card')} copied={copiedField === 'token-card'} title={m?.tokenCopy ?? 'Copy'} size="sm" />
          </div>
        ) : (
          <div className="px-2.5 py-2 bg-[var(--amber-subtle)] border border-[var(--amber)]/20 rounded-lg">
            <p className="text-xs text-[var(--amber-text)]">{m?.tokenNone ?? 'No token set.'}</p>
            <p className="text-2xs text-muted-foreground mt-0.5">{m?.tokenNoneAction ?? 'Generate one in Settings → General → Security.'}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Shared copy-state hook for guide sub-components ── */
import ConnectCard, { CopyButton, useCopyField } from './McpConnectGuides';

