'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plug, CheckCircle2, AlertCircle, Loader2, Copy, Check,
  ChevronDown, ChevronRight, Trash2, Plus, X,
} from 'lucide-react';
import { SectionLabel } from './Primitives';
import { apiFetch } from '@/lib/api';

/* ── Types ─────────────────────────────────────────────────────── */

interface McpStatus {
  running: boolean;
  transport: string;
  endpoint: string;
  port: number;
  toolCount: number;
  authConfigured: boolean;
}

interface AgentInfo {
  key: string;
  name: string;
  present: boolean;
  installed: boolean;
  scope?: string;
  transport?: string;
  configPath?: string;
  hasProjectScope: boolean;
  hasGlobalScope: boolean;
  preferredTransport: 'stdio' | 'http';
}

interface SkillInfo {
  name: string;
  description: string;
  path: string;
  source: 'builtin' | 'user';
  enabled: boolean;
  editable: boolean;
}

interface McpTabProps {
  t: any;
}

/* ── Helpers ───────────────────────────────────────────────────── */

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copied!' : label}
    </button>
  );
}

/* ── MCP Server Status ─────────────────────────────────────────── */

function ServerStatus({ status, t }: { status: McpStatus | null; t: any }) {
  const m = t.settings?.mcp;
  if (!status) return null;

  const configSnippet = JSON.stringify({
    mcpServers: {
      mindos: status.running
        ? { url: status.endpoint }
        : { type: 'stdio', command: 'mindos', args: ['mcp'] },
    },
  }, null, 2);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Plug size={16} className="text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-foreground">{m?.serverTitle ?? 'MindOS MCP Server'}</h3>
        </div>
      </div>

      <div className="space-y-1.5 text-sm pl-11">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-20 shrink-0 text-xs">{m?.status ?? 'Status'}</span>
          <span className={`text-xs flex items-center gap-1 ${status.running ? 'text-green-500' : 'text-muted-foreground'}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${status.running ? 'bg-green-500' : 'bg-muted-foreground'}`} />
            {status.running ? (m?.running ?? 'Running') : (m?.stopped ?? 'Stopped')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-20 shrink-0 text-xs">{m?.transport ?? 'Transport'}</span>
          <span className="text-xs font-mono">{status.transport.toUpperCase()}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-20 shrink-0 text-xs">{m?.endpoint ?? 'Endpoint'}</span>
          <span className="text-xs font-mono truncate">{status.endpoint}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-20 shrink-0 text-xs">{m?.tools ?? 'Tools'}</span>
          <span className="text-xs">{m?.toolsRegistered ? m.toolsRegistered(status.toolCount) : `${status.toolCount} registered`}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-20 shrink-0 text-xs">{m?.auth ?? 'Auth'}</span>
          <span className="text-xs">
            {status.authConfigured
              ? <span className="text-green-500">{m?.authSet ?? 'Token set'}</span>
              : <span className="text-muted-foreground">{m?.authNotSet ?? 'No token'}</span>}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 pl-11">
        <CopyButton text={status.endpoint} label={m?.copyEndpoint ?? 'Copy Endpoint'} />
        <CopyButton text={configSnippet} label={m?.copyConfig ?? 'Copy Config'} />
      </div>
    </div>
  );
}

/* ── Agent Install ─────────────────────────────────────────────── */

