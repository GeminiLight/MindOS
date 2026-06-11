'use client';

import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { Bot, CheckCircle2, ChevronDown, ChevronRight, Circle, Plus, Search } from 'lucide-react';
import type { AgentBuckets } from './agents-content-model';
import type { AgentInfo } from '@/components/settings/types';
import { useLocale } from '@/lib/stores/locale-store';
import { AgentAvatar, AgentSectionHeading } from './AgentsPrimitives';
import { cn } from '@/lib/utils';

type LocalClientStatus = 'connected' | 'detected' | 'notFound';

interface AgentsLocalClientsSectionProps {
  buckets: AgentBuckets;
  onAddCustomAgent?: () => void;
  onEditCustomAgent?: (agent: AgentInfo) => void;
  onRemoveCustomAgent?: (agent: AgentInfo) => void;
}

const MAX_VISIBLE_DETECTED_CLIENTS = 5;

function statusLabel(status: LocalClientStatus, copy: ReturnType<typeof useLocale>['t']['agentsContent']['localClients']): string {
  if (status === 'connected') return copy.statusConnected;
  if (status === 'detected') return copy.statusDetected;
  return copy.statusNotFound;
}

function statusClasses(status: LocalClientStatus): string {
  if (status === 'connected') return 'border-success/20 bg-success/10 text-success';
  if (status === 'detected') return 'border-[var(--amber)]/20 bg-[var(--amber)]/10 text-[var(--amber-text)]';
  return 'border-border bg-muted text-muted-foreground';
}

function statusIcon(status: LocalClientStatus) {
  if (status === 'connected') return <CheckCircle2 size={13} aria-hidden="true" />;
  if (status === 'detected') return <Search size={13} aria-hidden="true" />;
  return <Circle size={13} aria-hidden="true" />;
}

function LocalClientStatusMark({
  status,
  label,
  className,
}: {
  status: LocalClientStatus;
  label: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn('inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', statusClasses(status), className)}
    >
      {statusIcon(status)}
    </span>
  );
}

function groupTitle(
  status: LocalClientStatus | 'custom',
  count: number,
  copy: ReturnType<typeof useLocale>['t']['agentsContent']['localClients'],
): ReactNode {
  const title = status === 'connected'
    ? copy.groupConnected
    : status === 'detected'
      ? copy.groupDetected
      : status === 'custom'
        ? copy.groupCustom
        : copy.groupNotFound;
  return (
    <>
      {title} <span className="text-muted-foreground/50 tabular-nums">({count})</span>
    </>
  );
}

function agentPath(agent: AgentInfo): string | null {
  return agent.hiddenRootPath ?? agent.configPath ?? agent.globalPath ?? null;
}

function resolveLocalClientStatus(agent: AgentInfo): LocalClientStatus {
  if (agent.present && agent.installed) return 'connected';
  if (agent.present) return 'detected';
  return 'notFound';
}

