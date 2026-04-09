'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import {
  ArrowLeft, Globe, Loader2, MoreHorizontal, Pencil, Server, Search,
  Trash2, Wifi, WifiOff, Zap, Copy, AlertTriangle,
} from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { toast } from '@/lib/toast';
import { encodePath } from '@/lib/utils';
import { useMcpData } from '@/lib/stores/mcp-store';
import { useA2aRegistry } from '@/hooks/useA2aRegistry';
import { apiFetch } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { generateSnippet } from '@/lib/mcp-snippets';
import type { AgentInfo } from '../settings/types';
import {
  aggregateCrossAgentMcpServers,
  aggregateCrossAgentSkills,
  filterSkillsForAgentDetail,
  resolveAgentStatus,
  type AgentDetailSkillSourceFilter,
} from './agents-content-model';
import { AgentAvatar, ActionButton, ConfirmDialog, PillButton } from './AgentsPrimitives';
import SkillDetailPopover from './SkillDetailPopover';
import CustomAgentModal from './CustomAgentModal';
import { DetailLine, formatRelativeTime } from './agent-detail-primitives';
import RuntimeDiagSection from './RuntimeDiagSection';
import EnvPermSection from './EnvPermSection';
import KnowledgeInteractionSection from './KnowledgeInteractionSection';
import ActivitySection from './ActivitySection';

