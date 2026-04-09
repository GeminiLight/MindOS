'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { AlertCircle, Check, CheckCircle2, ChevronDown, ChevronRight, Code2, Copy, Globe, Link2, Loader2, Monitor, Plug, RefreshCw, RotateCcw, Terminal, Users, Wifi, WifiOff } from 'lucide-react';
import type { McpStatus, AgentInfo, McpTabProps, ConnectionMode } from './types';
import type { Messages } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { useMcpData } from '@/lib/stores/mcp-store';
import { generateSnippet } from '@/lib/mcp-snippets';
import { copyToClipboard } from '@/lib/clipboard';
import CustomSelect from '@/components/CustomSelect';
import type { SelectItem } from '@/components/CustomSelect';
import AgentInstall from './McpAgentInstall';

export function useCopyField() {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  useEffect(() => {
    if (!copiedField) return;
    const timer = setTimeout(() => setCopiedField(null), 2000);
    return () => clearTimeout(timer);
  }, [copiedField]);
  const handleCopy = useCallback(async (text: string, field: string) => {
    if (!text) return;
    const ok = await copyToClipboard(text);
    if (ok) { setCopiedField(field); toast.copy(); }
  }, []);
  return { copiedField, handleCopy };
}

/* ── Connect Card — header + CLI/MCP tabs + detected agents ── */

