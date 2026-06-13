'use client';

import { Loader2, AlertTriangle } from 'lucide-react';
import type { SkillMatrix, SettingsMcpMessages } from './types';

type SkillCellAction = 'link' | 'unlink' | 'disable-native' | 'enable-native';

interface SkillAgentChipsProps {
  skillName: string;
  matrix: SkillMatrix;
  /** `${skillName}:${agentKey}` of the cell currently being linked/unlinked, or null. */
  linkingCell: string | null;
  onAgentLink: (name: string, agentKey: string, action: SkillCellAction) => void;
  m: SettingsMcpMessages | undefined;
}

/**
 * Per-skill agent chips — one toggleable chip per detected external agent
 * (everything in matrix.agents except the MindOS self column).
 * Cell status drives the visual state and the action a click performs:
 *   linked/copied → on (click unlinks), none → off (click links),
 *   broken → warning (click relinks),
 *   conflict → on, agent-owned (click parks it under .mindos-disabled),
 *   native-disabled → off, parked (click restores the original directory).
 */
export default function SkillAgentChips({ skillName, matrix, linkingCell, onAgentLink, m }: SkillAgentChipsProps) {
  const externalAgents = matrix.agents.filter(agent => agent.mode !== 'self');

  return (
    <div className="space-y-1.5">
      <p className="text-2xs text-muted-foreground font-medium">{m?.skillAgentsHeading ?? 'Agents'}</p>
      {externalAgents.length === 0 ? (
        <p className="text-2xs text-muted-foreground">
          {m?.skillAgentsEmpty ?? 'No external agents with Skill support detected'}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {externalAgents.map(agent => {
            const cell = matrix.cells[skillName]?.[agent.key] ?? { enabled: false, status: 'none' as const };
            const busy = linkingCell === `${skillName}:${agent.key}`;
            const conflict = cell.status === 'conflict';
            const broken = cell.status === 'broken';
            const parked = cell.status === 'native-disabled';
            const enabled = cell.status === 'linked' || cell.status === 'copied' || conflict;
            const action: SkillCellAction = conflict
              ? 'disable-native'
              : parked
                ? 'enable-native'
                : enabled
                  ? 'unlink'
                  : 'link'; // none & broken both (re)link
            const title = conflict
              ? (m?.skillNativeOnHint ?? "Agent-owned skill — click to disable (parked under .mindos-disabled, nothing is deleted)")
              : parked
                ? (m?.skillNativeDisabledHint ?? 'Disabled (parked under .mindos-disabled) — click to restore')
                : broken
                  ? (m?.skillLinkBrokenHint ?? 'Link broken — click to relink')
                  : !enabled && agent.mode === 'universal'
                    ? (m?.skillPoolShareHint ?? 'Installs into the shared ~/.agents/skills pool — visible to every universal agent')
                    : undefined;
            const stateClass = conflict
              ? 'border-dashed border-[var(--amber)] bg-[var(--amber-subtle)] text-[var(--amber-text)]'
              : parked
                ? 'border-dashed border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                : broken
                  ? 'border-destructive/50 text-destructive hover:bg-destructive/10'
                  : enabled
                    ? 'border-[var(--amber)] bg-[var(--amber-subtle)] text-[var(--amber-text)] font-medium'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted';
            return (
              <button
                key={agent.key}
                type="button"
                data-agent-key={agent.key}
                disabled={busy}
                title={title}
                aria-pressed={enabled}
                onClick={() => onAgentLink(skillName, agent.key, action)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-2xs rounded-full border transition-colors disabled:cursor-not-allowed ${stateClass}`}
              >
                {busy ? <Loader2 size={9} className="animate-spin" /> : broken ? <AlertTriangle size={9} /> : null}
                {agent.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