export default function AgentDetailContent({ agentKey }: { agentKey: string }) {
  const { t } = useLocale();
  const a = t.agentsContent;
  const p = t.panels.agents;
  const mcp = useMcpData();
  const a2a = useA2aRegistry();

  const agent = useMemo(() => mcp.agents.find((item) => item.key === agentKey), [mcp.agents, agentKey]);
  const [skillQuery, setSkillQuery] = useState('');
  const [skillSource, setSkillSource] = useState<AgentDetailSkillSourceFilter>('all');
  const [skillBusy, setSkillBusy] = useState<string | null>(null);
  const [editingSkill, setEditingSkill] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpMessage, setMcpMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [confirmMcpRemove, setConfirmMcpRemove] = useState<string | null>(null);
  const [mcpHint, setMcpHint] = useState<string | null>(null);
  const [detailSkillName, setDetailSkillName] = useState<string | null>(null);

  // Custom agent actions
  const [customEditOpen, setCustomEditOpen] = useState(false);
  const [confirmCustomRemove, setConfirmCustomRemove] = useState(false);

  const handleCustomRemoveConfirmed = useCallback(async () => {
    if (!agent?.isCustom) return;
    try {
      const res = await fetch('/api/agents/custom', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: agent.key }),
      });
      if (res.ok) {
        toast.success(a.overview.customAgentRemoved(agent.name));
        mcp.refresh();
        window.location.href = '/agents';
      } else {
        const data = await res.json();
        toast.error(data.error || a.overview.customAgentFailedRemove);
      }
    } catch {
      toast.error(a.overview.customAgentNetworkError);
    } finally {
      setConfirmCustomRemove(false);
    }
  }, [agent, a.overview, mcp]);

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

  const crossAgentMcpMap = useMemo(() => {
    const all = aggregateCrossAgentMcpServers(mcp.agents);
    const map = new Map<string, string[]>();
    for (const srv of all) map.set(srv.serverName, srv.agents);
    return map;
  }, [mcp.agents]);

  const crossAgentSkillMap = useMemo(() => {
    const all = aggregateCrossAgentSkills(mcp.agents);
    const map = new Map<string, string[]>();
    for (const sk of all) map.set(sk.skillName, sk.agents);
    return map;
  }, [mcp.agents]);

  const isMindOS = agentKey === 'mindos';
  const status = agent ? resolveAgentStatus(agent) : 'notFound';
  const currentScope = agent?.scope === 'project' ? 'project' : 'global';
  const currentTransport: 'stdio' | 'http' = agent?.transport === 'http' ? 'http' : 'stdio';
  const snippet = useMemo(
    () => agent ? generateSnippet(agent, mcp.status, currentTransport) : { snippet: '', path: '' },
    [agent, mcp.status, currentTransport],
  );
  const mindosSkillNames = useMemo(() => new Set(mcp.skills.map((s) => s.name)), [mcp.skills]);
  const nativeInstalledSkills = useMemo(
    () => (agent?.installedSkillNames ?? []).filter((n) => !mindosSkillNames.has(n)),
    [agent?.installedSkillNames, mindosSkillNames],
  );
  const configuredMcpServers = agent?.configuredMcpServers ?? [];


  const handleSkillToggle = useCallback(async (name: string, enabled: boolean) => {
    setSkillBusy(name);
    setEditError(null);
    try {
      await mcp.toggleSkill(name, enabled);
      await mcp.refresh();
    } finally {
      setSkillBusy(null);
    }
  }, [mcp]);

  const handleStartEditSkill = useCallback(async (name: string) => {
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
  }, [a.detail.skillReadFailed]);

  const handleSaveSkill = useCallback(async () => {
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
  }, [editingSkill, editContent, a.detail.skillSaveFailed, mcp]);

  const handleDeleteSkill = useCallback(async (name: string) => {
    setConfirmDelete(null);
    setSkillBusy(name);
    try {
      await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', name }),
      });
      setDeleteMsg(a.detail.skillDeleteSuccess);
      window.dispatchEvent(new Event('mindos:skills-changed'));
      await mcp.refresh();
    } catch {
      setDeleteMsg(a.detail.skillDeleteFailed);
    } finally {
      setSkillBusy(null);
      setTimeout(() => setDeleteMsg(null), 3000);
    }
  }, [a.detail.skillDeleteSuccess, a.detail.skillDeleteFailed, mcp]);

  const handleCopySkillToAgent = useCallback(async (skillName: string) => {
    if (!agent?.skillWorkspacePath) return;
    setSkillBusy(skillName);
    setEditError(null);
    try {
      const res = await apiFetch<{ success: boolean; targetPath?: string }>(
        '/api/agents/copy-skill',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skillName,
            targetPath: agent.skillWorkspacePath,
          }),
        }
      );
      if (res.success) {
        toast.success(`Skill "${skillName}" copied to ${agent.name}`);
        await mcp.refresh();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to copy skill';
      setEditError(msg);
      toast.error(msg);
    } finally {
      setSkillBusy(null);
    }
  }, [agent, mcp]);

  const handleCopySnippet = useCallback(async () => {
    const ok = await copyToClipboard(snippet.snippet);
    if (ok) toast.copy();
  }, [snippet.snippet]);

  const handleApplyMcpConfig = useCallback(async (scope: 'project' | 'global', transport: 'stdio' | 'http') => {
    if (!agent) return;
    setMcpBusy(true);
    setMcpMessage(a.detail.mcpApplying);
    try {
      const ok = await mcp.installAgent(agent.key, { scope, transport });
      await mcp.refresh();
      setMcpMessage(ok ? a.detail.mcpApplySuccess : a.detail.mcpApplyFailed);
    } finally {
      setMcpBusy(false);
    }
  }, [a.detail.mcpApplying, a.detail.mcpApplySuccess, a.detail.mcpApplyFailed, mcp, agent]);

  const handleDeleteSkillFromPopover = useCallback(async (name: string) => {
    await apiFetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', name }),
    });
    window.dispatchEvent(new Event('mindos:skills-changed'));
    await mcp.refresh();
  }, [mcp]);

  const handleMcpRemoveConfirm = useCallback(() => {
    setConfirmMcpRemove(null);
    setMcpHint(a.detail.mcpServerHint);
    setTimeout(() => setMcpHint(null), 4000);
  }, [a.detail.mcpServerHint]);

  if (!agent) {
    const connectedAgents = mcp.agents
      .filter((ag) => ag.key !== agentKey && resolveAgentStatus(ag) === 'connected')
      .slice(0, 3);

    return (
      <div className="content-width px-4 md:px-6 py-8 md:py-10">
        <Link href="/agents" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft size={14} />
          {a.backToOverview}
        </Link>
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <p className="text-sm text-foreground font-medium">{a.detailNotFound}</p>
          <p className="text-xs text-muted-foreground">{a.detailNotFoundHint}</p>
          {connectedAgents.length > 0 && (
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground mb-2">{a.detailNotFoundSuggestion}</p>
              <div className="flex flex-wrap gap-2">
                {connectedAgents.map((ag) => (
                  <Link
                    key={ag.key}
                    href={`/agents/${encodeURIComponent(ag.key)}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
                  >
                    {ag.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }


  return (
    <div className="content-width px-4 md:px-6 py-8 md:py-10 space-y-4">
      {/* Back link */}
      <Link href="/agents" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} />
        {a.backToOverview}
      </Link>

      {/* ═══════════ AGENT PROFILE ═══════════ */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-3.5 px-5 py-4">
          <AgentAvatar name={agent.name} status={status} size="md" />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight text-foreground truncate">{agent.name}</h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-2xs text-muted-foreground/60">
              <span className={`font-medium px-1.5 py-px rounded-full ${
                status === 'connected' ? 'bg-muted text-muted-foreground'
                  : status === 'detected' ? 'bg-[var(--amber-subtle)] text-[var(--amber-text)]'
                    : 'bg-error/10 text-error'
              }`}>{status}</span>
              <span className="font-mono">{agent.transport ?? agent.preferredTransport}</span>
              <span className="text-muted-foreground/25" aria-hidden="true">·</span>
              <span>{agent.skillMode ?? a.na}</span>
            </div>
          </div>
          {agent.isCustom && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setCustomEditOpen(true)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={a.overview.customAgentEdit as string}
                title={a.overview.customAgentEdit as string}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                onClick={() => setConfirmCustomRemove(true)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={a.overview.customAgentRemove as string}
                title={a.overview.customAgentRemove as string}
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted-foreground/50 px-5 py-2 border-t border-border/40">
          <span>{agent.format} <span className="text-muted-foreground/30">·</span> {formatRelativeTime(agent.runtimeLastActivityAt)}</span>
          <span className="tabular-nums">{configuredMcpServers.length} MCP <span className="text-muted-foreground/30">·</span> {nativeInstalledSkills.length} skills</span>
        </div>
      </section>

      {/* ═══════════ KNOWLEDGE INTERACTION ═══════════ */}
      <KnowledgeInteractionSection />

      {/* ═══════════ MCP MANAGEMENT ═══════════ */}
      <section className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold text-foreground flex items-center gap-2 shrink-0">
            <div className="w-6 h-6 rounded-md bg-[var(--amber-subtle)] flex items-center justify-center"><Server size={13} className="text-[var(--amber)]" /></div>
            {a.detail.mcpManagement}
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            {!isMindOS && (
              <ActionButton
                onClick={() => void handleCopySnippet()}
                disabled={false}
                busy={false}
                label={a.detail.mcpCopySnippet}
              />
            )}
            <ActionButton
              onClick={() => void mcp.refresh()}
              disabled={false}
              busy={false}
              label={a.detail.mcpRefresh}
            />
            {!isMindOS && (
              <ActionButton
                onClick={() => void handleApplyMcpConfig(currentScope, currentTransport)}
                disabled={mcpBusy}
                busy={mcpBusy}
                label={a.detail.mcpReconnect}
              />
            )}
          </div>
        </div>

        {mcpMessage && <p className="text-2xs text-muted-foreground animate-in fade-in duration-200">{mcpMessage}</p>}

        {/* MCP status metadata */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 py-2 border-y border-border/30">
          {isMindOS ? (
            <>
              <DetailLine label="Status" value={mcp.status?.running ? 'Running' : 'Stopped'} />
              <DetailLine label="Endpoint" value={mcp.status?.endpoint ?? a.na} />
              <DetailLine label="Tools" value={mcp.status?.toolCount != null ? String(mcp.status.toolCount) : a.na} />
            </>
          ) : (
            <>
              <DetailLine label={a.detail.mcpInstalled} value={agent.installed ? a.detail.yes : a.detail.no} />
              <DetailLine label={a.detail.mcpScope} value={agent.scope ?? a.na} />
              <DetailLine label={a.detail.mcpConfigPath} value={agent.configPath ?? a.na} />
            </>
          )}
        </div>

        {/* Configured MCP servers */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-2xs font-medium text-muted-foreground/60 uppercase tracking-wider">{a.detail.configuredMcpServers}</p>
            <span className="text-2xs text-muted-foreground/40 tabular-nums">{configuredMcpServers.length}</span>
          </div>

          {mcpHint && (
            <div role="status" aria-live="polite" className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground animate-in fade-in duration-200">
              {mcpHint}
            </div>
          )}

          {configuredMcpServers.length === 0 ? (
            <p className="text-2xs text-muted-foreground/50">{a.detail.configuredMcpServersEmpty}</p>
          ) : (
            <div className="space-y-1 max-h-[240px] overflow-y-auto">
              {configuredMcpServers.map((name) => {
                const sharedWith = (crossAgentMcpMap.get(name) ?? []).filter((n) => n !== agent.name);
                return (
                  <div key={name} className="flex items-center gap-2 rounded-md px-2 py-1.5 group/mcp hover:bg-muted/30 transition-colors duration-100">
                    <Server size={11} className="text-muted-foreground/40 shrink-0" />
                    <span className="text-xs text-foreground flex-1 min-w-0 truncate">{name}</span>
                    {sharedWith.length > 0 && (
                      <div className="flex items-center gap-0.5">
                        {sharedWith.slice(0, 3).map((n) => (
                          <AgentAvatar key={n} name={n} size="sm" />
                        ))}
                        {sharedWith.length > 3 && <span className="text-2xs text-muted-foreground/50">+{sharedWith.length - 3}</span>}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setConfirmMcpRemove(name)}
                      className="text-muted-foreground/40 hover:text-destructive cursor-pointer opacity-0 group-hover/mcp:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded p-0.5 transition-all duration-150"
                      aria-label={`${a.detail.mcpServerRemove} ${name}`}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ═══════════ SKILL ASSIGNMENTS ═══════════ */}
      <section className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold text-foreground flex items-center gap-2 shrink-0">
            <div className="w-6 h-6 rounded-md bg-[var(--amber-subtle)] flex items-center justify-center"><Zap size={13} className="text-[var(--amber)]" /></div>
            {a.detail.skillAssignments}
          </h2>
          <div className="flex items-center gap-1.5 text-2xs text-muted-foreground/50 tabular-nums">
            <span>{skillSummary.enabled}/{skillSummary.total} enabled</span>
            <span className="text-muted-foreground/25">·</span>
            <span>{nativeInstalledSkills.length} native</span>
          </div>
        </div>

        {/* Search + filters */}
        <div className="flex flex-col md:flex-row gap-2">
          <label className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              value={skillQuery}
              onChange={(e) => setSkillQuery(e.target.value)}
              placeholder={a.detail.skillsSearchPlaceholder}
              className="w-full h-9 rounded-md border border-border bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors duration-150"
            />
          </label>
          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5 bg-background">
            <PillButton active={skillSource === 'all'} label={a.detail.skillsFilterAll} onClick={() => setSkillSource('all')} />
            <PillButton active={skillSource === 'builtin'} label={a.detail.skillsFilterBuiltin} onClick={() => setSkillSource('builtin')} />
            <PillButton active={skillSource === 'user'} label={a.detail.skillsFilterUser} onClick={() => setSkillSource('user')} />
          </div>
        </div>

        {deleteMsg && (
          <div role="status" aria-live="polite" className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground animate-in fade-in duration-200">
            {deleteMsg}
          </div>
        )}

        {/* Unsupported Skill Installation Notice (for agents like QClaw, WorkBuddy) */}
        {agent?.skillMode === 'unsupported' && (
          <div className="rounded-lg border border-[var(--amber)]/20 bg-[var(--amber-dim)] p-3 mb-2">
            <p className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
              <AlertTriangle size={14} className="text-[var(--amber)] shrink-0" aria-hidden="true" />
              Manual Skill Installation
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              This agent doesn&apos;t support <code className="bg-background px-1 py-0.5 rounded text-xs font-mono">npx skills</code>. Copy skills manually:
            </p>
            <div className="bg-background rounded-md px-3 py-2 font-mono text-xs overflow-x-auto border border-border/50 select-all">
              cp -r ~/.mindos/skills/&lt;skill-name&gt; {agent.skillWorkspacePath || '~/.agent/skills/'}
            </div>
          </div>
        )}

        {/* MindOS Skills */}
        {filteredSkills.length > 0 && (
          <div>
            <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              MindOS Skills <span className="tabular-nums">({filteredSkills.filter((s) => s.enabled).length}/{filteredSkills.length})</span>
            </p>
            <ul className="space-y-0.5">
              {filteredSkills.map((skill) => {
                const isEditing = editingSkill === skill.name;
                return (
                  <li key={skill.name} className="rounded-md hover:bg-muted/30 transition-colors duration-100">
                    <div className="flex items-center gap-2 py-1.5 px-1.5 group/skill">
                      <Zap size={13} className={`shrink-0 ${skill.enabled ? 'text-[var(--amber)]' : 'text-muted-foreground/50'}`} aria-hidden="true" />
                      <button
                        type="button"
                        onClick={() => setDetailSkillName(skill.name)}
                        className="text-xs text-foreground flex-1 min-w-0 truncate hover:text-[var(--amber)] cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded text-left"
                      >
                        {skill.name}
                      </button>
                      <span className={`text-2xs px-1.5 py-0.5 rounded shrink-0 ${skill.source === 'builtin' ? 'bg-muted text-muted-foreground' : 'bg-[var(--amber-dim)] text-[var(--amber-text)]'}`}>
                        {skill.source === 'builtin' ? a.detail.skillsSourceBuiltin : a.detail.skillsSourceUser}
                      </span>

                      <div className="flex items-center gap-1 shrink-0 md:opacity-0 md:group-hover/skill:opacity-100 md:focus-within:opacity-100 transition-opacity duration-150">
                        <ActionButton
                          onClick={() => void handleSkillToggle(skill.name, !skill.enabled)}
                          disabled={skillBusy === skill.name}
                          busy={skillBusy === skill.name}
                          label={skill.enabled ? a.detail.skillDisable : a.detail.skillEnable}
                        />
                        {skill.editable && (
                          <>
                            <ActionButton
                              onClick={() => void handleStartEditSkill(skill.name)}
                              disabled={skillBusy === skill.name || saveBusy}
                              busy={false}
                              label={a.detail.skillEdit}
                            />
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(skill.name)}
                              disabled={skillBusy === skill.name}
                              className="inline-flex items-center justify-center min-h-[28px] px-1.5 rounded-md text-muted-foreground hover:text-destructive cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
                              aria-label={`${a.detail.skillDelete} ${skill.name}`}
                            >
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                        {agent?.skillMode === 'unsupported' && (
                          <button
                            type="button"
                            onClick={() => void handleCopySkillToAgent(skill.name)}
                            disabled={skillBusy === skill.name}
                            className="inline-flex items-center justify-center min-h-[28px] px-1.5 rounded-md text-muted-foreground hover:text-[var(--amber)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
                            title={`Copy ${skill.name} to ${agent.name}`}
                            aria-label={`Copy ${skill.name} to ${agent.name}`}
                          >
                            <Copy size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    {isEditing && (
                      <div className="px-3 pb-3 pt-0 space-y-2">
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="mt-2 w-full h-40 rounded-md border border-border bg-background px-3 py-2 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                        />
                        <div className="flex items-center gap-2">
                          <ActionButton onClick={() => void handleSaveSkill()} disabled={saveBusy} busy={saveBusy} label={a.detail.skillSave} variant="primary" />
                          <ActionButton onClick={() => setEditingSkill(null)} disabled={false} busy={false} label={a.detail.skillCancel} />
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {filteredSkills.length === 0 && nativeInstalledSkills.length === 0 && (
          <p className="text-sm text-muted-foreground">{a.detail.noSkills}</p>
        )}

        {/* Native installed skills */}
        {nativeInstalledSkills.length > 0 && (
          <div>
            <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              {a.detail.nativeInstalledSkills} <span className="tabular-nums">({nativeInstalledSkills.length})</span>
            </p>
            <div className="space-y-0.5 max-h-[280px] overflow-y-auto">
              {nativeInstalledSkills.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setDetailSkillName(name)}
                  className="w-full flex items-center gap-2 py-1.5 px-1.5 rounded-md hover:bg-muted/30 transition-colors duration-100 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Zap size={13} className="shrink-0 text-muted-foreground/50" aria-hidden="true" />
                  <span className="text-xs text-foreground flex-1 min-w-0 truncate hover:text-[var(--amber)] transition-colors duration-150">{name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {editError && <p className="text-xs text-error">{editError}</p>}
      </section>

      {/* ═══════════ A2A CAPABILITIES ═══════════ */}
      <section className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold text-foreground flex items-center gap-2 shrink-0">
            <div className="w-6 h-6 rounded-md bg-[var(--amber-subtle)] flex items-center justify-center"><Globe size={13} className="text-[var(--amber)]" /></div>
            {p.a2aCapabilities}
          </h2>
          <span className={`text-2xs px-1.5 py-0.5 rounded font-medium shrink-0 ${
            status === 'connected' ? 'bg-[var(--success)]/15 text-[var(--success)]' : 'bg-muted text-muted-foreground/60'
          }`}>
            {status === 'connected' ? p.a2aConnected : p.a2aUnavailable}
          </span>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 py-2 border-y border-border/30">
          <DetailLine label={p.a2aStatus} value={status === 'connected' ? p.a2aConnected : p.a2aUnavailable} />
          <DetailLine label={a.detail.transport} value={agent.transport ?? agent.preferredTransport} />
          {a2a.agents.length > 0 && (
            <DetailLine label="Remote agents" value={String(a2a.agents.length)} />
          )}
        </div>

        {a2a.agents.length > 0 ? (
          <div className="space-y-1">
            {a2a.agents.map((remote) => (
              <div key={remote.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/30 transition-colors duration-100">
                <div className="w-6 h-6 rounded-md bg-muted/40 flex items-center justify-center shrink-0">
                  <Globe size={11} className="text-muted-foreground/60" />
                </div>
                <span className="text-xs text-foreground flex-1 min-w-0 truncate">{remote.card.name}</span>
                {remote.reachable ? (
                  <Wifi size={11} className="text-[var(--success)] shrink-0" />
                ) : (
                  <WifiOff size={11} className="text-muted-foreground/50 shrink-0" />
                )}
                <span className="text-2xs text-muted-foreground/50 tabular-nums shrink-0">{remote.card.skills.length} skills</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-2xs text-muted-foreground/50">{p.a2aNoRemoteHint}</p>
        )}
      </section>

      {/* ═══════════ RUNTIME & DIAGNOSTICS ═══════════ */}
      <RuntimeDiagSection agent={agent} status={status} isMindOS={isMindOS} mcpStatus={mcp.status} />

      {/* ═══════════ ENVIRONMENT & PERMISSIONS ═══════════ */}
      <EnvPermSection agent={agent} isMindOS={isMindOS} />

      {/* ═══════════ ACTIVITY & USAGE ═══════════ */}
      <ActivitySection agent={agent} />

      {/* ═══════════ Confirm Dialogs ═══════════ */}
      <ConfirmDialog
        open={confirmDelete !== null}
        title={a.detail.skillDelete}
        message={confirmDelete ? a.detail.skillDeleteConfirm(confirmDelete) : ''}
        confirmLabel={a.detail.skillDelete}
        cancelLabel={a.detail.skillCancel}
        onConfirm={() => confirmDelete && void handleDeleteSkill(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
        variant="destructive"
      />

      <ConfirmDialog
        open={confirmMcpRemove !== null}
        title={a.detail.mcpServerRemove}
        message={confirmMcpRemove ? a.detail.mcpServerRemoveConfirm(confirmMcpRemove) : ''}
        confirmLabel={a.detail.mcpServerRemove}
        cancelLabel={a.detail.skillCancel}
        onConfirm={handleMcpRemoveConfirm}
        onCancel={() => setConfirmMcpRemove(null)}
        variant="destructive"
      />

      {/* Skill detail popover */}
      <SkillDetailPopover
        open={detailSkillName !== null}
        skillName={detailSkillName}
        skill={detailSkillName ? mcp.skills.find((s) => s.name === detailSkillName) ?? null : null}
        agentNames={detailSkillName ? (crossAgentSkillMap.get(detailSkillName) ?? []) : []}
        isNative={detailSkillName ? !mcp.skills.some((s) => s.name === detailSkillName) : false}
        nativeSourcePath={agent?.installedSkillSourcePath}
        copy={a.skills.skillPopover}
        onClose={() => setDetailSkillName(null)}
        onToggle={mcp.toggleSkill}
        onDelete={handleDeleteSkillFromPopover}
        onRefresh={mcp.refresh}
      />

      {/* Custom agent edit modal */}
      {agent?.isCustom && (
        <CustomAgentModal
          open={customEditOpen}
          onClose={() => setCustomEditOpen(false)}
          onSuccess={() => { mcp.refresh(); setCustomEditOpen(false); }}
          existingAgents={mcp.agents}
          editAgent={agent}
        />
      )}

      {/* Custom agent remove confirmation */}
      <ConfirmDialog
        open={confirmCustomRemove}
        title={agent ? a.overview.customAgentRemoveTitle(agent.name) : ''}
        message={a.overview.customAgentRemoveMessage as string}
        confirmLabel={a.overview.customAgentRemoveConfirm as string}
        cancelLabel={a.detail.skillCancel}
        onConfirm={handleCustomRemoveConfirmed}
        onCancel={() => setConfirmCustomRemove(false)}
        variant="destructive"
      />
    </div>
  );
}
