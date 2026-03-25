'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Server, ShieldCheck, Activity, Compass, Search, Copy, Check, RefreshCw, Loader2, Save } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import { useMcpData } from '@/hooks/useMcpData';
import { apiFetch } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { generateSnippet } from '@/lib/mcp-snippets';
import { filterSkillsForAgentDetail, resolveAgentStatus, type AgentDetailSkillSourceFilter } from './agents-content-model';

export default function AgentDetailContent({ agentKey }: { agentKey: string }) {
  const { t } = useLocale();
  const a = t.agentsContent;
  const mcp = useMcpData();

  const agent = useMemo(() => mcp.agents.find((item) => item.key === agentKey), [mcp.agents, agentKey]);
  const [skillQuery, setSkillQuery] = useState('');
  const [skillSource, setSkillSource] = useState<AgentDetailSkillSourceFilter>('all');
  const [skillBusy, setSkillBusy] = useState<string | null>(null);
  const [editingSkill, setEditingSkill] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpMessage, setMcpMessage] = useState<string | null>(null);

  const [targetScope, setTargetScope] = useState<'project' | 'global'>('global');
  const [targetTransport, setTargetTransport] = useState<'stdio' | 'http'>('stdio');

  const filteredSkills = useMemo(
    () =>
      filterSkillsForAgentDetail(mcp.skills, {
        query: skillQuery,
        source: skillSource,
      }),
    [mcp.skills, skillQuery, skillSource],
  );

  const skillSummary = useMemo(
    () => ({
      total: mcp.skills.length,
      enabled: mcp.skills.filter((s) => s.enabled).length,
      builtin: mcp.skills.filter((s) => s.source === 'builtin').length,
      user: mcp.skills.filter((s) => s.source === 'user').length,
    }),
    [mcp.skills],
  );

  if (!agent) {
    return (
      <div className="content-width px-4 md:px-6 py-8 md:py-10">
        <Link href="/agents" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft size={14} />
          {a.backToOverview}
        </Link>
        <div className="rounded-lg border border-border bg-card p-6">
          <p className="text-sm text-foreground">{a.detailNotFound}</p>
        </div>
      </div>
    );
  }

  const status = resolveAgentStatus(agent);
  const currentScope = agent.scope === 'project' ? 'project' : 'global';
  const currentTransport: 'stdio' | 'http' = agent.transport === 'http' ? 'http' : 'stdio';
  const snippet = generateSnippet(agent, mcp.status, currentTransport);
  const nativeInstalledSkills = agent.installedSkillNames ?? [];
  const configuredMcpServers = agent.configuredMcpServers ?? [];
  const healthStrip = [
    { label: a.detail.healthConnected, value: agent.present && agent.installed ? a.detail.yes : a.detail.no, tone: agent.present && agent.installed ? 'ok' : 'warn' as const },
    { label: a.detail.healthInstalled, value: agent.installed ? a.detail.yes : a.detail.no, tone: agent.installed ? 'ok' : 'warn' as const },
    { label: a.detail.healthRuntimeSignals, value: agent.runtimeConversationSignal || agent.runtimeUsageSignal ? a.detail.yes : a.detail.no, tone: agent.runtimeConversationSignal || agent.runtimeUsageSignal ? 'ok' : 'warn' as const },
    { label: a.detail.healthConfiguredServers, value: String(configuredMcpServers.length), tone: configuredMcpServers.length > 0 ? 'ok' : 'warn' as const },
    { label: a.detail.healthInstalledSkills, value: String(nativeInstalledSkills.length), tone: nativeInstalledSkills.length > 0 ? 'ok' : 'warn' as const },
  ];

  useEffect(() => {
    setTargetScope(currentScope);
    setTargetTransport(currentTransport);
  }, [currentScope, currentTransport, agent.key]);

  async function handleSkillToggle(name: string, enabled: boolean) {
    setSkillBusy(name);
    setEditError(null);
    try {
      await mcp.toggleSkill(name, enabled);
      await mcp.refresh();
    } finally {
      setSkillBusy(null);
    }
  }

  async function handleStartEditSkill(name: string) {
    setEditError(null);
    setSkillBusy(name);
    try {
      const res = await apiFetch<{ content: string }>('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'read', name }),
      });
      setEditingSkill(name);
      setEditContent(res.content);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : a.detail.skillReadFailed);
    } finally {
      setSkillBusy(null);
    }
  }

  async function handleSaveSkill() {
    if (!editingSkill) return;
    setSaveBusy(true);
    setEditError(null);
    try {
      await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', name: editingSkill, content: editContent }),
      });
      setEditingSkill(null);
      setEditContent('');
      window.dispatchEvent(new Event('mindos:skills-changed'));
      await mcp.refresh();
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : a.detail.skillSaveFailed);
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleCopySnippet() {
    const ok = await copyToClipboard(snippet.snippet);
    if (!ok) return;
    setSnippetCopied(true);
    setTimeout(() => setSnippetCopied(false), 1200);
  }

  async function handleApplyMcpConfig(scope: 'project' | 'global', transport: 'stdio' | 'http') {
    setMcpBusy(true);
    setMcpMessage(a.detail.mcpApplying);
    try {
      const ok = await mcp.installAgent(agent.key, { scope, transport });
      await mcp.refresh();
      setMcpMessage(ok ? a.detail.mcpApplySuccess : a.detail.mcpApplyFailed);
    } finally {
      setMcpBusy(false);
    }
  }

  return (
    <div className="content-width px-4 md:px-6 py-8 md:py-10 space-y-4">
      <div>
        <Link href="/agents" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft size={14} />
          {a.backToOverview}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight font-display text-foreground">{agent.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{a.detailSubtitle}</p>
      </div>
      <section className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h2 className="text-sm font-medium text-foreground">{a.detail.healthStripTitle}</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {healthStrip.map((item) => (
            <div key={item.label} className="rounded-md border border-border bg-background px-3 py-2">
              <p className="text-2xs text-muted-foreground mb-1">{item.label}</p>
              <p className={`text-sm font-medium ${item.tone === 'ok' ? 'text-success' : 'text-[var(--amber)]'}`}>{item.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground mb-2">{a.detail.identity}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <DetailLine label={a.detail.agentKey} value={agent.key} />
          <DetailLine label={a.detail.status} value={status} />
          <DetailLine label={a.detail.transport} value={agent.transport ?? agent.preferredTransport} />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
          <Server size={14} className="text-muted-foreground" />
          {a.detail.connection}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <DetailLine label={a.detail.endpoint} value={mcp.status?.endpoint ?? a.na} />
          <DetailLine label={a.detail.port} value={String(mcp.status?.port ?? a.na)} />
          <DetailLine label={a.detail.auth} value={mcp.status?.authConfigured ? a.detail.authConfigured : a.detail.authMissing} />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
          <ShieldCheck size={14} className="text-muted-foreground" />
          {a.detail.capabilities}
        </h2>
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>{a.detail.projectScope}: {agent.hasProjectScope ? a.detail.yes : a.detail.no}</li>
          <li>{a.detail.globalScope}: {agent.hasGlobalScope ? a.detail.yes : a.detail.no}</li>
          <li>{a.detail.format}: {agent.format}</li>
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground mb-2">{a.detail.skillAssignments}</h2>
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-background p-3 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{a.detail.nativeInstalledSkills}</p>
            <p className="text-2xs text-muted-foreground">
              {a.detail.nativeInstalledSkillsCount(nativeInstalledSkills.length)}
            </p>
            {nativeInstalledSkills.length === 0 ? (
              <p className="text-xs text-muted-foreground">{a.detail.nativeInstalledSkillsEmpty}</p>
            ) : (
              <ul className="text-xs text-muted-foreground space-y-1">
                {nativeInstalledSkills.slice(0, 8).map((name) => (
                  <li key={name}>- {name}</li>
                ))}
                {nativeInstalledSkills.length > 8 ? (
                  <li>{a.detail.nativeInstalledSkillsMore(nativeInstalledSkills.length - 8)}</li>
                ) : null}
              </ul>
            )}
            <p className="text-2xs text-muted-foreground">{agent.installedSkillSourcePath ?? a.na}</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
            <div className="rounded-md border border-border px-2 py-1.5">{a.detail.skillsAll}: {skillSummary.total}</div>
            <div className="rounded-md border border-border px-2 py-1.5">{a.detail.skillsEnabled}: {skillSummary.enabled}</div>
            <div className="rounded-md border border-border px-2 py-1.5">{a.detail.skillsSourceBuiltin}: {skillSummary.builtin}</div>
            <div className="rounded-md border border-border px-2 py-1.5">{a.detail.skillsSourceUser}: {skillSummary.user}</div>
          </div>

          <div className="flex flex-col md:flex-row gap-2">
            <label className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={skillQuery}
                onChange={(e) => setSkillQuery(e.target.value)}
                placeholder={a.detail.skillsSearchPlaceholder}
                className="w-full h-9 rounded-md border border-border bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <div className="flex items-center gap-1 rounded-md border border-border p-1 bg-background">
              <FilterChip active={skillSource === 'all'} label={a.detail.skillsFilterAll} onClick={() => setSkillSource('all')} />
              <FilterChip active={skillSource === 'builtin'} label={a.detail.skillsFilterBuiltin} onClick={() => setSkillSource('builtin')} />
              <FilterChip active={skillSource === 'user'} label={a.detail.skillsFilterUser} onClick={() => setSkillSource('user')} />
            </div>
          </div>

          {filteredSkills.length === 0 ? (
            <p className="text-sm text-muted-foreground">{a.detail.noSkills}</p>
          ) : (
            <ul className="space-y-2">
              {filteredSkills.map((skill) => {
                const isEditing = editingSkill === skill.name;
                return (
                  <li key={skill.name} className="rounded-md border border-border p-3">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                      <div>
                        <p className="text-sm text-foreground">{skill.name}</p>
                        <p className="text-2xs text-muted-foreground">{skill.source === 'builtin' ? a.detail.skillsSourceBuiltin : a.detail.skillsSourceUser}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleSkillToggle(skill.name, !skill.enabled)}
                          disabled={skillBusy === skill.name}
                          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {skillBusy === skill.name ? a.detail.skillActionLoading : skill.enabled ? a.detail.skillDisable : a.detail.skillEnable}
                        </button>
                        {skill.editable ? (
                          <button
                            type="button"
                            onClick={() => void handleStartEditSkill(skill.name)}
                            disabled={skillBusy === skill.name || saveBusy}
                            className="text-xs px-2 py-1 rounded border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {skillBusy === skill.name ? a.detail.skillActionLoading : a.detail.skillEdit}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {isEditing ? (
                      <div className="mt-2 space-y-2">
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="w-full h-40 rounded-md border border-border bg-background px-3 py-2 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleSaveSkill()}
                            disabled={saveBusy}
                            className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {saveBusy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                            {a.detail.skillSave}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingSkill(null)}
                            className="text-xs px-2 py-1 rounded border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {a.detail.skillCancel}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {editError ? <p className="text-xs text-error">{editError}</p> : null}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
          <Activity size={14} className="text-muted-foreground" />
          {a.detail.runtimeSignals}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <DetailLine label={a.detail.skillMode} value={agent.skillMode ?? a.na} />
          <DetailLine label={a.detail.hiddenRoot} value={agent.hiddenRootPath ?? a.na} />
          <DetailLine label={a.detail.hiddenRootPresent} value={agent.hiddenRootPresent ? a.detail.yes : a.detail.no} />
          <DetailLine label={a.detail.conversationSignal} value={agent.runtimeConversationSignal ? a.detail.yes : a.detail.no} />
          <DetailLine label={a.detail.usageSignal} value={agent.runtimeUsageSignal ? a.detail.yes : a.detail.no} />
          <DetailLine label={a.detail.lastActivityAt} value={agent.runtimeLastActivityAt ?? a.na} />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-medium text-foreground mb-1 flex items-center gap-1.5">
          <Server size={14} className="text-muted-foreground" />
          {a.detail.mcpManagement}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <DetailLine label={a.detail.mcpInstalled} value={agent.installed ? a.detail.yes : a.detail.no} />
          <DetailLine label={a.detail.mcpScope} value={agent.scope ?? a.na} />
          <DetailLine label={a.detail.mcpConfigPath} value={agent.configPath ?? a.na} />
        </div>
        <div className="rounded-md border border-border bg-background p-3 space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{a.detail.configuredMcpServers}</p>
          <p className="text-2xs text-muted-foreground">
            {a.detail.configuredMcpServersCount(configuredMcpServers.length)}
          </p>
          {configuredMcpServers.length === 0 ? (
            <p className="text-xs text-muted-foreground">{a.detail.configuredMcpServersEmpty}</p>
          ) : (
            <ul className="text-xs text-muted-foreground space-y-1">
              {configuredMcpServers.slice(0, 8).map((name) => (
                <li key={name}>- {name}</li>
              ))}
              {configuredMcpServers.length > 8 ? (
                <li>{a.detail.configuredMcpServersMore(configuredMcpServers.length - 8)}</li>
              ) : null}
            </ul>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">
            {a.detail.mcpTargetScope}
            <select
              value={targetScope}
              onChange={(e) => setTargetScope(e.target.value as 'project' | 'global')}
              className="mt-1 w-full h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="project" disabled={!agent.hasProjectScope}>{a.detail.mcpScopeProject}</option>
              <option value="global" disabled={!agent.hasGlobalScope}>{a.detail.mcpScopeGlobal}</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            {a.detail.mcpTargetTransport}
            <select
              value={targetTransport}
              onChange={(e) => setTargetTransport(e.target.value as 'stdio' | 'http')}
              className="mt-1 w-full h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="stdio">stdio</option>
              <option value="http">http</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCopySnippet()}
            className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {snippetCopied ? <Check size={12} /> : <Copy size={12} />}
            {snippetCopied ? a.detail.mcpCopied : a.detail.mcpCopySnippet}
          </button>
          <button
            type="button"
            onClick={() => void mcp.refresh()}
            className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw size={12} />
            {a.detail.mcpRefresh}
          </button>
          <button
            type="button"
            onClick={() => void handleApplyMcpConfig(targetScope, targetTransport)}
            disabled={mcpBusy}
            className="text-xs px-2 py-1 rounded border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {a.detail.mcpReconnect}
          </button>
        </div>
        <p className="text-2xs text-muted-foreground">{snippet.path}</p>
        {mcpMessage ? <p className="text-xs text-muted-foreground">{mcpMessage}</p> : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
          <Activity size={14} className="text-muted-foreground" />
          {a.detail.recentActivity}
        </h2>
        <p className="text-sm text-muted-foreground">{a.detail.noActivity}</p>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
          <Compass size={14} className="text-muted-foreground" />
          {a.detail.spaceReach}
        </h2>
        <p className="text-sm text-muted-foreground">{a.detail.noSpaceReach}</p>
      </section>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-2xs text-muted-foreground mb-1">{label}</p>
      <p className="text-sm text-foreground truncate">{value}</p>
    </div>
  );
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 h-7 rounded text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? 'bg-[var(--amber-dim)] text-[var(--amber)]' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
    >
      {label}
    </button>
  );
}
