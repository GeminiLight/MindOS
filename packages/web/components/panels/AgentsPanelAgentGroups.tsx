'use client';

import { Bot, CheckCircle2, ChevronDown, ChevronRight, Circle, Search } from 'lucide-react';
import { AgentSectionHeading } from '../agents/AgentsPrimitives';
import type { AgentInfo } from '../settings/types';
import AgentsPanelAgentListRow, { type AgentsPanelAgentListRowCopy } from './AgentsPanelAgentListRow';

type AgentsCopy = {
  rosterLabel: string;
  sectionConnected: string;
  sectionDetected: string;
  sectionNotDetected: string;
  showMore?: (n: number) => string;
};

const MAX_PANEL_DETECTED_AGENTS = 3;

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
  const visibleDetected = detected.slice(0, MAX_PANEL_DETECTED_AGENTS);
  const hiddenDetected = detected.slice(MAX_PANEL_DETECTED_AGENTS);
  const showMoreDetected = p.showMore ?? ((n: number) => `${n} more`);

  return (
    <div>
      <div className="mb-3 px-0 py-1">
        <AgentSectionHeading
          as="h3"
          size="sm"
          icon={<Bot size={12} aria-hidden="true" />}
          title={p.rosterLabel}
          titleClassName="text-[11px] uppercase tracking-wider text-muted-foreground/80"
        />
      </div>
      {connected.length > 0 && (
        <section className="mb-3">
          <PanelGroupHeading icon={<CheckCircle2 size={12} aria-hidden="true" />} title={p.sectionConnected} count={connected.length} />
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
          <PanelGroupHeading icon={<Search size={12} aria-hidden="true" />} title={p.sectionDetected} count={detected.length} />
          <div className="space-y-1.5">
            {visibleDetected.map(agent => (
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
            {hiddenDetected.length > 0 && (
              <details>
                <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-2 py-1 text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span>{showMoreDetected(hiddenDetected.length)}</span>
                  <ChevronDown size={12} aria-hidden="true" />
                </summary>
                <div className="mt-1.5 space-y-1.5">
                  {hiddenDetected.map(agent => (
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
              </details>
            )}
          </div>
        </section>
      )}

      {notFound.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setShowNotDetected(!showNotDetected)}
            className="mb-2 flex w-full items-start gap-2.5 rounded-md text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
              <Circle size={12} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 pt-[1px] text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {p.sectionNotDetected} <span className="text-muted-foreground/50 tabular-nums">({notFound.length})</span>
            </span>
            <span className="pt-0.5 text-muted-foreground/60">
              {showNotDetected ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
            </span>
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

function PanelGroupHeading({
  icon,
  title,
  count,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
}) {
  return (
    <AgentSectionHeading
      as="h3"
      size="sm"
      icon={icon}
      title={(
        <>
          {title} <span className="text-muted-foreground/50 tabular-nums">({count})</span>
        </>
      )}
      titleClassName="text-[11px] uppercase tracking-wider text-muted-foreground/80"
      className="mb-2"
    />
  );
}