export default function ConnectCard({ mode, onModeChange, status, agents, connectedAgents, detectedAgents, notFoundAgents, currentAgent, selectedAgent, onSelectAgent, restarting, onRestart, onRefresh, activeSkillName, mcpEnabled, m, t }: {
  mode: 'cli' | 'mcp';
  onModeChange: (m: 'cli' | 'mcp') => void;
  status: McpStatus | null;
  agents: AgentInfo[];
  connectedAgents: AgentInfo[];
  detectedAgents: AgentInfo[];
  notFoundAgents: AgentInfo[];
  currentAgent: AgentInfo | null;
  selectedAgent: string;
  onSelectAgent: (key: string) => void;
  restarting: boolean;
  onRestart: () => void;
  onRefresh: () => void;
  activeSkillName: string;
  mcpEnabled: boolean;
  m: Record<string, any> | undefined;
  t: McpTabProps['t'];
}) {
  if (!status) return null;

  // If MCP is disabled, force CLI view
  const effectiveMode = mcpEnabled ? mode : 'cli';

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <div className="w-7 h-7 rounded-lg bg-[var(--amber-subtle)] flex items-center justify-center shrink-0">
          <Link2 size={14} className="text-[var(--amber)]" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">{m?.connectionTitle ?? 'Connect Agents'}</h3>
      </div>

      {/* Tab switcher — only show both tabs when MCP is enabled */}
      {mcpEnabled ? (
        <div className="grid grid-cols-2 mx-4 mb-3 rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => onModeChange('cli')}
            className={`flex flex-col items-start px-3 py-2.5 text-left transition-colors ${
              effectiveMode === 'cli' ? 'bg-muted' : 'hover:bg-muted/50'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Terminal size={12} className={effectiveMode === 'cli' ? 'text-[var(--amber)]' : 'text-muted-foreground'} />
              <span className={`text-xs font-semibold ${effectiveMode === 'cli' ? 'text-foreground' : 'text-muted-foreground'}`}>CLI</span>
              <span className="text-2xs px-1 py-0.5 rounded bg-[var(--amber-subtle)] text-[var(--amber-text)] font-medium leading-none">{m?.recommended ?? 'Recommended'}</span>
            </span>
            <span className="text-2xs text-muted-foreground mt-0.5">{m?.cliAgents ?? 'Claude Code · Gemini CLI · Codex'}</span>
          </button>
          <button
            onClick={() => onModeChange('mcp')}
            className={`flex flex-col items-start px-3 py-2.5 text-left transition-colors border-l border-border ${
              effectiveMode === 'mcp' ? 'bg-muted' : 'hover:bg-muted/50'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Plug size={12} className={effectiveMode === 'mcp' ? 'text-foreground' : 'text-muted-foreground'} />
              <span className={`text-xs font-semibold ${effectiveMode === 'mcp' ? 'text-foreground' : 'text-muted-foreground'}`}>MCP</span>
            </span>
            <span className="text-2xs text-muted-foreground mt-0.5">{m?.mcpAgents ?? 'Claude Desktop · Cursor'}</span>
          </button>
        </div>
      ) : (
        <div className="mx-4 mb-3 px-3 py-2 rounded-lg border border-border bg-muted/30">
          <span className="flex items-center gap-1.5">
            <Terminal size={12} className="text-[var(--amber)]" />
            <span className="text-xs font-semibold text-foreground">CLI</span>
            <span className="text-2xs px-1 py-0.5 rounded bg-[var(--amber-subtle)] text-[var(--amber-text)] font-medium leading-none">{m?.recommended ?? 'Recommended'}</span>
          </span>
        </div>
      )}

      {/* Tab content */}
      <div className="px-4 pb-4 space-y-4">
        {effectiveMode === 'cli' ? (
          <CliGuide status={status} activeSkillName={activeSkillName} agents={agents} connectedAgents={connectedAgents} detectedAgents={detectedAgents} notFoundAgents={notFoundAgents} onRefresh={onRefresh} m={m} t={t} />
        ) : (
          <McpGuide
            status={status} agents={agents} activeSkillName={activeSkillName}
            connectedAgents={connectedAgents} detectedAgents={detectedAgents} notFoundAgents={notFoundAgents}
            currentAgent={currentAgent} selectedAgent={selectedAgent} onSelectAgent={onSelectAgent}
            restarting={restarting} onRestart={onRestart} onRefresh={onRefresh} m={m} t={t}
          />
        )}
      </div>
    </div>
  );
}

/* ── CLI Guide (local + remote setup) ── */

function CliGuide({ status, activeSkillName, agents, connectedAgents, detectedAgents, notFoundAgents, onRefresh, m, t }: {
  status: McpStatus; activeSkillName: string; agents: AgentInfo[]; connectedAgents: AgentInfo[]; detectedAgents: AgentInfo[]; notFoundAgents: AgentInfo[];
  onRefresh: () => void; m: Record<string, any> | undefined; t: McpTabProps['t'];
}) {
  const { copiedField, handleCopy } = useCopyField();

  const hasToken = status.authConfigured && !!status.authToken;
  const remoteHost = status.localIP || 'localhost';
  const webPort = typeof window !== 'undefined' ? window.location.port || '3456' : '3456';
  const remoteUrl = `http://${remoteHost}:${webPort}`;
  const maskedAuthToken = status.maskedToken ?? '';

  return (
    <>
      {/* Local */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <Monitor size={12} className="text-success" />
          <span className="text-xs font-semibold text-foreground">{m?.localTitle ?? 'Local'}</span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-2xs font-medium bg-success/10 text-success">
            <CheckCircle2 size={10} />
            {m?.localReady ?? 'Ready to use'}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {m?.cliLocalDesc ?? 'MindOS Skill is built-in. Install the CLI and you\'re good to go.'}
        </p>
        <CodeBlock code="mindos file list" label={m?.cliSkillVerify ?? 'Verify'} onCopy={handleCopy} copiedField={copiedField} fieldId="cli-verify" />

        {/* Detected Agents — install Skill locally */}
        {agents.length > 0 && (
          <InlineCollapsible
            icon={<Users size={12} className="text-muted-foreground" />}
            title={m?.detectedAgentsTitle ?? 'Detected Agents'}
            badge={`${connectedAgents.length + detectedAgents.length}/${agents.length}`}
          >
            <AgentInstall agents={agents} t={t} onRefresh={onRefresh} mode="cli" activeSkillName={activeSkillName} />
          </InlineCollapsible>
        )}
      </div>

      {/* Remote */}
      <div className="border-t border-border pt-3 space-y-3">
        <div className="flex items-center gap-2">
          <Globe size={12} className="text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">{m?.remoteTitle ?? 'Remote Access'}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {m?.cliRemoteDesc ?? 'Install the CLI on another machine and connect to this MindOS server.'}
        </p>
        <StepBlock step="1" label={m?.cliSkillInstall ?? 'Install'}>
          <CodeBlock code="npm install -g @geminilight/mindos" onCopy={handleCopy} copiedField={copiedField} fieldId="cli-install" compact />
        </StepBlock>
        <StepBlock step="2" label={m?.cliRemoteConfigure ?? 'Configure'}>
          <div className="space-y-1">
            <CodeBlock code={`mindos config set url ${remoteUrl}`} onCopy={handleCopy} copiedField={copiedField} fieldId="cli-url" compact />
            <CodeBlock
              code={`mindos config set authToken ${hasToken ? maskedAuthToken : '<token>'}`}
              onCopy={(_, field) => {
                handleCopy(`mindos config set authToken ${status.authToken ?? '<token>'}`, field);
              }}
              copiedField={copiedField} fieldId="cli-token" compact
              hint={hasToken ? (m?.tokenCopyFullHint ?? 'Copies full token') : undefined}
            />
          </div>
        </StepBlock>
        <StepBlock step="3" label={m?.cliInstallSkill ?? 'Install Skill'}>
          <CodeBlock code={`npx skills add GeminiLight/MindOS --skill ${activeSkillName} -g -y`} onCopy={handleCopy} copiedField={copiedField} fieldId="cli-skill" compact />
        </StepBlock>
        <StepBlock step="4" label={m?.cliSkillVerify ?? 'Verify'}>
          <CodeBlock code="mindos file list" onCopy={handleCopy} copiedField={copiedField} fieldId="cli-remote-verify" compact />
        </StepBlock>
      </div>
    </>
  );
}

/* ── MCP Guide (status + snippets + remote) ── */

function McpGuide({ status, agents, activeSkillName, connectedAgents, detectedAgents, notFoundAgents, currentAgent, selectedAgent, onSelectAgent, restarting, onRestart, onRefresh, m, t }: {
  status: McpStatus;
  agents: AgentInfo[];
  activeSkillName: string;
  connectedAgents: AgentInfo[];
  detectedAgents: AgentInfo[];
  notFoundAgents: AgentInfo[];
  currentAgent: AgentInfo | null;
  selectedAgent: string;
  onSelectAgent: (key: string) => void;
  restarting: boolean;
  onRestart: () => void;
  onRefresh: () => void;
  m: Record<string, any> | undefined;
  t: McpTabProps['t'];
}) {
  const { copiedField, handleCopy } = useCopyField();

  const hasToken = status.authConfigured && !!status.authToken;
  const remoteHost = status.localIP || 'localhost';
  const mcpUrl = `http://${remoteHost}:${status.port}/mcp`;

  const localSnippet = useMemo(
    () => currentAgent ? generateSnippet(currentAgent, status, 'stdio') : null,
    [currentAgent, status]
  );
  const remoteSnippet = useMemo(
    () => currentAgent ? generateSnippet(currentAgent, status, 'http') : null,
    [currentAgent, status]
  );

  return (
    <>
      {/* MCP Status */}
      <McpStatusInline status={status} restarting={restarting} onRestart={onRestart} onRefresh={onRefresh} m={m} />

      {/* Local (stdio) */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <Monitor size={12} className={status.running ? 'text-success' : 'text-muted-foreground'} />
          <span className="text-xs font-semibold text-foreground">{m?.localTitle ?? 'Local'}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {m?.mcpLocalDesc ?? 'Copy the config snippet and paste into your agent\'s MCP settings.'}
        </p>
        {agents.length > 0 && (
          <div className="space-y-3">
            <CustomSelect
              value={selectedAgent}
              onChange={onSelectAgent}
              options={[
                ...(connectedAgents.length > 0 ? [{ label: m?.connectedGroup ?? 'Connected', options: connectedAgents.map(a => ({ value: a.key, label: a.name })) }] : []),
                ...(detectedAgents.length > 0 ? [{ label: m?.detectedGroup ?? 'Detected', options: detectedAgents.map(a => ({ value: a.key, label: a.name })) }] : []),
                ...(notFoundAgents.length > 0 ? [{ label: m?.notFoundGroup ?? 'Not Installed', options: notFoundAgents.map(a => ({ value: a.key, label: a.name })) }] : []),
              ] as SelectItem[]}
            />
            {currentAgent && localSnippet && (
              <>
                {currentAgent.present && currentAgent.installed && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium bg-success/10 text-success">
                    <CheckCircle2 size={10} /> {m?.tagConnected ?? 'Connected'}
                  </span>
                )}
                <pre className="text-[11px] font-mono bg-muted/50 border border-border rounded-lg p-3 overflow-x-auto whitespace-pre select-all max-h-[200px] overflow-y-auto">
                  {localSnippet.displaySnippet}
                </pre>
                <div className="flex items-center gap-3 text-sm">
                  <button onClick={async () => { const ok = await copyToClipboard(localSnippet.snippet); if (ok) toast.copy(); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0">
                    <Copy size={14} /> {m?.copyConfig ?? 'Copy'}
                  </button>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-mono text-muted-foreground truncate text-2xs">{localSnippet.path}</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Detected Agents — install MCP config + Skill locally */}
      {agents.length > 0 && (
        <InlineCollapsible
          icon={<Users size={12} className="text-muted-foreground" />}
          title={m?.detectedAgentsTitle ?? 'Detected Agents'}
          badge={`${connectedAgents.length + detectedAgents.length}/${agents.length}`}
        >
          <AgentInstall agents={agents} t={t} onRefresh={onRefresh} mode="mcp" activeSkillName={activeSkillName} />
        </InlineCollapsible>
      )}

      {/* Remote */}
      <div className="border-t border-border pt-3 space-y-3">
        <div className="flex items-center gap-2">
          <Globe size={12} className="text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">{m?.remoteTitle ?? 'Remote Access'}</span>
        </div>
        {!hasToken && (
          <p className="flex items-center gap-1.5 text-xs text-[var(--amber-text)]">
            <AlertCircle size={12} /> {m?.noAuthWarning ?? 'Set an Auth Token in Settings → General before enabling remote access.'}
          </p>
        )}
        <div className="space-y-1">
          <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">{m?.serverUrl ?? 'MCP Server URL'}</span>
          <div className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/50 border border-border rounded-lg">
            <code className="flex-1 text-xs font-mono text-foreground select-all truncate">{mcpUrl}</code>
            <CopyButton onCopy={() => handleCopy(mcpUrl, 'mcp-url')} copied={copiedField === 'mcp-url'} size="sm" />
          </div>
        </div>
        {agents.length > 0 && currentAgent && remoteSnippet && (
          <>
            <pre className="text-[11px] font-mono bg-muted/50 border border-border rounded-lg p-3 overflow-x-auto whitespace-pre select-all max-h-[200px] overflow-y-auto">
              {remoteSnippet.displaySnippet}
            </pre>
            <div className="flex items-center gap-3 text-sm">
              <button onClick={async () => { const ok = await copyToClipboard(remoteSnippet.snippet); if (ok) toast.copy(); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0">
                <Copy size={14} /> {m?.copyConfig ?? 'Copy'}
              </button>
              <span className="text-muted-foreground">→</span>
              <span className="font-mono text-muted-foreground truncate text-2xs">{remoteSnippet.path}</span>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/* ── Inline Collapsible (inside a card) ── */

function InlineCollapsible({ icon, title, badge, defaultOpen = false, children }: {
  icon?: React.ReactNode;
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left bg-muted/30 hover:bg-muted/60 transition-colors"
      >
        {open ? <ChevronDown size={11} className="text-muted-foreground" /> : <ChevronRight size={11} className="text-muted-foreground" />}
        {icon}
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        {badge && <span className="text-2xs text-muted-foreground/70 ml-auto">{badge}</span>}
      </button>
      {open && <div className="px-3 py-2.5 border-t border-border">{children}</div>}
    </div>
  );
}

/* ── Step Block ── */

function StepBlock({ step, label, children }: { step: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="w-4 h-4 rounded-full bg-muted flex items-center justify-center text-2xs font-semibold text-muted-foreground shrink-0">{step}</span>
        <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className="pl-6">{children}</div>
    </div>
  );
}

/* ── MCP Status (compact inline) ── */

function McpStatusInline({ status, restarting, onRestart, onRefresh, m }: {
  status: McpStatus; restarting: boolean; onRestart: () => void; onRefresh: () => void; m: Record<string, any> | undefined;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-muted/30">
      <div className="flex items-center gap-2 text-xs">
        {restarting ? (
          <><Loader2 size={11} className="animate-spin text-[var(--amber)]" /><span className="text-[var(--amber)]">{m?.restarting ?? 'Restarting...'}</span></>
        ) : (
          <>
            <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${status.running ? 'bg-success' : 'bg-muted-foreground'}`} />
            <span className="font-medium text-foreground">MCP {status.running ? (m?.running ?? 'Running') : (m?.stopped ?? 'Stopped')}</span>
            {status.running && <><span className="text-muted-foreground">·</span><span className="text-muted-foreground">:{status.port}</span><span className="text-muted-foreground">·</span><span className="text-muted-foreground">{status.toolCount} {m?.tools ?? 'tools'}</span></>}
          </>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {!status.running && !restarting && (
          <button onClick={onRestart} className="flex items-center gap-1 px-2 py-1 text-2xs rounded-md font-medium text-[var(--amber-foreground)] bg-[var(--amber)] transition-colors">
            <RotateCcw size={11} /> {m?.restart ?? 'Restart'}
          </button>
        )}
        <button onClick={onRefresh} className="p-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <RefreshCw size={11} />
        </button>
      </div>
    </div>
  );
}

/* ── Code Block ── */

function CodeBlock({ label, code, onCopy, copiedField, fieldId, compact, hint }: {
  label?: string; code: string; onCopy: (text: string, field: string) => void; copiedField: string | null; fieldId: string; compact?: boolean; hint?: string;
}) {
  return (
    <div className={compact ? '' : 'space-y-1'}>
      {label && <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>}
      <div className={`flex items-center gap-2 ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'} bg-muted/50 border border-border rounded-lg`}>
        <code className="flex-1 text-xs font-mono text-foreground select-all truncate">{code}</code>
        {hint && <span className="text-2xs text-muted-foreground/60 shrink-0 hidden sm:inline">{hint}</span>}
        <CopyButton onCopy={() => onCopy(code, fieldId)} copied={copiedField === fieldId} size="sm" />
      </div>
    </div>
  );
}

/* ── Copy Button ── */

export function CopyButton({ onCopy, copied, title, size }: { onCopy: () => void; copied: boolean; title?: string; size?: 'sm' | 'md' }) {
  const sz = size === 'sm' ? 11 : 14;
  const pad = size === 'sm' ? 'p-1' : 'p-2';
  return (
    <button type="button" onClick={onCopy} title={title ?? 'Copy'}
      className={`shrink-0 ${pad} rounded-lg border transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
        copied ? 'border-success/50 bg-success/10 text-success' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}>
      {copied ? <Check size={sz} /> : <Copy size={sz} />}
    </button>
  );
}
