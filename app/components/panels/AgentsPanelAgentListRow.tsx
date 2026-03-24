'use client';

import { useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import type { AgentInfo } from '../settings/types';

export type AgentsPanelAgentListStatus = 'connected' | 'detected' | 'notFound';

export interface AgentsPanelAgentListRowCopy {
  installing: string;
  install: (name: string) => string;
}

export default function AgentsPanelAgentListRow({
  agent,
  agentStatus,
  onOpenDetail,
  onInstallAgent,
  copy,
}: {
  agent: AgentInfo;
  agentStatus: AgentsPanelAgentListStatus;
  onOpenDetail: () => void;
  onInstallAgent: (key: string) => Promise<boolean>;
  copy: AgentsPanelAgentListRowCopy;
}) {
  const dot =
    agentStatus === 'connected' ? 'bg-emerald-500' : agentStatus === 'detected' ? 'bg-amber-500' : 'bg-zinc-400';

  return (
    <div className="rounded-lg border border-border/60 bg-card/30 flex items-center gap-2 px-3 py-2">
      <button
        type="button"
        onClick={onOpenDetail}
        className="flex flex-1 min-w-0 items-center gap-2 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight size={14} className="text-muted-foreground shrink-0" />
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
        <span className="text-xs font-medium text-foreground truncate">{agent.name}</span>
        {agentStatus === 'connected' && agent.transport && (
          <span className="text-2xs px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{agent.transport}</span>
        )}
      </button>

      {agentStatus === 'detected' && (
        <AgentInstallButton agentKey={agent.key} agentName={agent.name} onInstallAgent={onInstallAgent} copy={copy} />
      )}
    </div>
  );
}

function AgentInstallButton({
  agentKey,
  agentName,
  onInstallAgent,
  copy,
}: {
  agentKey: string;
  agentName: string;
  onInstallAgent: (key: string) => Promise<boolean>;
  copy: AgentsPanelAgentListRowCopy;
}) {
  const [installing, setInstalling] = useState(false);

  const handleInstall = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setInstalling(true);
    await onInstallAgent(agentKey);
    setInstalling(false);
  };

  return (
    <button
      type="button"
      onClick={handleInstall}
      disabled={installing}
      className="flex items-center gap-1 px-2 py-1 text-2xs rounded-md font-medium text-[var(--amber-foreground)] disabled:opacity-50 transition-colors shrink-0 bg-[var(--amber)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {installing ? <Loader2 size={10} className="animate-spin" /> : null}
      {installing ? copy.installing : copy.install(agentName)}
    </button>
  );
}
