'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plug, CheckCircle2, AlertCircle, Loader2, Copy, Check,
  ChevronDown, ChevronRight, Trash2, Plus, X, Search, Pencil,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import dynamic from 'next/dynamic';

const MarkdownView = dynamic(() => import('@/components/MarkdownView'), { ssr: false });

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
  // Snippet generation fields
  format: 'json' | 'toml';
  configKey: string;
  globalNestedKey?: string;
  globalPath: string;
  projectPath?: string | null;
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

/* ── Config Snippet Generator ─────────────────────────────────── */

function generateConfigSnippet(
  agent: AgentInfo,
  status: McpStatus,
  token?: string,
): { snippet: string; path: string } {
  const isRunning = status.running;

  // Determine entry (stdio vs http)
  const stdioEntry: Record<string, unknown> = { type: 'stdio', command: 'mindos', args: ['mcp'] };
  const httpEntry: Record<string, unknown> = { url: status.endpoint };
  if (token) httpEntry.headers = { Authorization: `Bearer ${token}` };
  const entry = isRunning ? httpEntry : stdioEntry;

  // TOML format (Codex)
  if (agent.format === 'toml') {
    const lines: string[] = [`[${agent.configKey}.mindos]`];
    if (isRunning) {
      lines.push(`type = "http"`);
      lines.push(`url = "${status.endpoint}"`);
      if (token) {
        lines.push('');
        lines.push(`[${agent.configKey}.mindos.headers]`);
        lines.push(`Authorization = "Bearer ${token}"`);
      }
    } else {
      lines.push(`command = "mindos"`);
      lines.push(`args = ["mcp"]`);
      lines.push('');
      lines.push(`[${agent.configKey}.mindos.env]`);
      lines.push(`MCP_TRANSPORT = "stdio"`);
    }
    return { snippet: lines.join('\n'), path: agent.globalPath };
  }

  // JSON with globalNestedKey (VS Code project-level uses flat key)
  if (agent.globalNestedKey) {
    // project-level: flat key structure
    const projectSnippet = JSON.stringify({ [agent.configKey]: { mindos: entry } }, null, 2);
    return { snippet: projectSnippet, path: agent.projectPath ?? agent.globalPath };
  }

  // Standard JSON
  const snippet = JSON.stringify({ [agent.configKey]: { mindos: entry } }, null, 2);
  return { snippet, path: agent.globalPath };
}

/* ── MCP Server Status ─────────────────────────────────────────── */

