'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Zap } from 'lucide-react';
import { Toggle } from '@/components/settings/Primitives';
import type { McpContextValue } from '@/lib/stores/mcp-store';
import {
  aggregateCrossAgentSkills,
  capabilityForSkill,
  resolveAgentStatus,
  sortAgentsByStatus,
} from './agents-content-model';
import { AgentAvatar, EmptyState } from './AgentsPrimitives';
import type { SkillsSectionCopy } from './AgentsSkillsSection';

/* ────────── By Agent View ────────── */

export default function ByAgentView({
  copy,
  agents,
  skills,
  crossAgentSkills,
  query,
  onToggleSkill,
  onOpenDetail,
}: {
  copy: SkillsSectionCopy;
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
  copy: SkillsSectionCopy;
  onToggleSkill: (name: string, enabled: boolean) => Promise<boolean>;
  onOpenDetail: (name: string) => void;
}) {
  const [nativeExpanded, setNativeExpanded] = useState(false);
  const NATIVE_COLLAPSE_THRESHOLD = 6;
  const showNativeToggle = nativeSkills.length > NATIVE_COLLAPSE_THRESHOLD;
  const visibleNative = nativeExpanded ? nativeSkills : nativeSkills.slice(0, NATIVE_COLLAPSE_THRESHOLD);

  return (
    <div className="rounded-xl border border-border bg-card hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-200 overflow-hidden">
      <div className="flex items-center gap-3 p-4 pb-0">
        <AgentAvatar name={name} status={status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={`/agents/${encodeURIComponent(agentKey)}`} className="text-sm font-medium text-foreground hover:underline cursor-pointer truncate">
              {name}
            </Link>
            {skillMode && (
              <span className={`text-2xs px-1.5 py-0.5 rounded shrink-0 ${
                skillMode === 'universal' ? 'bg-muted text-muted-foreground'
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
