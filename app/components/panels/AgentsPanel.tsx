'use client';

import { useState, useCallback, useMemo } from 'react';
import { Loader2, RefreshCw, ChevronDown, ChevronRight, CheckCircle2, AlertCircle, Copy, Check, Monitor, Globe, Settings } from 'lucide-react';
import { useMcpData } from '@/hooks/useMcpData';
import { useLocale } from '@/lib/LocaleContext';
import { generateSnippet } from '@/lib/mcp-snippets';
import { copyToClipboard } from '@/lib/clipboard';
import { Toggle } from '../settings/Primitives';
import type { AgentInfo, McpStatus, SkillInfo } from '../settings/types';
import PanelHeader from './PanelHeader';

interface AgentsPanelProps {
  active: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
}

export default function AgentsPanel({ active, maximized, onMaximize }: AgentsPanelProps) {
  const { t } = useLocale();
  const p = t.panels.agents;
  const mcp = useMcpData();
  const [refreshing, setRefreshing] = useState(false);
  const [showNotDetected, setShowNotDetected] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [showBuiltinSkills, setShowBuiltinSkills] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await mcp.refresh();
    setRefreshing(false);
  };

  const toggleAgent = (key: string) => {
    setExpandedAgent(prev => prev === key ? null : key);
  };

  const connected = mcp.agents.filter(a => a.present && a.installed);
  const detected = mcp.agents.filter(a => a.present && !a.installed);
  const notFound = mcp.agents.filter(a => !a.present);

  const customSkills = mcp.skills.filter(s => s.source === 'user');
  const builtinSkills = mcp.skills.filter(s => s.source === 'builtin');
  const activeSkillCount = mcp.skills.filter(s => s.enabled).length;

  const openAdvancedConfig = () => {
    window.dispatchEvent(new CustomEvent('mindos:open-settings', { detail: { tab: 'mcp' } }));
  };

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      <PanelHeader title={p.title} maximized={maximized} onMaximize={onMaximize}>
        <div className="flex items-center gap-1.5">
          {!mcp.loading && (
            <span className="text-2xs text-muted-foreground">{connected.length} {p.connected}</span>
          )}
          <button onClick={handleRefresh} disabled={refreshing}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
            aria-label={p.refresh} title={p.refresh}>
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </PanelHeader>

      <div className="flex-1 overflow-y-auto min-h-0">
        {mcp.loading ? (
          <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin text-muted-foreground" /></div>
        ) : mcp.agents.length === 0 && mcp.skills.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center px-4">
            <p className="text-xs text-muted-foreground">{p.noAgents}</p>
            <button onClick={handleRefresh}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <RefreshCw size={11} /> {p.retry}
            </button>
          </div>
        ) : (
          <div className="px-3 py-3 space-y-4">
            {/* MCP Server status — single line */}
            <div className="rounded-lg border border-border bg-card/50 px-3 py-2.5 flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">{p.mcpServer}</span>
              {mcp.status?.running ? (
                <span className="flex items-center gap-1.5 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                  <span className="text-emerald-600 dark:text-emerald-400">:{mcp.status.port}</span>
                  <span className="text-muted-foreground">· {mcp.status.toolCount} tools</span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 inline-block" />
                  <span className="text-muted-foreground">{p.stopped}</span>
                </span>
              )}
            </div>

            {/* Connected Agents */}
            {connected.length > 0 && (
              <section>
                <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">{p.sectionConnected} ({connected.length})</h3>
                <div className="space-y-1.5">
                  {connected.map(agent => (
                    <AgentCard
                      key={agent.key}
                      agent={agent}
                      agentStatus="connected"
                      mcpStatus={mcp.status}
                      expanded={expandedAgent === agent.key}
                      onToggle={() => toggleAgent(agent.key)}
                      onInstallAgent={mcp.installAgent}
                      t={p}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Detected Agents */}
            {detected.length > 0 && (
              <section>
                <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">{p.sectionDetected} ({detected.length})</h3>
                <div className="space-y-1.5">
                  {detected.map(agent => (
                    <AgentCard
                      key={agent.key}
                      agent={agent}
                      agentStatus="detected"
                      mcpStatus={mcp.status}
                      expanded={expandedAgent === agent.key}
                      onToggle={() => toggleAgent(agent.key)}
                      onInstallAgent={mcp.installAgent}
                      t={p}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Not Found Agents (collapsed) */}
            {notFound.length > 0 && (
              <section>
                <button onClick={() => setShowNotDetected(!showNotDetected)}
                  className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2 hover:text-foreground transition-colors">
                  {showNotDetected ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {p.sectionNotDetected} ({notFound.length})
                </button>
                {showNotDetected && (
                  <div className="space-y-1.5">
                    {notFound.map(agent => (
                      <AgentCard
                        key={agent.key}
                        agent={agent}
                        agentStatus="notFound"
                        mcpStatus={mcp.status}
                        expanded={expandedAgent === agent.key}
                        onToggle={() => toggleAgent(agent.key)}
                        onInstallAgent={mcp.installAgent}
                        t={p}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* ── Skills Section ── */}
            {mcp.skills.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    {p.skillsTitle} <span className="normal-case font-normal">{activeSkillCount} {p.skillsActive}</span>
                  </h3>
                  <button
                    onClick={openAdvancedConfig}
                    className="text-2xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {p.newSkill}
                  </button>
                </div>

                {/* Custom skills */}
                {customSkills.length > 0 && (
                  <div className="space-y-0.5 mb-2">
                    {customSkills.map(skill => (
                      <SkillRow key={skill.name} skill={skill} onToggle={mcp.toggleSkill} />
                    ))}
                  </div>
                )}

                {/* Built-in skills (collapsed) */}
                {builtinSkills.length > 0 && (
                  <>
                    <button
                      onClick={() => setShowBuiltinSkills(!showBuiltinSkills)}
                      className="flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground transition-colors mb-1"
                    >
                      {showBuiltinSkills ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                      {p.builtinSkills} ({builtinSkills.length})
                    </button>
                    {showBuiltinSkills && (
                      <div className="space-y-0.5">
                        {builtinSkills.map(skill => (
                          <SkillRow key={skill.name} skill={skill} onToggle={mcp.toggleSkill} />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
          </div>
        )}
      </div>

      {/* Footer: Advanced Config link */}
      <div className="px-3 py-2 border-t border-border shrink-0">
        <button
          onClick={openAdvancedConfig}
          className="flex items-center gap-1.5 text-2xs text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          <Settings size={11} />
          {p.advancedConfig}
        </button>
      </div>
    </div>
  );
}

/* ── Skill Row ── */

function SkillRow({ skill, onToggle }: { skill: SkillInfo; onToggle: (name: string, enabled: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-muted/30 transition-colors">
      <span className="text-xs text-foreground truncate">{skill.name}</span>
      <Toggle
        size="sm"
        checked={skill.enabled}
        onChange={(v) => onToggle(skill.name, v)}
      />
    </div>
  );
}

/* ── Agent Card ── */

function AgentCard({ agent, agentStatus, mcpStatus, expanded, onToggle, onInstallAgent, t }: {
  agent: AgentInfo;
  agentStatus: 'connected' | 'detected' | 'notFound';
  mcpStatus: McpStatus | null;
  expanded: boolean;
  onToggle: () => void;
  onInstallAgent: (key: string, opts?: { scope?: string; transport?: string }) => Promise<boolean>;
  t: Record<string, any>;
}) {
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio');
  const [copied, setCopied] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const dot = agentStatus === 'connected' ? 'bg-emerald-500' : agentStatus === 'detected' ? 'bg-amber-500' : 'bg-zinc-400';

  const snippet = useMemo(() => generateSnippet(agent, mcpStatus, transport), [agent, mcpStatus, transport]);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(snippet.snippet);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [snippet.snippet]);

  const handleInstall = async () => {
    setInstalling(true);
    setResult(null);
    const ok = await onInstallAgent(agent.key);
    if (ok) {
      setResult({ type: 'success', text: `${agent.name} ${t.connected}` });
    } else {
      setResult({ type: 'error', text: 'Install failed' });
    }
    setInstalling(false);
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/30 overflow-hidden">
      {/* Header row — always clickable to expand */}
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
          <span className="text-xs font-medium text-foreground truncate">{agent.name}</span>
          {agentStatus === 'connected' && agent.transport && (
            <span className="text-2xs px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{agent.transport}</span>
          )}
        </div>
        {expanded ? <ChevronDown size={10} className="text-muted-foreground shrink-0" /> : <ChevronRight size={10} className="text-muted-foreground shrink-0" />}
      </button>

      {/* Expanded: snippet + actions */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border/40 space-y-2.5">
          {/* Detected: Connect button */}
          {agentStatus === 'detected' && (
            <>
              <button onClick={handleInstall} disabled={installing}
                className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-2xs rounded-md font-medium text-white disabled:opacity-50 transition-colors"
                style={{ background: 'var(--amber)' }}>
                {installing ? <Loader2 size={11} className="animate-spin" /> : null}
                {installing ? t.installing : t.install(agent.name)}
              </button>
              {result && (
                <div className={`flex items-center gap-1.5 text-2xs ${result.type === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
                  {result.type === 'success' ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                  {result.text}
                </div>
              )}
            </>
          )}

          {/* Transport toggle */}
          <div className="flex items-center rounded-md border border-border overflow-hidden w-fit">
            <button
              onClick={() => setTransport('stdio')}
              className={`flex items-center gap-1 px-2 py-1 text-2xs transition-colors ${
                transport === 'stdio' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Monitor size={10} />
              {t.transportLocal}
            </button>
            <button
              onClick={() => setTransport('http')}
              className={`flex items-center gap-1 px-2 py-1 text-2xs transition-colors ${
                transport === 'http' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Globe size={10} />
              {t.transportRemote}
            </button>
          </div>

          {/* No auth warning for HTTP */}
          {transport === 'http' && mcpStatus && !mcpStatus.authConfigured && (
            <p className="text-2xs" style={{ color: 'var(--amber)' }}>{t.noAuthWarning}</p>
          )}

          {/* Config snippet */}
          <pre className="text-[10px] font-mono bg-muted/50 border border-border rounded-lg p-2.5 overflow-x-auto whitespace-pre select-all max-h-[200px] overflow-y-auto">
            {snippet.displaySnippet}
          </pre>

          {/* Copy + path */}
          <div className="flex items-center gap-2 text-2xs">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            >
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {copied ? t.copied : t.copyConfig}
            </button>
            <span className="text-muted-foreground">→</span>
            <span className="font-mono text-muted-foreground truncate">{snippet.path}</span>
          </div>
        </div>
      )}
    </div>
  );
}
