'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Toggle } from '@/components/settings/Primitives';
import type { McpContextValue } from '@/hooks/useMcpData';
import type {
  AgentBuckets,
  SkillCapabilityFilter,
  SkillSourceFilter,
  SkillWorkspaceStatusFilter,
} from './agents-content-model';
import {
  createBulkSkillTogglePlan,
  filterSkillsForWorkspace,
  groupSkillsByCapability,
  resolveMatrixAgents,
  summarizeBulkSkillToggleResults,
} from './agents-content-model';

export default function AgentsSkillsSection({
  copy,
  mcp,
  buckets,
}: {
  copy: {
    title: string;
    capabilityGroups: string;
    tabs: {
      manage: string;
      matrix: string;
    };
    searchPlaceholder: string;
    sourceAll: string;
    sourceBuiltin: string;
    sourceUser: string;
    statusAll: string;
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
    matrixAgentFocusLabel: string;
    matrixAgentFocusAll: string;
    matrixColumnSkill: string;
    matrixEnabled: string;
    matrixDisabled: string;
    matrixUnsupported: string;
    matrixNoAgents: string;
    matrixEmpty: string;
    emptyGroup: string;
    groupLabels: Record<'research' | 'coding' | 'docs' | 'ops' | 'memory', string>;
  };
  mcp: McpContextValue;
  buckets: AgentBuckets;
}) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SkillSourceFilter>('all');
  const [status, setStatus] = useState<SkillWorkspaceStatusFilter>('all');
  const [capability, setCapability] = useState<SkillCapabilityFilter>('all');
  const [view, setView] = useState<'manage' | 'matrix'>('manage');
  const [matrixAgentFocus, setMatrixAgentFocus] = useState<string>('all');
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      filterSkillsForWorkspace(mcp.skills, {
        query,
        source,
        status,
        capability,
      }),
    [mcp.skills, query, source, status, capability],
  );
  const grouped = useMemo(() => groupSkillsByCapability(filtered), [filtered]);
  const knownAgents = useMemo(() => [...buckets.connected, ...buckets.detected, ...buckets.notFound], [buckets]);
  const matrixAgents = useMemo(() => resolveMatrixAgents(knownAgents, matrixAgentFocus), [knownAgents, matrixAgentFocus]);
  const capabilityOptions = useMemo(
    () =>
      (['research', 'coding', 'docs', 'ops', 'memory'] as const).map((key) => ({
        key,
        label: copy.groupLabels[key],
      })),
    [copy.groupLabels],
  );

  const runBulkToggle = async (targetEnabled: boolean) => {
    if (bulkRunning) return;
    const plan = createBulkSkillTogglePlan(filtered, targetEnabled);
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
    <section className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground mb-1">{copy.title}</h2>
        <div className="flex items-center gap-1 rounded-md border border-border p-1 bg-background">
          <SectionTabButton active={view === 'manage'} label={copy.tabs.manage} onClick={() => setView('manage')} />
          <SectionTabButton active={view === 'matrix'} label={copy.tabs.matrix} onClick={() => setView('matrix')} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{copy.capabilityGroups}</p>

      {view === 'manage' ? (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col md:flex-row gap-2">
              <label className="relative flex-1">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={copy.searchPlaceholder}
                  className="w-full h-9 rounded-md border border-border bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <div className="flex items-center gap-1 rounded-md border border-border p-1 bg-background">
                <SourceFilterButton active={source === 'all'} label={copy.sourceAll} onClick={() => setSource('all')} />
                <SourceFilterButton active={source === 'builtin'} label={copy.sourceBuiltin} onClick={() => setSource('builtin')} />
                <SourceFilterButton active={source === 'user'} label={copy.sourceUser} onClick={() => setSource('user')} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-md border border-border p-1 bg-background">
                <SourceFilterButton active={status === 'all'} label={copy.statusAll} onClick={() => setStatus('all')} />
                <SourceFilterButton active={status === 'enabled'} label={copy.statusEnabled} onClick={() => setStatus('enabled')} />
                <SourceFilterButton active={status === 'disabled'} label={copy.statusDisabled} onClick={() => setStatus('disabled')} />
                <SourceFilterButton active={status === 'attention'} label={copy.statusAttention} onClick={() => setStatus('attention')} />
              </div>
              <div className="flex items-center gap-1 rounded-md border border-border p-1 bg-background">
                <SourceFilterButton active={capability === 'all'} label={copy.capabilityAll} onClick={() => setCapability('all')} />
                {capabilityOptions.map((option) => (
                  <SourceFilterButton
                    key={option.key}
                    active={capability === option.key}
                    label={option.label}
                    onClick={() => setCapability(option.key)}
                  />
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={bulkRunning}
                onClick={() => void runBulkToggle(true)}
                className="px-2.5 h-8 rounded border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {copy.bulkEnableFiltered}
              </button>
              <button
                type="button"
                disabled={bulkRunning}
                onClick={() => void runBulkToggle(false)}
                className="px-2.5 h-8 rounded border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {copy.bulkDisableFiltered}
              </button>
              <span className="text-2xs text-muted-foreground">{copy.resultCount(filtered.length)}</span>
              {bulkMessage ? <span className="text-2xs text-muted-foreground">{bulkMessage}</span> : null}
            </div>
          </div>

          <div className="space-y-4">
            {Object.entries(grouped).map(([groupKey, skills]) => (
              <div key={groupKey} className="rounded-md border border-border p-3">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  {copy.groupLabels[groupKey as keyof typeof copy.groupLabels]} ({skills.length})
                </div>
                {skills.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{copy.emptyGroup}</p>
                ) : (
                  <div className="space-y-1.5">
                    {skills.map((skill) => (
                      <div key={skill.name} className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground truncate">{skill.name}</p>
                          <p className="text-2xs text-muted-foreground">{skill.source === 'builtin' ? copy.sourceBuiltin : copy.sourceUser}</p>
                        </div>
                        <Toggle size="sm" checked={skill.enabled} onChange={(v) => void mcp.toggleSkill(skill.name, v)} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-md border border-border bg-background p-3 space-y-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{copy.matrixAgentFocusLabel}</span>
            <select
              value={matrixAgentFocus}
              onChange={(e) => setMatrixAgentFocus(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">{copy.matrixAgentFocusAll}</option>
              {knownAgents.map((agent) => (
                <option key={agent.key} value={agent.key}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
          {knownAgents.length === 0 || matrixAgents.length === 0 ? (
            <p className="text-xs text-muted-foreground">{copy.matrixNoAgents}</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground">{copy.matrixEmpty}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-muted-foreground font-medium">{copy.matrixColumnSkill}</th>
                    {matrixAgents.map((agent) => (
                      <th key={agent.key} className="text-left py-2 text-muted-foreground font-medium pr-3">
                        {agent.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((skill) => (
                    <tr key={skill.name} className="border-b border-border/40">
                      <td className="py-2 text-foreground pr-3">{skill.name}</td>
                      {matrixAgents.map((agent) => (
                        <td key={`${skill.name}:${agent.key}`} className="py-2 pr-3 text-muted-foreground">
                          {agent.present ? (skill.enabled ? copy.matrixEnabled : copy.matrixDisabled) : copy.matrixUnsupported}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SourceFilterButton({
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

function SectionTabButton({
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
