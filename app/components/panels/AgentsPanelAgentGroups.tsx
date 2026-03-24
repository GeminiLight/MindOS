'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AgentInfo } from '../settings/types';
import type { McpContextValue } from '@/hooks/useMcpData';
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
  onOpenDetail,
  mcp,
  listCopy,
  showNotDetected,
  setShowNotDetected,
  p,
}: {
  connected: AgentInfo[];
  detected: AgentInfo[];
  notFound: AgentInfo[];
  onOpenDetail: (key: string) => void;
  mcp: Pick<McpContextValue, 'installAgent'>;
  listCopy: AgentsPanelAgentListRowCopy;
  showNotDetected: boolean;
  setShowNotDetected: (v: boolean | ((prev: boolean) => boolean)) => void;
  p: AgentsCopy;
}) {
  return (
    <div>
      <div className="px-0 py-1 mb-1">
        <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">{p.rosterLabel}</span>
      </div>
      {connected.length > 0 && (
        <section className="mb-3">
          <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            {p.sectionConnected} ({connected.length})
          </h3>
          <div className="space-y-1.5">
            {connected.map(agent => (
              <AgentsPanelAgentListRow
                key={agent.key}
                agent={agent}
                agentStatus="connected"
                onOpenDetail={() => onOpenDetail(agent.key)}
                onInstallAgent={mcp.installAgent}
                copy={listCopy}
              />
            ))}
          </div>
        </section>
      )}

      {detected.length > 0 && (
        <section className="mb-3">
          <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
            {p.sectionDetected} ({detected.length})
          </h3>
          <div className="space-y-1.5">
            {detected.map(agent => (
              <AgentsPanelAgentListRow
                key={agent.key}
                agent={agent}
                agentStatus="detected"
                onOpenDetail={() => onOpenDetail(agent.key)}
                onInstallAgent={mcp.installAgent}
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
            className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
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
                  onOpenDetail={() => onOpenDetail(agent.key)}
                  onInstallAgent={mcp.installAgent}
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
