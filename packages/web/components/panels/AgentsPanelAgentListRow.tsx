'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, ChevronRight, Globe, Loader2, RotateCw } from 'lucide-react';
import type { AgentInfo } from '../settings/types';
import { AgentAvatar } from '../agents/AgentsPrimitives';

export type AgentsPanelAgentListStatus = 'connected' | 'detected' | 'notFound';

export interface AgentsPanelAgentListRowCopy {
  installing: string;
  install: string;
  installSuccess: string;
  installFailed: string;
  retryInstall: string;
}

export default function AgentsPanelAgentListRow({
  agent,
  agentStatus,
  selected = false,
  detailHref,
  onInstallAgent,
  copy,
  isA2aReady = false,
  a2aTooltip,
}: {
  agent: AgentInfo;
  agentStatus: AgentsPanelAgentListStatus;
  selected?: boolean;
  detailHref: string;
  onInstallAgent: (key: string) => Promise<boolean>;
  copy: AgentsPanelAgentListRowCopy;
  isA2aReady?: boolean;
  a2aTooltip?: string;
}) {
  return (
    <div
      className={`
        group flex items-center gap-0 rounded-lg border transition-[background-color,border-color,box-shadow] duration-150
        ${selected
          ? 'border-[var(--amber)]/35 bg-[var(--amber-dim)]/45 shadow-sm'
          : 'border-border/70 bg-card/50 hover:border-border hover:bg-muted/25'}
      `}
    >
      <Link
        href={detailHref}
        className="flex flex-1 min-w-0 items-center gap-2.5 text-left rounded-lg pl-2.5 pr-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <AgentAvatar name={agent.name} status={agentStatus} size="sm" />
        <span className="text-sm font-medium text-foreground truncate leading-tight" title={agent.name}>{agent.name}</span>
        {isA2aReady && (
          <span title={a2aTooltip} className="shrink-0 text-muted-foreground/70">
            <Globe size={12} />
          </span>
        )}
        <span className="flex-1 min-w-[4px]" />
        <ChevronRight
          size={15}
          className={`shrink-0 transition-opacity duration-150 ${selected ? 'text-[var(--amber)] opacity-90' : 'text-muted-foreground/45 group-hover:text-muted-foreground/80'}`}
          aria-hidden
        />
      </Link>

      {agentStatus === 'detected' && (
        <div className="pr-2 py-2 shrink-0">
          <AgentInstallButton agentKey={agent.key} agentName={agent.name} onInstallAgent={onInstallAgent} copy={copy} />
        </div>
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
  const [installState, setInstallState] = useState<'idle' | 'success' | 'error'>('idle');

  const handleInstall = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (installing) return;
    setInstalling(true);
    setInstallState('idle');
    const ok = await onInstallAgent(agentKey);
    setInstalling(false);
    setInstallState(ok ? 'success' : 'error');
  };

  const isError = installState === 'error';
  const isSuccess = installState === 'success';
  const label = installing
    ? copy.installing
    : isSuccess
      ? copy.installSuccess
      : isError
        ? copy.retryInstall
        : copy.install;

  return (
    <button
      type="button"
      onClick={handleInstall}
      disabled={installing}
      className={`flex items-center gap-1 px-2 py-1.5 text-2xs rounded-lg font-medium text-white disabled:opacity-50 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        isError ? 'bg-error hover:bg-error/90' : isSuccess ? 'bg-success hover:bg-success/90' : 'bg-[var(--amber)] hover:bg-[var(--amber)]/90'
      }`}
      aria-label={`${agentName} ${label}`}
    >
      {installing ? <Loader2 size={10} className="animate-spin" /> : null}
      {!installing && isSuccess ? <Check size={10} /> : null}
      {!installing && isError ? <RotateCw size={10} /> : null}
      {label}
      <span className="sr-only" aria-live="polite">
        {isError ? copy.installFailed : ''}
      </span>
    </button>
  );
}
