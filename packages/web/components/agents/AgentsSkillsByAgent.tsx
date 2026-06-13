'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Zap } from 'lucide-react';
import { Toggle } from '@/components/settings/Primitives';
import type { SkillMatrix, SkillMatrixCellStatus } from '@/components/settings/types';
import type { McpContextValue } from '@/lib/stores/mcp-store';
import { isSkillCellOn, nextSkillCellAction, postSkillCellAction } from '@/lib/skill-cell-actions';
import { abbreviateHomePath, isBuiltinSkillOrigin, skillSourceFolder } from '@/lib/skill-source';
import { toast } from '@/lib/toast';
import {
  capabilityForSkill,
  resolveAgentStatus,
  sortAgentsByStatus,
} from './agents-content-model';
import { AgentAvatar, EmptyState } from './AgentsPrimitives';
import type { SkillsSectionCopy } from './AgentsSkillsSection';

/* ────────── By Agent View — each card is one COLUMN of the skill matrix ────────── */

type MatrixRow = { skill: SkillMatrix['skills'][number]; status: SkillMatrixCellStatus | undefined };

export default function ByAgentView({
  copy,
  agents,
  skills,
  matrix,
  query,
  onToggleSkill,
  onChanged,
  onOpenDetail,
}: {
  copy: SkillsSectionCopy;
  agents: ReturnType<typeof sortAgentsByStatus>;
  skills: McpContextValue['skills'];
  matrix: SkillMatrix | null;
  query: string;
  onToggleSkill: (name: string, enabled: boolean) => Promise<boolean>;
  onChanged: () => Promise<void>;
  onOpenDetail: (name: string) => void;
}) {
  const q = query.trim().toLowerCase();
  const [busyCell, setBusyCell] = useState<string | null>(null);

  const matrixAgentKeys = useMemo(
    () => new Set((matrix?.agents ?? []).map((agent) => agent.key)),
    [matrix],
  );
  const matrixSkillNames = useMemo(
    () => new Set((matrix?.skills ?? []).map((skill) => skill.name)),
    [matrix],
  );

  const filteredAgents = useMemo(() => {
    if (!q) return agents;
    return agents.filter((a) => {
      const haystack = `${a.name} ${a.key}`.toLowerCase();
      if (haystack.includes(q)) return true;
      return (a.installedSkillNames ?? []).some((s) => s.toLowerCase().includes(q));
    });
  }, [agents, q]);

  const filteredMindosSkills = useMemo(() => {
    if (!q) return skills;
    return skills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }, [skills, q]);

  const filteredMatrixSkills = useMemo(() => {
    const all = matrix?.skills ?? [];
    if (!q) return all;
    return all.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }, [matrix, q]);

  const handleCellAction = async (
    skillName: string,
    agentKey: string,
    agentName: string,
    agentMode: string | undefined,
    status: SkillMatrixCellStatus | undefined,
  ) => {
    setBusyCell(`${skillName}:${agentKey}`);
    try {
      await postSkillCellAction(nextSkillCellAction(status), skillName, agentKey);
      await onChanged();
      if (agentMode === 'additional') {
        toast.success(copy.linkSkillRestartHint(agentName));
      }
    } catch (err: unknown) {
      toast.error(copy.linkSkillFailed(skillName, agentName, err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setBusyCell(null);
    }
  };

  if (filteredAgents.length === 0) {
    return <EmptyState message={copy.noAgentsYet} />;
  }

  return (
    <div className="space-y-3">
      {filteredAgents.map((agent) => {
        const agentStatus = resolveAgentStatus(agent);
        const isMindosCard = agent.key === 'mindos';
        const inMatrix = matrixAgentKeys.has(agent.key);

        // Absent agents only "have" skills because universal-mode entries scan
        // the shared dir — don't present that as installed skills.
        const installedNames = agent.present ? [...(agent.installedSkillNames ?? [])].sort() : [];
        // Skills MindOS knows nothing about — read-only, fully agent-owned.
        const unmanagedNative = installedNames.filter((name) => !matrixSkillNames.has(name));

        const rows: MatrixRow[] = !isMindosCard && inMatrix && agent.present
          ? filteredMatrixSkills.map((skill) => ({
            skill,
            status: matrix?.cells[skill.name]?.[agent.key]?.status,
          }))
          : [];
        const enabledRows = rows.filter((row) => isSkillCellOn(row.status));
        const parkedRows = rows.filter((row) => row.status === 'native-disabled');
        const availableRows = rows.filter((row) => !isSkillCellOn(row.status) && row.status !== 'native-disabled');

        const mindosRows = isMindosCard
          ? [...filteredMindosSkills].sort((a, b) => {
            if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
            return a.name.localeCompare(b.name);
          })
          : [];
        const totalSkills = isMindosCard
          ? mindosRows.filter((skill) => skill.enabled).length
          : enabledRows.length + unmanagedNative.length;

        return (
          <div key={agent.key} className="rounded-xl border border-border bg-card hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-200 overflow-hidden">
            <div className="flex items-center gap-3 p-4 pb-0">
              <AgentAvatar name={agent.name} status={agentStatus} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link href={`/agents/${encodeURIComponent(agent.key)}`} className="text-sm font-medium text-foreground hover:underline cursor-pointer truncate">
                    {agent.name}
                  </Link>
                  {agent.skillMode && (
                    <span className={`text-2xs px-1.5 py-0.5 rounded shrink-0 ${
                      agent.skillMode === 'additional' ? 'bg-[var(--amber-dim)] text-[var(--amber-text)]' : 'bg-muted text-muted-foreground'
                    }`}>
                      {agent.skillMode}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-2xs text-muted-foreground">
                  <span className="tabular-nums">{copy.quickStatsMcp((agent.configuredMcpServers ?? []).length)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{copy.quickStatsSkills(totalSkills)}</span>
                </div>
              </div>
            </div>

            <div className="p-4 pt-3 space-y-3">
              {isMindosCard ? (
                mindosRows.length > 0 && (
                  <CellGroup heading={copy.agentMindosSkills} count={`${mindosRows.filter((s) => s.enabled).length}/${mindosRows.length}`}>
                    {mindosRows.map((skill) => (
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
                          {!isBuiltinSkillOrigin(skill.origin) && skill.path && (
                            <span className="text-2xs font-mono text-muted-foreground/60 truncate max-w-[200px]" title={skill.path}>
                              {skillSourceFolder(skill.path, skill.name)}
                            </span>
                          )}
                        </div>
                        <Toggle size="sm" checked={skill.enabled} onChange={(v) => void onToggleSkill(skill.name, v)} />
                      </div>
                    ))}
                  </CellGroup>
                )
              ) : (
                <>
                  {enabledRows.length > 0 && (
                    <CellGroup heading={copy.agentEnabledSkills} count={`${enabledRows.length}`}>
                      {enabledRows.map((row) => (
                        <MatrixCellRow key={row.skill.name} row={row} agent={agent} copy={copy} busyCell={busyCell} onOpenDetail={onOpenDetail} onCellAction={handleCellAction} />
                      ))}
                    </CellGroup>
                  )}
                  {parkedRows.length > 0 && (
                    <CellGroup heading={copy.agentParkedSkills} count={`${parkedRows.length}`}>
                      {parkedRows.map((row) => (
                        <MatrixCellRow key={row.skill.name} row={row} agent={agent} copy={copy} busyCell={busyCell} onOpenDetail={onOpenDetail} onCellAction={handleCellAction} />
                      ))}
                    </CellGroup>
                  )}
                  {availableRows.length > 0 && (
                    <CollapsedAvailable copy={copy} count={availableRows.length}>
                      {availableRows.map((row) => (
                        <MatrixCellRow key={row.skill.name} row={row} agent={agent} copy={copy} busyCell={busyCell} onOpenDetail={onOpenDetail} onCellAction={handleCellAction} />
                      ))}
                    </CollapsedAvailable>
                  )}
                </>
              )}

              {/* Skills only the agent knows — fully agent-owned, read-only here. */}
              {unmanagedNative.length > 0 && (
                <CellGroup heading={copy.agentNativeSkills} count={`${unmanagedNative.length}`}>
                  {unmanagedNative.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => onOpenDetail(name)}
                      title={agent.installedSkillSourcePath}
                      className="w-full flex items-center gap-1.5 py-1 min-h-[28px] hover:bg-muted/30 -mx-1.5 px-1.5 rounded transition-colors duration-100 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Zap size={12} className="shrink-0 text-muted-foreground/50" aria-hidden="true" />
                      <span className="text-xs text-foreground truncate hover:text-[var(--amber)] transition-colors duration-150">{name}</span>
                      {agent.installedSkillSourcePath && (
                        <span className="text-2xs font-mono text-muted-foreground/60 truncate max-w-[200px] shrink-0">
                          {abbreviateHomePath(agent.installedSkillSourcePath)}
                        </span>
                      )}
                    </button>
                  ))}
                </CellGroup>
              )}

              {!isMindosCard && rows.length === 0 && unmanagedNative.length === 0 && (
                <p className="text-2xs text-muted-foreground/60">—</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ────────── Pieces ────────── */

function CellGroup({ heading, count, children }: { heading: string; count: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
        {heading} <span className="tabular-nums">({count})</span>
      </p>
      <div className="space-y-0.5 max-h-[240px] overflow-y-auto">{children}</div>
    </div>
  );
}

/** "Available to link" is usually long — collapsed by default to keep cards scannable. */
function CollapsedAvailable({ copy, count, children }: { copy: SkillsSectionCopy; count: number; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5 cursor-pointer hover:text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {copy.agentAvailableSkills} <span className="tabular-nums">({count})</span>
      </button>
      {expanded && <div className="space-y-0.5 max-h-[240px] overflow-y-auto">{children}</div>}
    </div>
  );
}

function MatrixCellRow({
  row,
  agent,
  copy,
  busyCell,
  onOpenDetail,
  onCellAction,
}: {
  row: MatrixRow;
  agent: ReturnType<typeof sortAgentsByStatus>[number];
  copy: SkillsSectionCopy;
  busyCell: string | null;
  onOpenDetail: (name: string) => void;
  onCellAction: (skillName: string, agentKey: string, agentName: string, agentMode: string | undefined, status: SkillMatrixCellStatus | undefined) => void;
}) {
  const on = isSkillCellOn(row.status);
  const busy = busyCell === `${row.skill.name}:${agent.key}`;
  const badge = cellBadge(copy, row.status);
  return (
    <div className="flex items-center justify-between gap-2 py-1 min-h-[32px] hover:bg-muted/30 -mx-1.5 px-1.5 rounded transition-colors duration-100">
      <div className="flex items-center gap-1.5 min-w-0">
        <Zap size={12} className={`shrink-0 ${on ? 'text-[var(--amber)]' : 'text-muted-foreground/50'}`} aria-hidden="true" />
        <button
          type="button"
          onClick={() => onOpenDetail(row.skill.name)}
          className="text-xs text-foreground truncate hover:text-[var(--amber)] cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded text-left"
        >
          {row.skill.name}
        </button>
        <span className="text-2xs text-muted-foreground shrink-0">
          {copy.groupLabels[capabilityForSkill(row.skill) as keyof typeof copy.groupLabels]}
        </span>
        {badge && (
          <span className={`text-2xs px-1.5 py-0.5 rounded shrink-0 ${badge.className}`} title={badge.title}>
            {badge.label}
          </span>
        )}
        {!isBuiltinSkillOrigin(row.skill.origin) && row.skill.path && (
          <span className="text-2xs font-mono text-muted-foreground/60 truncate max-w-[200px]" title={row.skill.path}>
            {skillSourceFolder(row.skill.path, row.skill.name)}
          </span>
        )}
      </div>
      <Toggle
        size="sm"
        checked={on}
        disabled={busy}
        title={!on && agent.skillMode === 'universal' ? copy.poolShareHint : undefined}
        onChange={() => onCellAction(row.skill.name, agent.key, agent.name, agent.skillMode, row.status)}
      />
    </div>
  );
}

/** Badge describing HOW this agent gets the skill (managed link vs its own dir vs parked). */
function cellBadge(
  copy: SkillsSectionCopy,
  status: SkillMatrixCellStatus | undefined,
): { label: string; className: string; title?: string } | null {
  if (status === 'linked' || status === 'copied') {
    return { label: copy.availabilityLinked, className: 'bg-[var(--amber-subtle)] text-[var(--amber-text)]' };
  }
  if (status === 'conflict') {
    return { label: copy.sourceAgentOwned, className: 'bg-muted text-muted-foreground' };
  }
  if (status === 'native-disabled') {
    return { label: copy.cellParked, className: 'bg-muted text-muted-foreground/70', title: copy.cellParkedHint };
  }
  if (status === 'broken') {
    return { label: copy.cellBroken, className: 'bg-destructive/10 text-destructive' };
  }
  return null;
}
