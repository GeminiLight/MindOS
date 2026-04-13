'use client';

import { useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2, Copy } from 'lucide-react';
import CustomSelect from '@/components/CustomSelect';
import { apiFetch } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/lib/toast';
import { PasswordInput } from './Primitives';
import type { AgentInfo, McpAgentInstallProps } from './types';

/* ── Agent Install ─────────────────────────────────────────────── */

export default function AgentInstall({ agents, t, onRefresh, mode = 'mcp', activeSkillName = 'mindos' }: McpAgentInstallProps) {
  const m = t.settings?.mcp;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [transport, setTransport] = useState<'auto' | 'stdio' | 'http'>('auto');
  const [httpUrl, setHttpUrl] = useState('http://localhost:8781/mcp');
  const [httpToken, setHttpToken] = useState('');
  const [scopes, setScopes] = useState<Record<string, 'project' | 'global'>>({});
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const getEffectiveTransport = (agent: AgentInfo) => {
    if (transport === 'auto') return agent.preferredTransport;
    return transport;
  };

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  /* ── MCP mode: install MCP config via API ── */
  const handleMcpInstall = async () => {
    if (selected.size === 0) return;
    setInstalling(true);
    setMessage(null);
    try {
      const payload = {
        agents: [...selected].map(key => {
          const agent = agents.find(a => a.key === key);
          const effectiveTransport = transport === 'auto'
            ? (agent?.preferredTransport || 'stdio')
            : transport;
          return {
            key,
            scope: scopes[key] || 'global',
            transport: effectiveTransport,
          };
        }),
        transport,
        ...(transport === 'http' ? { url: httpUrl, token: httpToken } : {}),
        ...(transport === 'auto' ? { url: httpUrl, token: httpToken } : {}),
      };
      const res = await apiFetch<{ results: Array<{ agent: string; status: string; message?: string }> }>('/api/mcp/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const ok = res.results.filter(r => r.status === 'ok').length;
      const fail = res.results.filter(r => r.status === 'error');
      if (fail.length > 0) {
        setMessage({ type: 'error', text: fail.map(f => `${f.agent}: ${f.message}`).join('; ') });
      } else {
        setMessage({ type: 'success', text: m?.installSuccess ? m.installSuccess(ok) : `${ok} agent(s) configured` });
      }
      setSelected(new Set());
      onRefresh();
    } catch {
      setMessage({ type: 'error', text: m?.installFailed ?? 'Install failed' });
    } finally {
      setInstalling(false);
      setTimeout(() => setMessage(null), 4000);
    }
  };

  // Show http fields if transport is 'http', or 'auto' with any http-preferred agent selected
  const showHttpFields = transport === 'http' || (transport === 'auto' && [...selected].some(key => {
    const agent = agents.find(a => a.key === key);
    return agent?.preferredTransport === 'http';
  }));

  /* ═══ CLI mode: show skill install commands ═══ */
  if (mode === 'cli') {
    return <CliSkillInstall agents={agents} m={m} activeSkillName={activeSkillName} />;
  }

  /* ═══ MCP mode: full MCP config install ═══ */
  return (
    <div className="space-y-3 pt-2">
      <p className="text-xs text-muted-foreground">
        {m?.mcpInstallDesc ?? 'Install MCP config + Skill to detected agents on this machine.'}
      </p>

      {/* Agent list */}
      <div className="space-y-1">
        {agents.map(agent => (
          <div key={agent.key} className="flex items-center gap-3 py-1.5 text-sm">
            <input
              type="checkbox"
              checked={selected.has(agent.key)}
              onChange={() => toggle(agent.key)}
              className="form-check"
            />
            <span className="w-28 shrink-0 text-xs">{agent.name}</span>
            <span className="text-2xs px-1.5 py-0.5 rounded font-mono bg-muted">
              {getEffectiveTransport(agent)}
            </span>
            {agent.installed ? (
              <>
                <span className="text-2xs px-1.5 py-0.5 rounded bg-success/15 text-success font-mono">
                  {agent.transport}
                </span>
                <span className="text-2xs text-muted-foreground">{agent.scope}</span>
              </>
            ) : (
              <span className="text-2xs text-muted-foreground">
                {agent.present ? (m?.detected ?? 'Detected') : (m?.notFound ?? 'Not found')}
              </span>
            )}
            {selected.has(agent.key) && agent.hasProjectScope && agent.hasGlobalScope && (
              <CustomSelect
                value={scopes[agent.key] || 'global'}
                onChange={v => setScopes({ ...scopes, [agent.key]: v as 'project' | 'global' })}
                size="sm"
                className="ml-auto"
                options={[
                  { value: 'global', label: m?.global ?? 'Global' },
                  { value: 'project', label: m?.project ?? 'Project' },
                ]}
              />
            )}
          </div>
        ))}
      </div>

      {/* Quick select */}
      <div className="flex gap-2 text-xs pt-1">
        <button type="button"
          onClick={() => setSelected(new Set(agents.filter(a => !a.installed && a.present).map(a => a.key)))}
          className="px-2.5 py-1 rounded-md border border-[var(--amber)] text-[var(--amber)] transition-colors hover:bg-muted/50">
          {m?.selectDetected ?? 'Select Detected'}
        </button>
        <button type="button"
          onClick={() => setSelected(new Set())}
          className="px-2.5 py-1 rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
          {m?.clearSelection ?? 'Clear'}
        </button>
      </div>

      {/* Transport selector */}
      <div className="flex items-center gap-4 text-xs pt-1">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" name="transport" checked={transport === 'auto'} onChange={() => setTransport('auto')} className="form-radio" />
          {m?.transportAuto ?? 'auto (recommended)'}
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" name="transport" checked={transport === 'stdio'} onChange={() => setTransport('stdio')} className="form-radio" />
          {m?.transportStdio ?? 'stdio'}
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" name="transport" checked={transport === 'http'} onChange={() => setTransport('http')} className="form-radio" />
          {m?.transportHttp ?? 'http'}
        </label>
      </div>

      {/* HTTP settings */}
      {showHttpFields && (
        <div className="space-y-2 pl-5 text-xs">
          <div className="space-y-1">
            <label className="text-muted-foreground">{m?.httpUrl ?? 'MCP URL'}</label>
            <input type="text" value={httpUrl} onChange={e => setHttpUrl(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background font-mono text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring" />
          </div>
          <div className="space-y-1">
            <label className="text-muted-foreground">{m?.httpToken ?? 'Auth Token'}</label>
            <PasswordInput
              value={httpToken}
              onChange={setHttpToken}
              placeholder="Bearer token"
              size="sm"
            />
          </div>
        </div>
      )}

      {/* Install button */}
      <button onClick={handleMcpInstall} disabled={selected.size === 0 || installing}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-[var(--amber)] text-[var(--amber-foreground)]">
        {installing && <Loader2 size={12} className="animate-spin" />}
        {installing ? (m?.installing ?? 'Installing...') : (m?.installSelected ?? 'Install Selected')}
      </button>

      {/* Message */}
      {message && (
        <div className="flex items-center gap-1.5 text-xs" role="status">
          {message.type === 'success' ? (
            <><CheckCircle2 size={12} className="text-success" /><span className="text-success">{message.text}</span></>
          ) : (
            <><AlertCircle size={12} className="text-destructive" /><span className="text-destructive">{message.text}</span></>
          )}
        </div>
      )}
    </div>
  );
}

/* ── CLI Skill Install — generates per-agent CLI commands ── */

function CliSkillInstall({ agents, m, activeSkillName }: {
  agents: AgentInfo[];
  m: Record<string, any> | undefined;
  activeSkillName: string;
}) {
  const [selectedAgent, setSelectedAgent] = useState(agents[0]?.key ?? 'claude-code');
  const agent = agents.find(a => a.key === selectedAgent);
  const cmd = `npx skills add GeminiLight/MindOS --skill ${activeSkillName} -a ${selectedAgent} -g -y`;

  const handleCopy = async () => {
    const ok = await copyToClipboard(cmd);
    if (ok) toast.copy();
  };

  const connected = agents.filter(a => a.present && a.installed);
  const detected = agents.filter(a => a.present && !a.installed);
  const notFound = agents.filter(a => !a.present);

  return (
    <div className="space-y-3 pt-2">
      <p className="text-xs text-muted-foreground">
        {m?.cliInstallDesc ?? 'Install the MindOS Skill to your agent so it can operate your knowledge base.'}
      </p>

      {/* Agent selector */}
      <CustomSelect
        value={selectedAgent}
        onChange={setSelectedAgent}
        size="sm"
        options={[
          ...(connected.length > 0 ? [{ label: m?.connectedGroup ?? 'Connected', options: connected.map(a => ({ value: a.key, label: a.name })) }] : []),
          ...(detected.length > 0 ? [{ label: m?.detectedGroup ?? 'Detected', options: detected.map(a => ({ value: a.key, label: a.name })) }] : []),
          ...(notFound.length > 0 ? [{ label: m?.notFoundGroup ?? 'Not Installed', options: notFound.map(a => ({ value: a.key, label: a.name })) }] : []),
        ]}
      />

      {/* Status */}
      {agent && (
        <div className="flex items-center gap-2 text-2xs">
          {agent.present && agent.installed ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-medium bg-success/10 text-success">
              <CheckCircle2 size={10} /> {m?.tagConnected ?? 'Connected'}
            </span>
          ) : agent.present ? (
            <span className="text-muted-foreground">{m?.detected ?? 'Detected'}</span>
          ) : (
            <span className="text-muted-foreground">{m?.notFound ?? 'Not found'}</span>
          )}
          {agent.installedSkillCount != null && agent.installedSkillCount > 0 && (
            <span className="text-muted-foreground">{agent.installedSkillCount} {m?.skillsInstalled ?? 'skills installed'}</span>
          )}
        </div>
      )}

      {/* Command */}
      <div className="flex items-center gap-1.5">
        <code className="flex-1 text-[10px] font-mono bg-muted/50 border border-border rounded-lg px-2.5 py-2 text-muted-foreground select-all overflow-x-auto whitespace-nowrap">
          {cmd}
        </code>
        <button onClick={handleCopy}
          className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0">
          <Copy size={11} />
        </button>
      </div>
    </div>
  );
}