function AgentInstall({ agents, t, onRefresh }: { agents: AgentInfo[]; t: any; onRefresh: () => void }) {
  const m = t.settings?.mcp;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [transport, setTransport] = useState<'auto' | 'stdio' | 'http'>('auto');
  const [httpUrl, setHttpUrl] = useState('http://localhost:8787/mcp');
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

  const handleInstall = async () => {
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
            scope: scopes[key] || (agents.find(a => a.key === key)?.hasProjectScope ? 'project' : 'global'),
            transport: effectiveTransport,
          };
        }),
        transport,
        ...(transport === 'http' ? { url: httpUrl, token: httpToken } : {}),
        // For auto mode, pass http settings for agents that need it
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

  return (
    <div className="space-y-3">
      <SectionLabel>{m?.agentsTitle ?? 'Agent Configuration'}</SectionLabel>

      {/* Agent list */}
      <div className="space-y-1">
        {agents.map(agent => (
          <div key={agent.key} className="flex items-center gap-3 py-1.5 text-sm">
            <input
              type="checkbox"
              checked={selected.has(agent.key)}
              onChange={() => toggle(agent.key)}
              className="rounded border-border accent-amber-500"
            />
            <span className="w-28 shrink-0 text-xs">{agent.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-mono"
              style={{ background: 'rgba(100,100,120,0.08)' }}>
              {getEffectiveTransport(agent)}
            </span>
            {agent.installed ? (
              <>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-500 font-mono">
                  {agent.transport}
                </span>
                <span className="text-[10px] text-muted-foreground">{agent.scope}</span>
              </>
            ) : (
              <span className="text-[10px] text-muted-foreground">
                {agent.present ? (m?.detected ?? 'Detected') : (m?.notFound ?? 'Not found')}
              </span>
            )}
            {/* Scope selector */}
            {selected.has(agent.key) && agent.hasProjectScope && agent.hasGlobalScope && (
              <select
                value={scopes[agent.key] || 'project'}
                onChange={e => setScopes({ ...scopes, [agent.key]: e.target.value as 'project' | 'global' })}
                className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-border bg-background text-foreground"
              >
                <option value="project">{m?.project ?? 'Project'}</option>
                <option value="global">{m?.global ?? 'Global'}</option>
              </select>
            )}
          </div>
        ))}
      </div>

      {/* Transport selector */}
      <div className="flex items-center gap-4 text-xs pt-1">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="transport"
            checked={transport === 'auto'}
            onChange={() => setTransport('auto')}
            className="accent-amber-500"
          />
          {m?.transportAuto ?? 'auto (recommended)'}
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="transport"
            checked={transport === 'stdio'}
            onChange={() => setTransport('stdio')}
            className="accent-amber-500"
          />
          {m?.transportStdio ?? 'stdio'}
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="transport"
            checked={transport === 'http'}
            onChange={() => setTransport('http')}
            className="accent-amber-500"
          />
          {m?.transportHttp ?? 'http'}
        </label>
      </div>

      {/* HTTP settings */}
      {showHttpFields && (
        <div className="space-y-2 pl-5 text-xs">
          <div className="space-y-1">
            <label className="text-muted-foreground">{m?.httpUrl ?? 'MCP URL'}</label>
            <input
              type="text"
              value={httpUrl}
              onChange={e => setHttpUrl(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background font-mono text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <label className="text-muted-foreground">{m?.httpToken ?? 'Auth Token'}</label>
            <input
              type="password"
              value={httpToken}
              onChange={e => setHttpToken(e.target.value)}
              placeholder="Bearer token"
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background font-mono text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      )}

      {/* Install button */}
      <button
        onClick={handleInstall}
        disabled={selected.size === 0 || installing}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: 'var(--amber)', color: '#131210' }}
      >
        {installing && <Loader2 size={12} className="animate-spin" />}
        {installing ? (m?.installing ?? 'Installing...') : (m?.installSelected ?? 'Install Selected')}
      </button>

      {/* Message */}
      {message && (
        <div className="flex items-center gap-1.5 text-xs" role="status">
          {message.type === 'success' ? (
            <><CheckCircle2 size={12} className="text-green-500" /><span className="text-green-500">{message.text}</span></>
          ) : (
            <><AlertCircle size={12} className="text-destructive" /><span className="text-destructive">{message.text}</span></>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Skills Section ────────────────────────────────────────────── */

function SkillsSection({ t }: { t: any }) {
  const m = t.settings?.mcp;
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newContent, setNewContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchSkills = useCallback(async () => {
    try {
      const data = await apiFetch<{ skills: SkillInfo[] }>('/api/skills');
      setSkills(data.skills);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  const handleToggle = async (name: string, enabled: boolean) => {
    try {
      await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', name, enabled }),
      });
      setSkills(prev => prev.map(s => s.name === name ? { ...s, enabled } : s));
    } catch { /* ignore */ }
  };

  const handleDelete = async (name: string) => {
    const confirmMsg = m?.skillDeleteConfirm ? m.skillDeleteConfirm(name) : `Delete skill "${name}"?`;
    if (!confirm(confirmMsg)) return;
    try {
      await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', name }),
      });
      fetchSkills();
    } catch { /* ignore */ }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: newName.trim(), description: newDesc.trim(), content: newContent }),
      });
      setAdding(false);
      setNewName('');
      setNewDesc('');
      setNewContent('');
      fetchSkills();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create skill');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <SectionLabel>{m?.skillsTitle ?? 'Skills'}</SectionLabel>

      {/* Skill language switcher */}
      {(() => {
        const mindosEnabled = skills.find(s => s.name === 'mindos')?.enabled ?? true;
        const currentLang = mindosEnabled ? 'en' : 'zh';
        const handleLangSwitch = async (lang: 'en' | 'zh') => {
          if (lang === currentLang) return;
          if (lang === 'en') {
            await handleToggle('mindos', true);
            await handleToggle('mindos-zh', false);
          } else {
            await handleToggle('mindos-zh', true);
            await handleToggle('mindos', false);
          }
        };
        return (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">{m?.skillLanguage ?? 'Skill Language'}</span>
            <div className="flex rounded-md border border-border overflow-hidden">
              <button
                onClick={() => handleLangSwitch('en')}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  currentLang === 'en'
                    ? 'bg-amber-500/15 text-amber-600 font-medium'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {m?.skillLangEn ?? 'English'}
              </button>
              <button
                onClick={() => handleLangSwitch('zh')}
                className={`px-2.5 py-1 text-xs transition-colors border-l border-border ${
                  currentLang === 'zh'
                    ? 'bg-amber-500/15 text-amber-600 font-medium'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {m?.skillLangZh ?? '中文'}
              </button>
            </div>
          </div>
        );
      })()}

      {skills.map(skill => (
        <div key={skill.name} className="border border-border rounded-lg overflow-hidden">
          <div
            className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => setExpanded(expanded === skill.name ? null : skill.name)}
          >
            {expanded === skill.name ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="text-xs font-medium flex-1">{skill.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
              skill.source === 'builtin' ? 'bg-blue-500/15 text-blue-500' : 'bg-purple-500/15 text-purple-500'
            }`}>
              {skill.source === 'builtin' ? (m?.skillBuiltin ?? 'Built-in') : (m?.skillUser ?? 'Custom')}
            </span>
            {/* Toggle */}
            <button
              onClick={e => { e.stopPropagation(); handleToggle(skill.name, !skill.enabled); }}
              className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                skill.enabled ? 'bg-green-500' : 'bg-muted-foreground/30'
              }`}
            >
              <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                skill.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
              }`} />
            </button>
          </div>

          {expanded === skill.name && (
            <div className="px-3 py-2 border-t border-border text-xs space-y-1.5 bg-muted/20">
              <p className="text-muted-foreground">{skill.description || 'No description'}</p>
              <p className="text-muted-foreground font-mono text-[10px]">{skill.path}</p>
              {skill.editable && (
                <button
                  onClick={() => handleDelete(skill.name)}
                  className="flex items-center gap-1 text-[10px] text-destructive hover:underline"
                >
                  <Trash2 size={10} />
                  {m?.deleteSkill ?? 'Delete'}
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Add skill form */}
      {adding ? (
        <div className="border border-border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{m?.addSkill ?? '+ Add Skill'}</span>
            <button onClick={() => setAdding(false)} className="p-0.5 rounded hover:bg-muted text-muted-foreground">
              <X size={12} />
            </button>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">{m?.skillName ?? 'Name'}</label>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value.replace(/[^a-z0-9-]/g, ''))}
              placeholder="my-skill"
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background font-mono text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">{m?.skillDesc ?? 'Description'}</label>
            <input
              type="text"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="What does this skill do?"
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">{m?.skillContent ?? 'Content'}</label>
            <textarea
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              rows={6}
              placeholder="Skill instructions (markdown)..."
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background text-foreground outline-none focus:ring-1 focus:ring-ring resize-y font-mono"
            />
          </div>
          {error && (
            <p className="text-[10px] text-destructive flex items-center gap-1">
              <AlertCircle size={10} />
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || saving}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              style={{ background: 'var(--amber)', color: '#131210' }}
            >
              {saving && <Loader2 size={10} className="animate-spin" />}
              {m?.saveSkill ?? 'Save'}
            </button>
            <button
              onClick={() => setAdding(false)}
              className="px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              {m?.cancelSkill ?? 'Cancel'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus size={12} />
          {m?.addSkill ?? '+ Add Skill'}
        </button>
      )}
    </div>
  );
}

/* ── Main McpTab ───────────────────────────────────────────────── */

export function McpTab({ t }: McpTabProps) {
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [statusData, agentsData] = await Promise.all([
        apiFetch<McpStatus>('/api/mcp/status'),
        apiFetch<{ agents: AgentInfo[] }>('/api/mcp/agents'),
      ]);
      setMcpStatus(statusData);
      setAgents(agentsData.agents);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 size={18} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* MCP Server Status */}
      <ServerStatus status={mcpStatus} t={t} />

      {/* Divider */}
      <div className="border-t border-border" />

      {/* Agent Install */}
      <AgentInstall agents={agents} t={t} onRefresh={fetchAll} />

      {/* Divider */}
      <div className="border-t border-border" />

      {/* Skills */}
      <SkillsSection t={t} />
    </div>
  );
}
