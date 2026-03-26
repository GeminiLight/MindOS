'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, Server, Search, Trash2, Zap } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import { useMcpData } from '@/hooks/useMcpData';
import { apiFetch } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { generateSnippet } from '@/lib/mcp-snippets';
import {
  aggregateCrossAgentMcpServers,
  aggregateCrossAgentSkills,
  filterSkillsForAgentDetail,
  resolveAgentStatus,
  type AgentDetailSkillSourceFilter,
} from './agents-content-model';
import { AgentAvatar, ActionButton, ConfirmDialog, PillButton } from './AgentsPrimitives';
import SkillDetailPopover from './SkillDetailPopover';

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
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [confirmMcpRemove, setConfirmMcpRemove] = useState<string | null>(null);
  const [mcpHint, setMcpHint] = useState<string | null>(null);
  const [detailSkillName, setDetailSkillName] = useState<string | null>(null);

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
  const nativeInstalledSkills = agent?.installedSkillNames ?? [];
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

  const handleCopySnippet = useCallback(async () => {
    const ok = await copyToClipboard(snippet.snippet);
    if (!ok) return;
    setSnippetCopied(true);
    setTimeout(() => setSnippetCopied(false), 1200);
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


  return (
    <div className="content-width px-4 md:px-6 py-8 md:py-10 space-y-4">
      {/* Back link */}
      <Link href="/agents" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} />
        {a.backToOverview}
      </Link>

      {/* ═══════════ AGENT PROFILE (consolidated header) ═══════════ */}
      <section className="rounded-xl border border-border bg-gradient-to-b from-card to-card/80 overflow-hidden">
        <div className="flex items-center gap-4 p-5">
          <AgentAvatar name={agent.name} status={status} size="md" />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight font-display text-foreground">{agent.name}</h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
              <span className={`text-2xs font-medium px-2 py-0.5 rounded-full ${
                status === 'connected' ? 'bg-success/10 text-success'
                  : status === 'detected' ? 'bg-[var(--amber-subtle)] text-[var(--amber)]'
                    : 'bg-muted text-muted-foreground'
              }`}>{status}</span>
              <span className="text-2xs text-muted-foreground/60 font-mono">{agent.transport ?? agent.preferredTransport}</span>
              <span className="text-2xs text-muted-foreground/30" aria-hidden="true">·</span>
              <span className="text-2xs text-muted-foreground/60">{agent.skillMode ?? a.na}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground/70 px-5 py-3 border-t border-border/50 bg-muted/[0.03]">
          <span>{a.detail.format}: <span className="text-foreground/80 font-medium">{agent.format}</span></span>
          <span>{a.detail.lastActivityAt}: <span className="text-foreground/80 tabular-nums font-medium">{agent.runtimeLastActivityAt ?? a.na}</span></span>
          <span className="font-medium text-foreground/80 tabular-nums">{configuredMcpServers.length} MCP · {nativeInstalledSkills.length} skills</span>
        </div>
      </section>

      {/* ═══════════ MCP MANAGEMENT ═══════════ */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-muted/50 flex items-center justify-center">
            <Server size={13} className="text-muted-foreground/70" />
          </div>
          {a.detail.mcpManagement}
        </h2>

        {/* MCP status row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          {isMindOS ? (
            <>
              <DetailLine label="Status" value={mcp.status?.running ? '● Running' : '○ Stopped'} />
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

        {/* Configured MCP servers with management */}
        <div className="rounded-xl border border-border/60 bg-background/50 p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-foreground">{a.detail.configuredMcpServers}</p>
            <span className="text-2xs text-muted-foreground/60 tabular-nums">{a.detail.configuredMcpServersCount(configuredMcpServers.length)}</span>
          </div>

          {mcpHint && (
            <div role="status" aria-live="polite" className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground animate-in fade-in duration-200">
              {mcpHint}
            </div>
          )}

          {configuredMcpServers.length === 0 ? (
            <p className="text-xs text-muted-foreground">{a.detail.configuredMcpServersEmpty}</p>
          ) : (
            <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
              {configuredMcpServers.map((name) => {
                const sharedWith = (crossAgentMcpMap.get(name) ?? []).filter((n) => n !== agent.name);
                return (
                  <div key={name} className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-muted/[0.02] px-3 py-2.5 group/mcp hover:border-border/60 hover:bg-muted/[0.06] hover:shadow-[0_1px_3px_rgba(0,0,0,0.02)] transition-all duration-150">
                    <div className="w-5 h-5 rounded-md bg-[var(--amber)]/[0.08] flex items-center justify-center shrink-0">
                      <Server size={10} className="text-[var(--amber)]" />
                    </div>
                    <span className="text-xs font-medium text-foreground flex-1 min-w-0 truncate">{name}</span>
                    {sharedWith.length > 0 && (
                      <div className="flex items-center gap-1">
                        {sharedWith.slice(0, 3).map((n) => (
                          <AgentAvatar key={n} name={n} size="sm" />
                        ))}
                        {sharedWith.length > 3 && <span className="text-2xs text-muted-foreground">+{sharedWith.length - 3}</span>}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setConfirmMcpRemove(name)}
                      className="text-2xs text-muted-foreground hover:text-destructive cursor-pointer opacity-0 group-hover/mcp:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1 py-0.5 transition-all duration-150"
                      aria-label={`${a.detail.mcpServerRemove} ${name}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* MCP actions */}
        <div className="flex flex-wrap items-center gap-2">
          {!isMindOS && (
            <ActionButton
              onClick={() => void handleCopySnippet()}
              disabled={false}
              busy={false}
              label={snippetCopied ? a.detail.mcpCopied : a.detail.mcpCopySnippet}
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
              variant="primary"
            />
          )}
        </div>
        {!isMindOS && <p className="text-2xs text-muted-foreground truncate">{snippet.path}</p>}
        {mcpMessage && <p className="text-xs text-muted-foreground animate-in fade-in duration-200">{mcpMessage}</p>}
      </section>

      {/* ═══════════ SKILL ASSIGNMENTS ═══════════ */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-muted/50 flex items-center justify-center">
              <Zap size={13} className="text-muted-foreground/70" />
            </div>
            {a.detail.skillAssignments}
          </h2>
          <div className="flex items-center gap-2 text-2xs text-muted-foreground/60 tabular-nums">
            <span className="px-1.5 py-0.5 rounded bg-muted/40">MindOS {skillSummary.total}</span>
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/[0.06] text-emerald-600 dark:text-emerald-400">{a.detail.skillsEnabled.split(' ')[0]} {skillSummary.enabled}</span>
            <span className="px-1.5 py-0.5 rounded bg-muted/40">{a.detail.nativeInstalledSkills} {nativeInstalledSkills.length}</span>
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
                      <span className={`text-2xs px-1.5 py-0.5 rounded shrink-0 ${skill.source === 'builtin' ? 'bg-muted text-muted-foreground' : 'bg-[var(--amber-dim)] text-[var(--amber)]'}`}>
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

        {/* Native installed skills — same row style */}
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
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/[0.02] px-3.5 py-2.5 hover:bg-muted/[0.06] transition-colors duration-100">
      <p className="text-2xs text-muted-foreground/60 mb-1 uppercase tracking-wider">{label}</p>
      <p className="text-sm text-foreground font-medium truncate">{value}</p>
    </div>
  );
}
