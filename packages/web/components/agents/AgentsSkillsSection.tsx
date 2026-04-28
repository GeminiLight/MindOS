'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Search, Trash2, Zap } from 'lucide-react';
import { Toggle } from '@/components/settings/Primitives';
import { apiFetch } from '@/lib/api';
import type { McpContextValue } from '@/lib/stores/mcp-store';
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
import ByAgentView from './AgentsSkillsByAgent';
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

/** Shared copy type used by AgentsSkillsSection and its sub-views. */
export type SkillsSectionCopy = {
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

export default function AgentsSkillsSection({
  copy,
  mcp,
  buckets,
}: {
  copy: SkillsSectionCopy;
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
          <div className="w-6 h-6 rounded-md bg-[var(--amber-subtle)] flex items-center justify-center">
            <Zap size={13} className="text-[var(--amber)]" aria-hidden="true" />
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
        allAgentNames={mcp.agents.filter(a => a.present && a.installed).map(a => a.name)}
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
  copy: SkillsSectionCopy;
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

      {/* Grouped unified skill list (virtualized) */}
      {sortedGrouped.length === 0 ? (
        <EmptyState message={copy.noSkillsMatchFilter} />
      ) : (
        <VirtualizedSkillList
          sortedGrouped={sortedGrouped}
          allAgents={allAgents}
          copy={copy}
          pickerSkill={pickerSkill}
          deleteBusy={deleteBusy}
          onOpenDetail={onOpenDetail}
          onToggleSkill={onToggleSkill}
          setPickerSkill={setPickerSkill}
          setHintMessage={setHintMessage}
          setConfirmSkillDelete={setConfirmSkillDelete}
          setConfirmAgentRemove={setConfirmAgentRemove}
        />
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

/* ────────── Virtualized Skill List (BySkill) ────────── */

type FlatItem =
  | { type: 'header'; groupKey: string; count: number }
  | { type: 'card'; skill: UnifiedSkillItem; isLast: boolean };

function VirtualizedSkillList({
  sortedGrouped,
  allAgents,
  copy,
  pickerSkill,
  deleteBusy,
  onOpenDetail,
  onToggleSkill,
  setPickerSkill,
  setHintMessage,
  setConfirmSkillDelete,
  setConfirmAgentRemove,
}: {
  sortedGrouped: Array<[string, UnifiedSkillItem[]]>;
  allAgents: ReturnType<typeof sortAgentsByStatus>;
  copy: SkillsSectionCopy;
  pickerSkill: string | null;
  deleteBusy: string | null;
  onOpenDetail: (name: string) => void;
  onToggleSkill: (name: string, enabled: boolean) => Promise<boolean>;
  setPickerSkill: (name: string | null) => void;
  setHintMessage: (msg: string | null) => void;
  setConfirmSkillDelete: (name: string | null) => void;
  setConfirmAgentRemove: (v: { agentName: string; skillName: string } | null) => void;
}) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  const flatItems = useMemo<FlatItem[]>(() => {
    const items: FlatItem[] = [];
    for (const [groupKey, skills] of sortedGrouped) {
      items.push({ type: 'header', groupKey, count: skills.length });
      skills.forEach((skill, i) => {
        items.push({ type: 'card', skill, isLast: i === skills.length - 1 });
      });
    }
    return items;
  }, [sortedGrouped]);

  const renderItem = useCallback((_index: number, item: FlatItem) => {
    if (item.type === 'header') {
      return (
        <div className="flex items-center gap-2 pt-3 pb-2.5">
          <span className="w-1 h-4 rounded-full bg-[var(--amber)]/40" aria-hidden="true" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {copy.groupLabels[item.groupKey as keyof typeof copy.groupLabels]}
          </span>
          <span className="text-2xs tabular-nums text-muted-foreground/50 font-medium">({item.count})</span>
        </div>
      );
    }

    const { skill } = item;
    const availableAgents = allAgents
      .filter((a) => !skill.agents.includes(a.name))
      .map((a) => ({ key: a.key, name: a.name }));
    const isUserSkill = skill.kind === 'mindos' && skill.source === 'user';

    return (
      <div className={item.isLast ? 'pb-0' : 'pb-3'}>
        <div className="rounded-xl border border-border bg-card p-4 hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-200">
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
      </div>
    );
  }, [allAgents, copy, pickerSkill, deleteBusy, onOpenDetail, onToggleSkill, setPickerSkill, setHintMessage, setConfirmSkillDelete, setConfirmAgentRemove]);

  return (
    <Virtuoso
      ref={virtuosoRef}
      style={{ height: 'calc(100vh - 340px)', minHeight: 200 }}
      data={flatItems}
      itemContent={renderItem}
      overscan={200}
      increaseViewportBy={{ top: 100, bottom: 100 }}
    />
  );
}