function ServerStatus({ status, agents, t }: { status: McpStatus | null; agents: AgentInfo[]; t: any }) {
  const m = t.settings?.mcp;
  const [selectedAgent, setSelectedAgent] = useState<string>('');

  // Auto-select first installed or first detected agent
  useEffect(() => {
    if (agents.length > 0 && !selectedAgent) {
      const first = agents.find(a => a.installed) ?? agents.find(a => a.present) ?? agents[0];
      if (first) setSelectedAgent(first.key);
    }
  }, [agents, selectedAgent]);

  if (!status) return null;

  const currentAgent = agents.find(a => a.key === selectedAgent);
  const snippetResult = currentAgent ? generateConfigSnippet(currentAgent, status) : null;

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
          <span className={`text-xs flex items-center gap-1 ${status.running ? 'text-success' : 'text-muted-foreground'}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${status.running ? 'bg-success' : 'bg-muted-foreground'}`} />
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
              ? <span className="text-success">{m?.authSet ?? 'Token set'}</span>
              : <span className="text-muted-foreground">{m?.authNotSet ?? 'No token'}</span>}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 pl-11">
        <CopyButton text={status.endpoint} label={m?.copyEndpoint ?? 'Copy Endpoint'} />
      </div>

      {/* Quick Setup — agent-specific config snippet */}
      {agents.length > 0 && (
        <div className="pl-11 pt-2 space-y-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">
              ── {m?.quickSetup ?? 'Quick Setup'} ──
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">{m?.configureFor ?? 'Configure for'}</span>
            <select
              value={selectedAgent}
              onChange={e => setSelectedAgent(e.target.value)}
              className="text-xs px-2 py-1 rounded-md border border-border bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {agents.map(a => (
                <option key={a.key} value={a.key}>
                  {a.name}{a.installed ? ` ✓` : a.present ? ` ·` : ''}
                </option>
              ))}
            </select>
          </div>

          {snippetResult && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0">{m?.configPath ?? 'Config path'}</span>
                <span className="text-xs font-mono text-foreground">{snippetResult.path}</span>
              </div>

              <pre className="text-xs font-mono bg-muted/50 border border-border rounded-lg p-3 overflow-x-auto whitespace-pre">
                {snippetResult.snippet}
              </pre>

              <CopyButton text={snippetResult.snippet} label={m?.copyConfig ?? 'Copy Config'} />
            </>
          )}
        </div>
      )}
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
    <div className="space-y-3 pt-2">
      {/* Agent list */}
      <div className="space-y-1">
        {agents.map(agent => (
          <div key={agent.key} className="flex items-center gap-3 py-1.5 text-sm">
            <input
              type="checkbox"
              checked={selected.has(agent.key)}
              onChange={() => toggle(agent.key)}
              className="rounded border-border"
              style={{ accentColor: 'var(--amber)' }}
            />
            <span className="w-28 shrink-0 text-xs">{agent.name}</span>
            <span className="text-2xs px-1.5 py-0.5 rounded font-mono"
              style={{ background: 'rgba(100,100,120,0.08)' }}>
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
            {/* Scope selector */}
            {selected.has(agent.key) && agent.hasProjectScope && agent.hasGlobalScope && (
              <select
                value={scopes[agent.key] || 'project'}
                onChange={e => setScopes({ ...scopes, [agent.key]: e.target.value as 'project' | 'global' })}
                className="ml-auto text-2xs px-1.5 py-0.5 rounded border border-border bg-background text-foreground"
              >
                <option value="project">{m?.project ?? 'Project'}</option>
                <option value="global">{m?.global ?? 'Global'}</option>
              </select>
            )}
          </div>
        ))}
      </div>

      {/* Select detected / Clear buttons */}
      <div className="flex gap-2 text-xs pt-1">
        <button type="button"
          onClick={() => setSelected(new Set(
            agents.filter(a => !a.installed && a.present).map(a => a.key)
          ))}
          className="px-2.5 py-1 rounded-md border transition-colors hover:bg-muted/50"
          style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
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
          <input
            type="radio"
            name="transport"
            checked={transport === 'auto'}
            onChange={() => setTransport('auto')}
            className=""
            style={{ accentColor: 'var(--amber)' }}
          />
          {m?.transportAuto ?? 'auto (recommended)'}
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="transport"
            checked={transport === 'stdio'}
            onChange={() => setTransport('stdio')}
            className=""
            style={{ accentColor: 'var(--amber)' }}
          />
          {m?.transportStdio ?? 'stdio'}
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="transport"
            checked={transport === 'http'}
            onChange={() => setTransport('http')}
            className=""
            style={{ accentColor: 'var(--amber)' }}
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
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background font-mono text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <label className="text-muted-foreground">{m?.httpToken ?? 'Auth Token'}</label>
            <input
              type="password"
              value={httpToken}
              onChange={e => setHttpToken(e.target.value)}
              placeholder="Bearer token"
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background font-mono text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>
      )}

      {/* Install button */}
      <button
        onClick={handleInstall}
        disabled={selected.size === 0 || installing}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
      >
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

/* ── Skills Section ────────────────────────────────────────────── */

const SKILL_TEMPLATES: Record<string, (name: string) => string> = {
  general: (n: string) => `---\nname: ${n}\ndescription: >\n  Describe WHEN the agent should use this\n  skill. Be specific about trigger conditions.\n---\n\n# Instructions\n\n## Context\n<!-- Background knowledge for the agent -->\n\n## Steps\n1. \n2. \n\n## Rules\n<!-- Constraints, edge cases, formats -->\n- `,
  'tool-use': (n: string) => `---\nname: ${n}\ndescription: >\n  Describe WHEN the agent should use this\n  skill. Be specific about trigger conditions.\n---\n\n# Instructions\n\n## Available Tools\n<!-- List tools the agent can use -->\n- \n\n## When to Use\n<!-- Conditions that trigger this skill -->\n\n## Output Format\n<!-- Expected response structure -->\n`,
  workflow: (n: string) => `---\nname: ${n}\ndescription: >\n  Describe WHEN the agent should use this\n  skill. Be specific about trigger conditions.\n---\n\n# Instructions\n\n## Trigger\n<!-- What triggers this workflow -->\n\n## Steps\n1. \n2. \n\n## Validation\n<!-- How to verify success -->\n\n## Rollback\n<!-- What to do on failure -->\n`,
};

