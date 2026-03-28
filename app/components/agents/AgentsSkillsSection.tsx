'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Search, Trash2, Zap } from 'lucide-react';
import { Toggle } from '@/components/settings/Primitives';
import { apiFetch } from '@/lib/api';
import type { McpContextValue } from '@/hooks/useMcpData';
import type {
  AgentBuckets,
  SkillCapabilityFilter,
  SkillWorkspaceStatusFilter,
  UnifiedSourceFilter,
} from './agents-content-model';
import {
  ActionButton,
  AddAvatarButton,
  AgentAvatar,
  AgentPickerPopover,
  BulkMessage,
  ConfirmDialog,
  EmptyState,
  PillButton,
  SearchInput,
} from './AgentsPrimitives';
import SkillDetailPopover from './SkillDetailPopover';
import {
  aggregateCrossAgentSkills,
  buildSkillAttentionSet,
  buildUnifiedSkillList,
  capabilityForSkill,
  createBulkUnifiedTogglePlan,
  filterUnifiedSkills,
  groupUnifiedSkills,
  resolveAgentStatus,
  sortAgentsByStatus,
  summarizeBulkSkillToggleResults,
  type UnifiedSkillItem,
} from './agents-content-model';

type SkillView = 'bySkill' | 'byAgent';

export default function AgentsSkillsSection({
  copy,
  mcp,
  buckets,
}: {
  copy: {
    title: string;
    summaryEnabled: (n: number) => string;
    summaryDisabled: (n: number) => string;
    summaryAttention: (n: number) => string;
    summaryNative: (n: number) => string;
    tabs: { bySkill: string; byAgent: string; [k: string]: string };
    searchPlaceholder: string;
    sourceAll: string;
    sourceBuiltin: string;
    sourceUser: string;
    sourceNative: string;
    statusAll: string;
    noSkillsMatchFilter: string;
    statusEnabled: string;
    statusDisabled: string;
    statusAttention: string;
    capabilityAll: string;
    bulkEnableFiltered: string;
    bulkDisableFiltered: string;
    bulkRunning: string;
    bulkNoChanges: string;
    bulkAllSucceeded: (n: number) => string;
    bulkPartialFailed: (ok: number, failed: number) => string;
    resultCount: (n: number) => string;
    agentNativeSkills: string;
    agentMindosSkills: string;
    noAgentsYet: string;
    moreSkills: (n: number) => string;
    addAgentToSkill: string;
    removeAgentFromSkill: string;
    confirmRemoveAgentTitle: string;
    confirmRemoveAgentMessage: (agent: string, skill: string) => string;
    cancelSkillAction: string;
    noAvailableAgentsForSkill: string;
    manualSkillHint: string;
    skillDescription: string;
    skillNoDescription: string;
    skillAgentCount: (n: number) => string;
    skillDeleteAction: string;
    confirmDeleteSkillTitle: string;
    confirmDeleteSkillMessage: (name: string) => string;
    skillDeleted: string;
    skillDeleteFailed: string;
    copyInstallCmd: string;
    installCmdCopied: string;
    quickStatsMcp: (n: number) => string;
    quickStatsSkills: (n: number) => string;
    showAllNative: (n: number) => string;
    collapseNative: string;
    groupLabels: Record<'research' | 'coding' | 'docs' | 'ops' | 'memory', string>;
    skillPopover: {
      close: string;
      source: string;
      sourceBuiltin: string;
      sourceUser: string;
      sourceNative: string;
      capability: string;
      path: string;
      enabled: string;
      disabled: string;
      agents: string;
      noAgents: string;
      content: string;
      loading: string;
      loadFailed: string;
      retry: string;
      copyContent: string;
      copied: string;
      noDescription: string;
      deleteSkill: string;
      confirmDeleteTitle: string;
      confirmDeleteMessage: (name: string) => string;
      confirmDeleteAction: string;
      cancelAction: string;
      deleted: string;
      deleteFailed: string;
    };
    [k: string]: unknown;
  };
  mcp: McpContextValue;
  buckets: AgentBuckets;
}) {
  const [view, setView] = useState<SkillView>('bySkill');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<UnifiedSourceFilter>('all');
  const [status, setStatus] = useState<SkillWorkspaceStatusFilter>('all');
  const [capability, setCapability] = useState<SkillCapabilityFilter>('all');
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [detailSkill, setDetailSkill] = useState<string | null>(null);

  const crossAgentSkills = useMemo(() => aggregateCrossAgentSkills(mcp.agents), [mcp.agents]);
  const sortedAgents = useMemo(() => sortAgentsByStatus(mcp.agents), [mcp.agents]);

  const unified = useMemo(
    () => buildUnifiedSkillList(mcp.skills, crossAgentSkills),
    [mcp.skills, crossAgentSkills],
  );

  const enabledCount = useMemo(() => mcp.skills.filter((s) => s.enabled).length, [mcp.skills]);
  const disabledCount = useMemo(() => mcp.skills.filter((s) => !s.enabled).length, [mcp.skills]);
  const attentionCount = useMemo(() => buildSkillAttentionSet(mcp.skills).size, [mcp.skills]);
  const nativeCount = useMemo(() => unified.filter((s) => s.kind === 'native').length, [unified]);

  const filtered = useMemo(
    () => filterUnifiedSkills(unified, { query, source, status, capability }),
    [unified, query, source, status, capability],
  );
  const grouped = useMemo(() => groupUnifiedSkills(filtered), [filtered]);

  const capabilityOptions = useMemo(
    () => (['research', 'coding', 'docs', 'ops', 'memory'] as const).map((key) => ({ key, label: copy.groupLabels[key] })),
    [copy.groupLabels],
  );

  const detailUnified = useMemo(
    () => (detailSkill ? unified.find((s) => s.name === detailSkill) ?? null : null),
    [detailSkill, unified],
  );
  const detailSkillInfo = useMemo(
    () => (detailSkill ? mcp.skills.find((s) => s.name === detailSkill) ?? null : null),
    [detailSkill, mcp.skills],
  );

  const handleDeleteFromPopover = useCallback(async (name: string) => {
    await apiFetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', name }),
    });
    window.dispatchEvent(new Event('mindos:skills-changed'));
    await mcp.refresh();
  }, [mcp]);

  const runBulkToggle = async (targetEnabled: boolean) => {
    if (bulkRunning) return;
    const plan = createBulkUnifiedTogglePlan(filtered, targetEnabled);
    if (plan.length === 0) {
      setBulkMessage(copy.bulkNoChanges);
      return;
    }
    setBulkRunning(true);
    setBulkMessage(copy.bulkRunning);
    const results: Array<{ skillName: string; ok: boolean }> = [];
    for (const skillName of plan) {
      const ok = await mcp.toggleSkill(skillName, targetEnabled);
      results.push({ skillName, ok });
    }
    const summary = summarizeBulkSkillToggleResults(results);
    setBulkMessage(
      summary.failed === 0
        ? copy.bulkAllSucceeded(summary.succeeded)
        : copy.bulkPartialFailed(summary.succeeded, summary.failed),
    );
    setBulkRunning(false);
  };

  return (
    <section className="space-y-4 overflow-hidden" aria-label={copy.title}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-muted/50 flex items-center justify-center">
            <Zap size={13} className="text-muted-foreground/70" aria-hidden="true" />
          </div>
          {copy.title}
        </h2>
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5 bg-background" role="tablist" aria-label={copy.title}>
          <PillButton active={view === 'bySkill'} label={copy.tabs.bySkill} onClick={() => setView('bySkill')} />
          <PillButton active={view === 'byAgent'} label={copy.tabs.byAgent} onClick={() => setView('byAgent')} />
        </div>
      </div>

      {/* Compact status strip */}
      <div className="rounded-xl border border-border/60 bg-gradient-to-r from-card to-card/80 p-3.5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" aria-hidden="true" />
            {copy.summaryEnabled(enabledCount)}
          </span>
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" aria-hidden="true" />
            {copy.summaryDisabled(disabledCount)}
          </span>
          {attentionCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[var(--amber)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)]" aria-hidden="true" />
              {copy.summaryAttention(attentionCount)}
            </span>
          )}
          {nativeCount > 0 && (
            <>
              <span className="text-muted-foreground/40" aria-hidden="true">|</span>
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)]" aria-hidden="true" />
                {copy.summaryNative(nativeCount)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Search */}
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={copy.searchPlaceholder}
        ariaLabel={copy.searchPlaceholder}
        icon={Search}
      />

      {view === 'bySkill' ? (
        <BySkillView
          copy={copy}
          filtered={filtered}
          grouped={grouped}
          allAgents={sortedAgents}
          source={source}
          status={status}
          capability={capability}
          capabilityOptions={capabilityOptions}
          bulkRunning={bulkRunning}
          bulkMessage={bulkMessage}
          onSourceChange={setSource}
          onStatusChange={setStatus}
          onCapabilityChange={setCapability}
          onBulkToggle={runBulkToggle}
          onToggleSkill={mcp.toggleSkill}
          onRefresh={mcp.refresh}
          onOpenDetail={setDetailSkill}
        />
      ) : (
        <ByAgentView
          copy={copy}
          agents={sortedAgents}
          skills={mcp.skills}
          crossAgentSkills={crossAgentSkills}
          query={query}
          onToggleSkill={mcp.toggleSkill}
          onOpenDetail={setDetailSkill}
        />
      )}

      {/* Skill detail popover */}
      <SkillDetailPopover
        open={detailSkill !== null}
        skillName={detailSkill}
        skill={detailSkillInfo}
        agentNames={detailUnified?.agents ?? []}
        isNative={detailUnified?.kind === 'native'}
        nativeSourcePath={
          detailUnified?.kind === 'native' && detailUnified.agents.length > 0
            ? mcp.agents.find((a) => a.name === detailUnified.agents[0])?.installedSkillSourcePath
            : undefined
        }
        copy={copy.skillPopover}
        onClose={() => setDetailSkill(null)}
        onToggle={mcp.toggleSkill}
        onDelete={handleDeleteFromPopover}
        onRefresh={mcp.refresh}
      />
    </section>
  );
}

