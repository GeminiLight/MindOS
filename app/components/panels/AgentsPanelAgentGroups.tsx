'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AgentInfo } from '../settings/types';
import AgentsPanelAgentListRow, { type AgentsPanelAgentListRowCopy } from './AgentsPanelAgentListRow';

type AgentsCopy = {
  rosterLabel: string;
  sectionConnected: string;
  sectionDetected: string;
  sectionNotDetected: string;
};

export function AgentsPanelAgentGroups({
  connected,
  detected,
  notFound,
  selectedAgentKey,
  onInstallAgent,
  listCopy,
  showNotDetected,
  setShowNotDetected,
  p,
}: {
  connected: AgentInfo[];
  detected: AgentInfo[];
  notFound: AgentInfo[];
  selectedAgentKey?: string | null;
  onInstallAgent: (key: string) => Promise<boolean>;
  listCopy: AgentsPanelAgentListRowCopy;
  showNotDetected: boolean;
  setShowNotDetected: (v: boolean | ((prev: boolean) => boolean)) => void;
  p: AgentsCopy;
}) {
  return (
    <div>
      <div className="px-0 py-1.5 mb-1">
        <span className="text-2xs font-semibold text-muted-foreground/70 uppercase tracking-wider">{p.rosterLabel}</span>
      </div>
      {connected.length > 0 && (
        <section className="mb-3">
          <h3 className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wider mb-2 pl-0.5">
            <span className="w-1 h-3 rounded-full bg-[var(--success)]/50" aria-hidden="true" />
            {p.sectionConnected} <span className="text-muted-foreground/50 tabular-nums">({connected.length})</span>
          </h3>
          <div className="space-y-1.5">
            {connected.map(agent => (
              <AgentsPanelAgentListRow
                key={agent.key}
                agent={agent}
                agentStatus="connected"
                selected={selectedAgentKey === agent.key}
                detailHref={`/agents/${encodeURIComponent(agent.key)}`}
                onInstallAgent={onInstallAgent}
                copy={listCopy}
              />
            ))}
          </div>
        </section>
      )}

      {detected.length > 0 && (
        <section className="mb-3">
          <h3 className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wider mb-2 pl-0.5">
            <span className="w-1 h-3 rounded-full bg-[var(--amber)]/50" aria-hidden="true" />
            {p.sectionDetected} <span className="text-muted-foreground/50 tabular-nums">({detected.length})</span>
          </h3>
          <div className="space-y-1.5">
            {detected.map(agent => (
              <AgentsPanelAgentListRow
                key={agent.key}
                agent={agent}
                agentStatus="detected"
                selected={selectedAgentKey === agent.key}
                detailHref={`/agents/${encodeURIComponent(agent.key)}`}
                onInstallAgent={onInstallAgent}
                copy={listCopy}
              />
            ))}
          </div>
        </section>
      )}

      {notFound.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setShowNotDetected(!showNotDetected)}
            className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm pl-0.5"
          >
            {showNotDetected ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {p.sectionNotDetected} ({notFound.length})
          </button>
          {showNotDetected && (
            <div className="space-y-1.5">
              {notFound.map(agent => (
                <AgentsPanelAgentListRow
                  key={agent.key}
                  agent={agent}
                  agentStatus="notFound"
                  selected={selectedAgentKey === agent.key}
                  detailHref={`/agents/${encodeURIComponent(agent.key)}`}
                  onInstallAgent={onInstallAgent}
                  copy={listCopy}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