function SkillsSection({ t }: { t: any }) {
  const m = t.settings?.mcp;
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // New state for search, grouping, full content, editing
  const [search, setSearch] = useState('');
  const [builtinCollapsed, setBuiltinCollapsed] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [fullContent, setFullContent] = useState<Record<string, string>>({});
  const [loadingContent, setLoadingContent] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<'general' | 'tool-use' | 'workflow'>('general');

  const fetchSkills = useCallback(async () => {
    try {
      const data = await apiFetch<{ skills: SkillInfo[] }>('/api/skills');
      setSkills(data.skills);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  // Filtered + grouped
  const filtered = useMemo(() => {
    if (!search) return skills;
    const q = search.toLowerCase();
    return skills.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }, [skills, search]);

  const customSkills = useMemo(() => filtered.filter(s => s.source === 'user'), [filtered]);
  const builtinSkills = useMemo(() => filtered.filter(s => s.source === 'builtin'), [filtered]);

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
      setFullContent(prev => { const n = { ...prev }; delete n[name]; return n; });
      if (editing === name) setEditing(null);
      if (expanded === name) setExpanded(null);
      fetchSkills();
    } catch { /* ignore */ }
  };

  const loadFullContent = async (name: string) => {
    if (fullContent[name]) return;
    setLoadingContent(name);
    try {
      const data = await apiFetch<{ content: string }>('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'read', name }),
      });
      setFullContent(prev => ({ ...prev, [name]: data.content }));
    } catch {
      // Store empty marker so UI shows "No description" rather than stuck loading
      setFullContent(prev => ({ ...prev, [name]: '' }));
    } finally {
      setLoadingContent(null);
    }
  };

  const handleExpand = (name: string) => {
    const next = expanded === name ? null : name;
    setExpanded(next);
    if (next) loadFullContent(name);
    if (editing && editing !== name) setEditing(null);
  };

  const handleEditStart = (name: string) => {
    setEditing(name);
    setEditContent(fullContent[name] || '');
  };

  const handleEditSave = async (name: string) => {
    setSaving(true);
    try {
      await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', name, content: editContent }),
      });
      setFullContent(prev => ({ ...prev, [name]: editContent }));
      setEditing(null);
      fetchSkills(); // refresh description from updated frontmatter
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  };

  const handleEditCancel = () => {
    setEditing(null);
    setEditContent('');
  };

  const getTemplate = (skillName: string, tmpl?: string) => {
    const key = tmpl || selectedTemplate;
    const fn = SKILL_TEMPLATES[key] || SKILL_TEMPLATES.general;
    return fn(skillName || 'my-skill');
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    setError('');
    try {
      // Content is the full SKILL.md (with frontmatter)
      const content = newContent || getTemplate(newName.trim());
      await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: newName.trim(), content }),
      });
      setAdding(false);
      setNewName('');
      setNewContent('');
      fetchSkills();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create skill');
    } finally {
      setSaving(false);
    }
  };

  // Sync template name when newName changes (only if content matches a template)
  const handleNameChange = (val: string) => {
    const cleaned = val.replace(/[^a-z0-9-]/g, '');
    const oldTemplate = getTemplate(newName || 'my-skill');
    if (!newContent || newContent === oldTemplate) {
      setNewContent(getTemplate(cleaned || 'my-skill'));
    }
    setNewName(cleaned);
  };

  const handleTemplateChange = (tmpl: 'general' | 'tool-use' | 'workflow') => {
    const oldTemplate = getTemplate(newName || 'my-skill', selectedTemplate);
    setSelectedTemplate(tmpl);
    // Only replace content if it matches the old template (user hasn't customized)
    if (!newContent || newContent === oldTemplate) {
      setNewContent(getTemplate(newName || 'my-skill', tmpl));
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderSkillRow = (skill: SkillInfo) => (
    <div key={skill.name} className="border border-border rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => handleExpand(skill.name)}
      >
        {expanded === skill.name ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="text-xs font-medium flex-1">{skill.name}</span>
        <span className={`text-2xs px-1.5 py-0.5 rounded ${
          skill.source === 'builtin' ? 'bg-blue-500/15 text-blue-500' : 'bg-purple-500/15 text-purple-500'
        }`}>
          {skill.source === 'builtin' ? (m?.skillBuiltin ?? 'Built-in') : (m?.skillUser ?? 'Custom')}
        </span>
        <button
          onClick={e => { e.stopPropagation(); handleToggle(skill.name, !skill.enabled); }}
          className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
            skill.enabled ? 'bg-success' : 'bg-muted-foreground/30'
          }`}
        >
          <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
            skill.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
          }`} />
        </button>
      </div>

      {expanded === skill.name && (
        <div className="px-3 py-2 border-t border-border text-xs space-y-2 bg-muted/20">
          <p className="text-muted-foreground">{skill.description || 'No description'}</p>
          <p className="text-muted-foreground font-mono text-2xs">{skill.path}</p>

          {/* Full content display / edit */}
          {loadingContent === skill.name ? (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 size={10} className="animate-spin" />
              <span className="text-2xs">Loading...</span>
            </div>
          ) : fullContent[skill.name] ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-2xs text-muted-foreground font-medium">{m?.skillContent ?? 'Content'}</span>
                <div className="flex items-center gap-2">
                  {skill.editable && editing !== skill.name && (
                    <button
                      onClick={() => handleEditStart(skill.name)}
                      className="flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil size={10} />
                      {m?.editSkill ?? 'Edit'}
                    </button>
                  )}
                  {skill.editable && (
                    <button
                      onClick={() => handleDelete(skill.name)}
                      className="flex items-center gap-1 text-2xs text-destructive hover:underline"
                    >
                      <Trash2 size={10} />
                      {m?.deleteSkill ?? 'Delete'}
                    </button>
                  )}
                </div>
              </div>

              {editing === skill.name ? (
                <div className="space-y-1.5">
                  <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    rows={Math.min(20, (editContent.match(/\n/g) || []).length + 3)}
                    className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y font-mono"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditSave(skill.name)}
                      disabled={saving}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
                    >
                      {saving && <Loader2 size={10} className="animate-spin" />}
                      {m?.saveSkill ?? 'Save'}
                    </button>
                    <button
                      onClick={handleEditCancel}
                      className="px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {m?.cancelSkill ?? 'Cancel'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="w-full rounded-md border border-border bg-background/50 max-h-[300px] overflow-y-auto px-2.5 py-1.5 text-xs [&_.prose]:max-w-none [&_.prose]:text-xs [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_pre]:text-2xs [&_code]:text-2xs">
                  <MarkdownView content={fullContent[skill.name].replace(/^---\n[\s\S]*?\n---\n*/, '')} />
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3 pt-2">
      {/* Search */}
      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={m?.searchSkills ?? 'Search skills...'}
          className="w-full pl-7 pr-2.5 py-1.5 text-xs rounded-md border border-border bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X size={10} />
          </button>
        )}
      </div>

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

      {/* Empty search result */}
      {filtered.length === 0 && search && (
        <p className="text-xs text-muted-foreground text-center py-3">
          {m?.noSkillsMatch ? m.noSkillsMatch(search) : `No skills match "${search}"`}
        </p>
      )}

      {/* Custom group — always open */}
      {customSkills.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span>{m?.customGroup ?? 'Custom'} ({customSkills.length})</span>
          </div>
          <div className="space-y-1.5">
            {customSkills.map(renderSkillRow)}
          </div>
        </div>
      )}

      {/* Built-in group — collapsible, default collapsed */}
      {builtinSkills.length > 0 && (
        <div className="space-y-1.5">
          <div
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
            onClick={() => setBuiltinCollapsed(!builtinCollapsed)}
          >
            {builtinCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span>{m?.builtinGroup ?? 'Built-in'} ({builtinSkills.length})</span>
          </div>
          {!builtinCollapsed && (
            <div className="space-y-1.5">
              {builtinSkills.map(renderSkillRow)}
            </div>
          )}
        </div>
      )}

      {/* Add skill form — template-based */}
      {adding ? (
        <div className="border border-border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">{m?.addSkill ?? '+ Add Skill'}</span>
            <button onClick={() => { setAdding(false); setNewName(''); setNewContent(''); setError(''); }} className="p-0.5 rounded hover:bg-muted text-muted-foreground">
              <X size={12} />
            </button>
          </div>
          <div className="space-y-1">
            <label className="text-2xs text-muted-foreground">{m?.skillName ?? 'Name'}</label>
            <input
              type="text"
              value={newName}
              onChange={e => handleNameChange(e.target.value)}
              placeholder="my-skill"
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background font-mono text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-1">
            <label className="text-2xs text-muted-foreground">{m?.skillTemplate ?? 'Template'}</label>
            <div className="flex rounded-md border border-border overflow-hidden w-fit">
              {(['general', 'tool-use', 'workflow'] as const).map((tmpl, i) => (
                <button
                  key={tmpl}
                  onClick={() => handleTemplateChange(tmpl)}
                  className={`px-2.5 py-1 text-xs transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                    selectedTemplate === tmpl
                      ? 'bg-amber-500/15 text-amber-600 font-medium'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {tmpl === 'general' ? (m?.skillTemplateGeneral ?? 'General')
                    : tmpl === 'tool-use' ? (m?.skillTemplateToolUse ?? 'Tool-use')
                    : (m?.skillTemplateWorkflow ?? 'Workflow')}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-2xs text-muted-foreground">{m?.skillContent ?? 'Content'}</label>
            <textarea
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              rows={16}
              placeholder="Skill instructions (markdown)..."
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y font-mono"
            />
          </div>
          {error && (
            <p className="text-2xs text-destructive flex items-center gap-1">
              <AlertCircle size={10} />
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || saving}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
            >
              {saving && <Loader2 size={10} className="animate-spin" />}
              {m?.saveSkill ?? 'Save'}
            </button>
            <button
              onClick={() => { setAdding(false); setNewName(''); setNewContent(''); setError(''); }}
              className="px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              {m?.cancelSkill ?? 'Cancel'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setAdding(true); setSelectedTemplate('general'); setNewContent(getTemplate('my-skill', 'general')); }}
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
  const [showAgents, setShowAgents] = useState(false);
  const [showSkills, setShowSkills] = useState(false);

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

  const m = t.settings?.mcp;

  return (
    <div className="space-y-6">
      {/* MCP Server Status — prominent card */}
      <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
        <ServerStatus status={mcpStatus} agents={agents} t={t} />
      </div>

      {/* Agent Install — collapsible */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
        <button
          type="button"
          onClick={() => setShowAgents(!showAgents)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
          style={{ color: 'var(--foreground)' }}
        >
          <span>{m?.agentsTitle ?? 'Agent Configuration'}</span>
          <ChevronDown size={14} className={`transition-transform text-muted-foreground ${showAgents ? 'rotate-180' : ''}`} />
        </button>
        {showAgents && (
          <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--border)' }}>
            <AgentInstall agents={agents} t={t} onRefresh={fetchAll} />
          </div>
        )}
      </div>

      {/* Skills — collapsible */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
        <button
          type="button"
          onClick={() => setShowSkills(!showSkills)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
          style={{ color: 'var(--foreground)' }}
        >
          <span>{m?.skillsTitle ?? 'Skills'}</span>
          <ChevronDown size={14} className={`transition-transform text-muted-foreground ${showSkills ? 'rotate-180' : ''}`} />
        </button>
        {showSkills && (
          <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--border)' }}>
            <SkillsSection t={t} />
          </div>
        )}
      </div>
    </div>
  );
}