export default function AgentsLocalClientsSection({
  buckets,
  onAddCustomAgent,
  onEditCustomAgent,
  onRemoveCustomAgent,
}: AgentsLocalClientsSectionProps) {
  const { t } = useLocale();
  const headingId = useId();
  const copy = t.agentsContent.localClients;
  const allAgents = [...buckets.connected, ...buckets.detected, ...buckets.notFound];
  const customAgents = allAgents.filter((agent) => agent.isCustom);
  const builtInConnected = buckets.connected.filter((agent) => !agent.isCustom);
  const builtInDetected = buckets.detected.filter((agent) => !agent.isCustom);
  const builtInNotFound = buckets.notFound.filter((agent) => !agent.isCustom);
  const total = builtInConnected.length + builtInDetected.length + builtInNotFound.length + customAgents.length;
  const hasPrimaryAgents = builtInConnected.length > 0 || builtInDetected.length > 0 || customAgents.length > 0;
  const visibleDetected = builtInDetected.slice(0, MAX_VISIBLE_DETECTED_CLIENTS);
  const hiddenDetected = builtInDetected.slice(MAX_VISIBLE_DETECTED_CLIENTS);
  const localClientGroups: Array<{ status: LocalClientStatus; agents: AgentInfo[] }> = [
    { status: 'connected', agents: builtInConnected },
    { status: 'detected', agents: visibleDetected },
  ];
  const visibleGroups = localClientGroups.filter((group) => group.agents.length > 0);

  return (
    <section className="space-y-3" aria-labelledby={headingId}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <AgentSectionHeading
          id={headingId}
          icon={<Bot size={14} aria-hidden="true" />}
          title={copy.title}
          descriptionTooltip={copy.description}
        />
        {onAddCustomAgent && total > 0 ? (
          <button
            type="button"
            onClick={onAddCustomAgent}
            className="inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus size={13} aria-hidden="true" />
            {copy.addCustomClient}
          </button>
        ) : null}
      </div>

      {total === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card/45 px-4 py-8 text-center">
          <p className="text-sm font-medium text-foreground">{copy.emptyTitle}</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{copy.emptyDescription}</p>
          {onAddCustomAgent ? (
            <button
              type="button"
              onClick={onAddCustomAgent}
              className="mt-4 inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus size={13} aria-hidden="true" />
              {copy.addCustomClient}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {visibleGroups.map(({ status, agents }) => (
            <section key={status} className="space-y-2">
              <div className="flex items-center justify-between gap-3 border-b border-border/45 px-1 pb-2 text-xs font-semibold text-foreground">
                <span>{groupTitle(status, status === 'detected' ? builtInDetected.length : agents.length, copy)}</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {agents.map((agent) => (
                  <LocalClientTile
                    key={agent.key}
                    agent={agent}
                    status={status}
                    copy={copy}
                    onEdit={onEditCustomAgent}
                    onRemove={onRemoveCustomAgent}
                  />
                ))}
              </div>
              {status === 'detected' && hiddenDetected.length > 0 && (
                <details className="rounded-lg border border-border/45 bg-background/35">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <span>{copy.showMore(hiddenDetected.length)}</span>
                    <ChevronDown size={12} aria-hidden="true" />
                  </summary>
                  <div className="grid gap-2 border-t border-border/45 p-2 md:grid-cols-2 xl:grid-cols-3">
                    {hiddenDetected.map((agent) => (
                      <LocalClientTile
                        key={agent.key}
                        agent={agent}
                        status="detected"
                        copy={copy}
                        onEdit={onEditCustomAgent}
                        onRemove={onRemoveCustomAgent}
                      />
                    ))}
                  </div>
                </details>
              )}
            </section>
          ))}

          {customAgents.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-3 border-b border-border/45 px-1 pb-2 text-xs font-semibold text-foreground">
                <span>{groupTitle('custom', customAgents.length, copy)}</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {customAgents.map((agent) => (
                  <LocalClientTile
                    key={agent.key}
                    agent={agent}
                    status={resolveLocalClientStatus(agent)}
                    copy={copy}
                    onEdit={onEditCustomAgent}
                    onRemove={onRemoveCustomAgent}
                  />
                ))}
              </div>
            </section>
          )}

          {builtInNotFound.length > 0 && (
            <details
              className="rounded-lg border border-border/45 bg-card/35"
              open={!hasPrimaryAgents}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <span className="text-xs font-semibold text-foreground">
                  {groupTitle('notFound', builtInNotFound.length, copy)}
                </span>
                <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                  {copy.expandNotFound}
                  <ChevronDown size={12} aria-hidden="true" />
                </span>
              </summary>
              <div className="grid gap-2 border-t border-border/45 p-2 md:grid-cols-2 xl:grid-cols-3">
                {builtInNotFound.map((agent) => (
                  <LocalClientTile
                    key={agent.key}
                    agent={agent}
                    status="notFound"
                    copy={copy}
                    onEdit={onEditCustomAgent}
                    onRemove={onRemoveCustomAgent}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function LocalClientTile({
  agent,
  status,
  copy,
  onEdit,
  onRemove,
}: {
  agent: AgentInfo;
  status: LocalClientStatus;
  copy: ReturnType<typeof useLocale>['t']['agentsContent']['localClients'];
  onEdit?: (agent: AgentInfo) => void;
  onRemove?: (agent: AgentInfo) => void;
}) {
  const path = agentPath(agent);
  const label = statusLabel(status, copy);
  const hasCustomActions = agent.isCustom && (onEdit || onRemove);

  return (
    <article className="group relative overflow-hidden rounded-lg border border-border/55 bg-card/45 shadow-[0_1px_2px_0_color-mix(in_srgb,var(--foreground)_4%,transparent)] transition-colors hover:border-border hover:bg-card">
      <LocalClientStatusMark status={status} label={label} className="absolute right-3 top-3" />
      <Link
        href={`/agents/${encodeURIComponent(agent.key)}`}
        className="grid min-h-[88px] grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 py-3 pl-3 pr-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <AgentAvatar name={agent.name} />
        <span className="min-w-0">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-medium text-foreground">{agent.name}</span>
          </span>
          <span className="mt-1 block truncate text-2xs text-muted-foreground">
            {path ?? copy.noMetadata}
          </span>
        </span>
        <span className="flex h-full shrink-0 items-center justify-center">
          <ChevronRight size={13} className="text-muted-foreground/45 transition-colors group-hover:text-muted-foreground" aria-hidden="true" />
        </span>
      </Link>
      {hasCustomActions ? (
        <div className="flex items-center justify-end gap-2 border-t border-border/45 px-3 py-2">
          {onEdit ? (
            <button
              type="button"
              onClick={() => onEdit(agent)}
              className="rounded-md px-2 py-1 text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {copy.editCustomClient}
            </button>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(agent)}
              className="rounded-md px-2 py-1 text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-[var(--error)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {copy.removeCustomClient}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