/* ────────── By Skill View (Unified: MindOS + Native) ────────── */

function BySkillView({
  copy,
  filtered,
  grouped,
  allAgents,
  source,
  status,
  capability,
  capabilityOptions,
  bulkRunning,
  bulkMessage,
  onSourceChange,
  onStatusChange,
  onCapabilityChange,
  onBulkToggle,
  onToggleSkill,
  onRefresh,
  onOpenDetail,
}: {
  copy: Parameters<typeof AgentsSkillsSection>[0]['copy'];
  filtered: UnifiedSkillItem[];
  grouped: ReturnType<typeof groupUnifiedSkills>;
  allAgents: ReturnType<typeof sortAgentsByStatus>;
  source: UnifiedSourceFilter;
  status: SkillWorkspaceStatusFilter;
  capability: SkillCapabilityFilter;
  capabilityOptions: Array<{ key: string; label: string }>;
  bulkRunning: boolean;
  bulkMessage: string | null;
  onSourceChange: (s: UnifiedSourceFilter) => void;
  onStatusChange: (s: SkillWorkspaceStatusFilter) => void;
  onCapabilityChange: (s: SkillCapabilityFilter) => void;
  onBulkToggle: (enabled: boolean) => Promise<void>;
  onToggleSkill: (name: string, enabled: boolean) => Promise<boolean>;
  onRefresh: () => Promise<void>;
  onOpenDetail: (name: string) => void;
}) {
  const [confirmAgentRemove, setConfirmAgentRemove] = useState<{ agentName: string; skillName: string } | null>(null);
  const [confirmSkillDelete, setConfirmSkillDelete] = useState<string | null>(null);
  const [pickerSkill, setPickerSkill] = useState<string | null>(null);
  const [hintMessage, setHintMessage] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState<string | null>(null);

  const handleConfirmAgentRemove = useCallback(() => {
    setConfirmAgentRemove(null);
    setHintMessage(copy.manualSkillHint);
    setTimeout(() => setHintMessage(null), 4000);
  }, [copy.manualSkillHint]);

  const handleDeleteSkill = useCallback(async (name: string) => {
    setConfirmSkillDelete(null);
    setDeleteBusy(name);
    try {
      await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', name }),
      });
      setHintMessage(copy.skillDeleted);
      window.dispatchEvent(new Event('mindos:skills-changed'));
      await onRefresh();
    } catch {
      setHintMessage(copy.skillDeleteFailed);
    } finally {
      setDeleteBusy(null);
      setTimeout(() => setHintMessage(null), 3000);
    }
  }, [copy.skillDeleted, copy.skillDeleteFailed, onRefresh]);

  const sortedGrouped = useMemo(() => {
    const entries: Array<[string, UnifiedSkillItem[]]> = [];
    for (const [key, skills] of Object.entries(grouped)) {
      if (skills.length === 0) continue;
      const sorted = [...skills].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'mindos' ? -1 : 1;
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      entries.push([key, sorted]);
    }
    return entries;
  }, [grouped]);

  return (
    <>
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div role="group" aria-label="Source" className="flex items-center gap-0.5 rounded-md border border-border p-0.5 bg-background">
          <PillButton active={source === 'all'} label={copy.sourceAll} onClick={() => onSourceChange('all')} />
          <PillButton active={source === 'builtin'} label={copy.sourceBuiltin} onClick={() => onSourceChange('builtin')} />
          <PillButton active={source === 'user'} label={copy.sourceUser} onClick={() => onSourceChange('user')} />
          <PillButton active={source === 'native'} label={copy.sourceNative} onClick={() => onSourceChange('native')} />
        </div>
        <div role="group" aria-label="Status" className="flex items-center gap-0.5 rounded-md border border-border p-0.5 bg-background">
          <PillButton active={status === 'all'} label={copy.statusAll} onClick={() => onStatusChange('all')} />
          <PillButton active={status === 'enabled'} label={copy.statusEnabled} onClick={() => onStatusChange('enabled')} />
          <PillButton active={status === 'disabled'} label={copy.statusDisabled} onClick={() => onStatusChange('disabled')} />
          <PillButton active={status === 'attention'} label={copy.statusAttention} onClick={() => onStatusChange('attention')} />
        </div>
        <div role="group" aria-label="Capability" className="flex items-center gap-0.5 rounded-md border border-border p-0.5 bg-background">
          <PillButton active={capability === 'all'} label={copy.capabilityAll} onClick={() => onCapabilityChange('all')} />
          {capabilityOptions.map((opt) => (
            <PillButton key={opt.key} active={capability === opt.key} label={opt.label} onClick={() => onCapabilityChange(opt.key as SkillCapabilityFilter)} />
          ))}
        </div>
      </div>

      {/* Bulk actions (only affect MindOS skills) */}
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton
          onClick={() => void onBulkToggle(true)}
          disabled={bulkRunning}
          busy={bulkRunning}
          label={copy.bulkEnableFiltered}
        />
        <ActionButton
          onClick={() => void onBulkToggle(false)}
          disabled={bulkRunning}
          busy={false}
          label={copy.bulkDisableFiltered}
        />
        <span className="text-2xs text-muted-foreground tabular-nums">{copy.resultCount(filtered.length)}</span>
        <BulkMessage message={bulkMessage} />
      </div>

      {hintMessage && (
        <div role="status" aria-live="polite" className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground animate-in fade-in duration-200">
          {hintMessage}
        </div>
      )}

      {/* Grouped unified skill list */}
      {sortedGrouped.length === 0 ? (
        <EmptyState message={copy.noSkillsMatchFilter} />
      ) : (
        <div className="space-y-3">
          {sortedGrouped.map(([groupKey, sortedSkills]) => (
            <div key={groupKey}>
              <div className="flex items-center gap-2 mb-2.5">
                <span className="w-1 h-4 rounded-full bg-[var(--amber)]/40" aria-hidden="true" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {copy.groupLabels[groupKey as keyof typeof copy.groupLabels]}
                </span>
                <span className="text-2xs tabular-nums text-muted-foreground/50 font-medium">({sortedSkills.length})</span>
              </div>
              <div className="space-y-3">
                {sortedSkills.map((skill) => {
                  const availableAgents = allAgents
                    .filter((a) => !skill.agents.includes(a.name))
                    .map((a) => ({ key: a.key, name: a.name }));
                  const isUserSkill = skill.kind === 'mindos' && skill.source === 'user';

                  return (
                    <div key={skill.name} className="rounded-xl border border-border bg-card p-4 hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-200">
                      {/* Skill header */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Zap size={14} className={`shrink-0 ${skill.enabled ? 'text-[var(--amber)]' : 'text-muted-foreground/50'}`} aria-hidden="true" />
                          <button
                            type="button"
                            onClick={() => onOpenDetail(skill.name)}
                            className="text-sm font-medium text-foreground truncate hover:text-[var(--amber)] cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded text-left"
                          >
                            {skill.name}
                          </button>
                          <span className={`text-2xs shrink-0 px-1.5 py-0.5 rounded ${
                            skill.kind === 'native'
                              ? 'bg-muted text-muted-foreground'
                              : skill.source === 'builtin'
                                ? 'bg-muted text-muted-foreground'
                                : 'bg-[var(--amber-dim)] text-[var(--amber-text)]'
                          }`}>
                            {skill.kind === 'native' ? copy.sourceNative : skill.source === 'builtin' ? copy.sourceBuiltin : copy.sourceUser}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isUserSkill && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setConfirmSkillDelete(skill.name); }}
                              disabled={deleteBusy === skill.name}
                              className="text-muted-foreground hover:text-destructive cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded p-1 disabled:opacity-50 transition-colors duration-150"
                              aria-label={`${copy.skillDeleteAction} ${skill.name}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                          {skill.kind === 'mindos' ? (
                            <Toggle size="sm" checked={skill.enabled} onChange={(v) => void onToggleSkill(skill.name, v)} />
                          ) : (
                            <span className="text-2xs text-muted-foreground/60 select-none" aria-label="read-only">—</span>
                          )}
                          <div className="relative">
                            <AddAvatarButton
                              onClick={() => setPickerSkill(pickerSkill === skill.name ? null : skill.name)}
                              label={copy.addAgentToSkill}
                              size="sm"
                            />
                            <AgentPickerPopover
                              open={pickerSkill === skill.name}
                              agents={availableAgents}
                              emptyLabel={copy.noAvailableAgentsForSkill}
                              onSelect={() => {
                                setPickerSkill(null);
                                setHintMessage(copy.manualSkillHint);
                                setTimeout(() => setHintMessage(null), 4000);
                              }}
                              onClose={() => setPickerSkill(null)}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Agent count */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground mb-3">
                        <span className="tabular-nums">{copy.skillAgentCount(skill.agents.length)}</span>
                      </div>

                      {/* Agent avatar grid */}
                      <div className="flex flex-wrap items-center gap-2">
                        {skill.agents.map((name) => (
                          <AgentAvatar
                            key={name}
                            name={name}
                            onRemove={() => setConfirmAgentRemove({ agentName: name, skillName: skill.name })}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirm: remove agent from skill */}
      <ConfirmDialog
        open={confirmAgentRemove !== null}
        title={copy.confirmRemoveAgentTitle}
        message={confirmAgentRemove ? copy.confirmRemoveAgentMessage(confirmAgentRemove.agentName, confirmAgentRemove.skillName) : ''}
        confirmLabel={copy.removeAgentFromSkill}
        cancelLabel={copy.cancelSkillAction}
        onConfirm={handleConfirmAgentRemove}
        onCancel={() => setConfirmAgentRemove(null)}
        variant="destructive"
      />

      {/* Confirm: delete skill */}
      <ConfirmDialog
        open={confirmSkillDelete !== null}
        title={copy.confirmDeleteSkillTitle}
        message={confirmSkillDelete ? copy.confirmDeleteSkillMessage(confirmSkillDelete) : ''}
        confirmLabel={copy.skillDeleteAction}
        cancelLabel={copy.cancelSkillAction}
        onConfirm={() => confirmSkillDelete && void handleDeleteSkill(confirmSkillDelete)}
        onCancel={() => setConfirmSkillDelete(null)}
        variant="destructive"
      />
    </>
  );
}

/* ────────── By Agent View ────────── */

function ByAgentView({
  copy,
  agents,
  skills,
  crossAgentSkills,
  query,
  onToggleSkill,
  onOpenDetail,
}: {
  copy: Parameters<typeof AgentsSkillsSection>[0]['copy'];
  agents: ReturnType<typeof sortAgentsByStatus>;
  skills: McpContextValue['skills'];
  crossAgentSkills: ReturnType<typeof aggregateCrossAgentSkills>;
  query: string;
  onToggleSkill: (name: string, enabled: boolean) => Promise<boolean>;
  onOpenDetail: (name: string) => void;
}) {
  const q = query.trim().toLowerCase();

  const filteredAgents = useMemo(() => {
    if (!q) return agents;
    return agents.filter((a) => {
      const haystack = `${a.name} ${a.key}`.toLowerCase();
      if (haystack.includes(q)) return true;
      const nativeSkills = a.installedSkillNames ?? [];
      return nativeSkills.some((s) => s.toLowerCase().includes(q));
    });
  }, [agents, q]);

  const filteredSkills = useMemo(() => {
    if (!q) return skills;
    return skills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }, [skills, q]);

  if (filteredAgents.length === 0) {
    return <EmptyState message={copy.noAgentsYet} />;
  }

  return (
    <div className="space-y-3">
      {filteredAgents.map((agent) => {
        const agentStatus = resolveAgentStatus(agent);
        const nativeSkills = (agent.installedSkillNames ?? []).sort();
        const mcpServers = agent.configuredMcpServers ?? [];
        const agentMindosSkills = (agent.present ? filteredSkills : [])
          .slice()
          .sort((a, b) => {
            if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        const totalSkills = nativeSkills.length + agentMindosSkills.length;

        return (
          <AgentCard
            key={agent.key}
            agentKey={agent.key}
            name={agent.name}
            status={agentStatus}
            skillMode={agent.skillMode}
            mcpCount={mcpServers.length}
            totalSkills={totalSkills}
            nativeSkills={nativeSkills}
            mindosSkills={agentMindosSkills}
            copy={copy}
            onToggleSkill={onToggleSkill}
            onOpenDetail={onOpenDetail}
          />
        );
      })}
    </div>
  );
}

/* ────────── Agent Card (Skills ByAgent) ────────── */

function AgentCard({
  agentKey,
  name,
  status,
  skillMode,
  mcpCount,
  totalSkills,
  nativeSkills,
  mindosSkills,
  copy,
  onToggleSkill,
  onOpenDetail,
}: {
  agentKey: string;
  name: string;
  status: 'connected' | 'detected' | 'notFound';
  skillMode: string | undefined;
  mcpCount: number;
  totalSkills: number;
  nativeSkills: string[];
  mindosSkills: McpContextValue['skills'];
  copy: Parameters<typeof AgentsSkillsSection>[0]['copy'];
  onToggleSkill: (name: string, enabled: boolean) => Promise<boolean>;
  onOpenDetail: (name: string) => void;
}) {
  const [nativeExpanded, setNativeExpanded] = useState(false);
  const NATIVE_COLLAPSE_THRESHOLD = 6;
  const showNativeToggle = nativeSkills.length > NATIVE_COLLAPSE_THRESHOLD;
  const visibleNative = nativeExpanded ? nativeSkills : nativeSkills.slice(0, NATIVE_COLLAPSE_THRESHOLD);

  return (
    <div className="rounded-xl border border-border bg-card hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-200 overflow-hidden">
      {/* Card header with avatar */}
      <div className="flex items-center gap-3 p-4 pb-0">
        <AgentAvatar name={name} status={status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={`/agents/${encodeURIComponent(agentKey)}`} className="text-sm font-medium text-foreground hover:underline cursor-pointer truncate">
              {name}
            </Link>
            {skillMode && (
              <span className={`text-2xs px-1.5 py-0.5 rounded shrink-0 ${
                skillMode === 'universal' ? 'bg-success/10 text-success'
                  : skillMode === 'additional' ? 'bg-[var(--amber-dim)] text-[var(--amber-text)]'
                    : 'bg-muted text-muted-foreground'
              }`}>
                {skillMode}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-2xs text-muted-foreground">
            <span className="tabular-nums">{copy.quickStatsMcp(mcpCount)}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{copy.quickStatsSkills(totalSkills)}</span>
          </div>
        </div>
      </div>

      {/* Skill sections */}
      <div className="p-4 pt-3 space-y-3">
        {/* Native skills */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">
              {copy.agentNativeSkills} <span className="tabular-nums">({nativeSkills.length})</span>
            </p>
            {showNativeToggle && (
              <button
                type="button"
                onClick={() => setNativeExpanded(!nativeExpanded)}
                className="text-2xs text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded transition-colors duration-150"
              >
                {nativeExpanded ? (
                  <><ChevronDown size={12} />{copy.collapseNative}</>
                ) : (
                  <><ChevronRight size={12} />{copy.showAllNative(nativeSkills.length)}</>
                )}
              </button>
            )}
          </div>
          {nativeSkills.length === 0 ? (
            <p className="text-2xs text-muted-foreground/60">—</p>
          ) : (
            <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
              {visibleNative.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onOpenDetail(n)}
                  className="w-full flex items-center gap-1.5 py-1 min-h-[28px] hover:bg-muted/30 -mx-1.5 px-1.5 rounded transition-colors duration-100 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Zap size={12} className="shrink-0 text-muted-foreground/50" aria-hidden="true" />
                  <span className="text-xs text-foreground truncate hover:text-[var(--amber)] transition-colors duration-150">{n}</span>
                </button>
              ))}
              {!nativeExpanded && nativeSkills.length > NATIVE_COLLAPSE_THRESHOLD && (
                <button
                  type="button"
                  onClick={() => setNativeExpanded(true)}
                  className="w-full text-left text-2xs text-muted-foreground hover:text-foreground py-1 px-1.5 -mx-1.5 cursor-pointer transition-colors duration-150"
                >
                  +{nativeSkills.length - NATIVE_COLLAPSE_THRESHOLD}
                </button>
              )}
            </div>
          )}
        </div>

        {/* MindOS skills */}
        {mindosSkills.length > 0 && (
          <div>
            <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              {copy.agentMindosSkills} <span className="tabular-nums">({mindosSkills.filter((s) => s.enabled).length}/{mindosSkills.length})</span>
            </p>
            <div className="space-y-0.5 max-h-[240px] overflow-y-auto">
              {mindosSkills.map((skill) => (
                <div key={skill.name} className="flex items-center justify-between gap-2 py-1 min-h-[32px] hover:bg-muted/30 -mx-1.5 px-1.5 rounded transition-colors duration-100">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Zap size={12} className={`shrink-0 ${skill.enabled ? 'text-[var(--amber)]' : 'text-muted-foreground/50'}`} aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => onOpenDetail(skill.name)}
                      className="text-xs text-foreground truncate hover:text-[var(--amber)] cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded text-left"
                    >
                      {skill.name}
                    </button>
                    <span className="text-2xs text-muted-foreground shrink-0">
                      {copy.groupLabels[capabilityForSkill(skill) as keyof typeof copy.groupLabels]}
                    </span>
                  </div>
                  <Toggle size="sm" checked={skill.enabled} onChange={(v) => void onToggleSkill(skill.name, v)} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
