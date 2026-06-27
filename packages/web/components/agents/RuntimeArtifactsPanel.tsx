'use client';

import Link from 'next/link';
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  ExternalLink,
  FileText,
  GitBranch,
  History,
  Link2,
  ListChecks,
  RefreshCw,
} from 'lucide-react';
import { useAgentChangeReview, type AgentReviewChangeEvent } from '@/hooks/useAgentChangeReview';
import { useRuntimeArtifactProjections } from '@/hooks/useRuntimeArtifactProjections';
import { agentReviewHref } from '@/lib/agent-review-links';
import { useLocale } from '@/lib/stores/locale-store';
import type { AgentRuntimeArtifactProjection } from '@/lib/types';
import { cn, encodePath } from '@/lib/utils';
import { AgentSectionHeading } from './AgentsPrimitives';
import { KindBadge, formatTs, opKind, relativeTs } from './agent-activity-shared';

type ArtifactsCopy = ReturnType<typeof useLocale>['t']['agentsContent']['artifacts'];
type ArtifactPointer = AgentRuntimeArtifactProjection['artifactIndex']['recentArtifacts'][number];
type ArtifactWithRuntime = {
  artifact: ArtifactPointer;
  runtimeId: string;
  runtimeName: string;
};
type Tone = 'success' | 'warning' | 'error' | 'neutral';

function formatEnumValue(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'mindos') return 'MindOS';
      if (lower === 'mcp') return 'MCP';
      if (lower === 'acp') return 'ACP';
      if (lower === 'a2a') return 'A2A';
      if (lower === 'pr') return 'PR';
      if (lower === 'uri') return 'URI';
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function statusTone(status: AgentRuntimeArtifactProjection['status']): Tone {
  if (status === 'ready') return 'success';
  if (status === 'limited' || status === 'unknown') return 'warning';
  if (status === 'blocked') return 'error';
  return 'neutral';
}

function artifactStatusTone(status: ArtifactPointer['status']): Tone {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'pending' || status === 'in_progress') return 'warning';
  return 'neutral';
}

function toneClasses(tone: Tone): string {
  if (tone === 'success') return 'border-success/20 bg-success/10 text-success';
  if (tone === 'warning') return 'border-[var(--amber)]/20 bg-[var(--amber)]/10 text-[var(--amber-text)]';
  if (tone === 'error') return 'border-error/20 bg-error/10 text-error';
  return 'border-border/50 bg-muted/45 text-muted-foreground';
}

function CompactBadge({
  label,
  tone = 'neutral',
  title,
}: {
  label: string;
  tone?: Tone;
  title?: string;
}) {
  return (
    <span
      className={cn('inline-flex h-6 max-w-full shrink-0 items-center rounded-full border px-2 text-2xs font-medium', toneClasses(tone))}
      title={title ?? label}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

function normalizeViewPath(value: string | undefined): string | null {
  const raw = value?.trim().replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[a-zA-Z]:/.test(raw) || raw.includes('\0')) return null;
  const parts: string[] = [];
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') return null;
    parts.push(part);
  }
  return parts.length > 0 ? parts.join('/') : null;
}

function viewHrefForPath(value: string | undefined): string | null {
  const normalized = normalizeViewPath(value);
  return normalized ? `/view/${encodePath(normalized)}` : null;
}

function externalUriHref(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatArtifactTime(value: number, locale: string): string {
  if (!Number.isFinite(value)) return '';
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function artifactTitle(artifact: ArtifactPointer): string {
  return artifact.title ?? artifact.path ?? artifact.uri ?? formatEnumValue(artifact.kind);
}

function RuntimeProjectionRow({
  projection,
  copy,
}: {
  projection: AgentRuntimeArtifactProjection;
  copy: ArtifactsCopy;
}) {
  const reviewable = projection.reviewableOutputKinds.length > 0
    ? projection.reviewableOutputKinds.map(formatEnumValue).join(', ')
    : copy.none;
  const blockers = projection.blockers ?? [];

  return (
    <article className="rounded-lg border border-border/50 bg-background/55 p-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(180px,0.85fr)_minmax(0,1.2fr)_minmax(180px,0.8fr)]">
        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/45 bg-card/70 text-muted-foreground">
              <Archive size={15} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-foreground" title={projection.runtimeName}>
                {projection.runtimeName}
              </span>
              <span className="mt-1 block truncate text-2xs text-muted-foreground">
                {formatEnumValue(projection.runtimeKind)} · {projection.runtimeId}
              </span>
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <CompactBadge label={formatEnumValue(projection.status)} tone={statusTone(projection.status)} />
            <CompactBadge label={copy.indexedArtifacts(projection.artifactIndex.recordCount)} />
          </div>
        </div>

        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
            <ListChecks size={11} aria-hidden="true" />
            {copy.runtimeReviewable}
          </div>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            <CompactBadge label={`${copy.output}: ${reviewable}`} title={reviewable} />
            <CompactBadge
              label={projection.rollback.supported ? copy.rollbackSupported : copy.rollbackUnavailable}
              tone={projection.rollback.supported ? 'success' : 'neutral'}
            />
            <CompactBadge
              label={projection.branchPr.supported ? copy.branchPrSupported : copy.branchPrUnavailable}
              tone={projection.branchPr.supported ? 'success' : 'neutral'}
            />
          </div>
          <p className="line-clamp-2 text-2xs leading-relaxed text-muted-foreground" title={projection.artifactIndex.summary}>
            {projection.artifactIndex.summary}
          </p>
        </div>

        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
            <AlertCircle size={11} aria-hidden="true" />
            {copy.blockers}
          </div>
          {blockers.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {blockers.slice(0, 3).map((blocker) => (
                <CompactBadge key={blocker} label={formatEnumValue(blocker)} tone="warning" />
              ))}
              {blockers.length > 3 ? <CompactBadge label={`+${blockers.length - 3}`} /> : null}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-md border border-success/20 bg-success/10 px-2.5 py-2 text-2xs text-success">
              <CheckCircle2 size={11} aria-hidden="true" />
              {copy.noBlockers}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function ArtifactPointerRow({
  item,
  copy,
  locale,
}: {
  item: ArtifactWithRuntime;
  copy: ArtifactsCopy;
  locale: string;
}) {
  const { artifact } = item;
  const viewHref = viewHrefForPath(artifact.path);
  const uriHref = externalUriHref(artifact.uri);
  const title = artifactTitle(artifact);
  const subtitle = artifact.summary ?? artifact.mimeType ?? artifact.uri ?? artifact.path ?? copy.pointerOnly;

  return (
    <li className="rounded-lg border border-border/45 bg-background/55 p-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/45 bg-card/70 text-muted-foreground">
          {artifact.uri && !artifact.path ? <Link2 size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="min-w-0 max-w-full truncate text-sm font-medium text-foreground" title={title}>
              {title}
            </span>
            {Number.isFinite(artifact.line) ? <CompactBadge label={copy.line(artifact.line ?? 0)} /> : null}
          </div>
          <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-muted-foreground" title={subtitle}>
            {subtitle}
          </p>
          <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
            <CompactBadge label={formatEnumValue(artifact.kind)} />
            <CompactBadge label={formatEnumValue(artifact.status)} tone={artifactStatusTone(artifact.status)} />
            <CompactBadge label={item.runtimeName} />
            {artifact.runId ? <CompactBadge label={`${copy.run}: ${artifact.runId}`} title={artifact.runId} /> : null}
            {artifact.toolName ? <CompactBadge label={`${copy.tool}: ${artifact.toolName}`} title={artifact.toolName} /> : null}
            <CompactBadge label={formatArtifactTime(artifact.updatedAt, locale)} title={String(artifact.updatedAt)} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {viewHref ? (
              <Link
                href={viewHref}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FileText size={11} aria-hidden="true" />
                {copy.openFile}
              </Link>
            ) : null}
            {artifact.path ? (
              <Link
                href={agentReviewHref(artifact.path)}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--amber)]/25 bg-[var(--amber-subtle)] px-2 text-2xs font-medium text-[var(--amber-text)] transition-colors hover:bg-[var(--amber)]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <History size={11} aria-hidden="true" />
                {copy.reviewChanges}
              </Link>
            ) : null}
            {uriHref ? (
              <a
                href={uriHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ExternalLink size={11} aria-hidden="true" />
                {copy.openUri}
              </a>
            ) : null}
            {!viewHref && !artifact.path && !uriHref ? (
              <span className="inline-flex h-7 items-center rounded-md border border-border/45 bg-muted/35 px-2 text-2xs text-muted-foreground">
                {copy.pointerOnly}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

function FileChangeRow({
  event,
  copy,
  locale,
}: {
  event: AgentReviewChangeEvent;
  copy: ArtifactsCopy;
  locale: string;
}) {
  const kind = opKind(event.op);
  const viewHref = viewHrefForPath(event.path);

  return (
    <li className="rounded-lg border border-border/45 bg-background/55 p-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <KindBadge kind={kind} locale={locale} size="sm" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {viewHref ? (
              <Link
                href={viewHref}
                className="min-w-0 max-w-full truncate font-mono text-xs font-medium text-[var(--amber)] transition-colors hover:text-[var(--amber-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={event.path}
              >
                {event.path}
              </Link>
            ) : (
              <span className="min-w-0 max-w-full truncate font-mono text-xs font-medium text-foreground" title={event.path}>
                {event.path}
              </span>
            )}
            <CompactBadge label={event.op} />
          </div>
          <p className="mt-1 line-clamp-2 text-2xs leading-relaxed text-muted-foreground" title={event.summary}>
            {event.summary}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <CompactBadge label={relativeTs(event.ts)} title={formatTs(event.ts)} />
            <Link
              href={agentReviewHref(event.path)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--amber)]/25 bg-[var(--amber-subtle)] px-2 text-2xs font-medium text-[var(--amber-text)] transition-colors hover:bg-[var(--amber)]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <History size={11} aria-hidden="true" />
              {copy.reviewChanges}
            </Link>
          </div>
        </div>
      </div>
    </li>
  );
}

function RuntimeArtifactsSkeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-2" aria-hidden="true">
      {[0, 1].map((item) => (
        <div key={item} className="rounded-lg border border-border/40 bg-background/45 p-3 motion-safe:animate-pulse">
          <div className="h-3.5 w-36 rounded bg-muted/60" />
          <div className="mt-3 h-14 rounded bg-muted/35" />
          <div className="mt-2 h-14 rounded bg-muted/35" />
        </div>
      ))}
    </div>
  );
}

export default function RuntimeArtifactsPanel() {
  const { locale, t } = useLocale();
  const copy = t.agentsContent.artifacts;
  const projections = useRuntimeArtifactProjections({ visible: true });
  const changes = useAgentChangeReview({ enabled: true, limit: 20 });
  const busy = projections.loading || changes.loading;
  const readyCount = projections.projections.filter((projection) => projection.status === 'ready').length;
  const attentionCount = Math.max(0, projections.projections.length - readyCount);
  const indexedArtifactCount = projections.projections.reduce(
    (sum, projection) => sum + projection.artifactIndex.recordCount,
    0,
  );
  const recentArtifacts = projections.projections
    .flatMap((projection): ArtifactWithRuntime[] => projection.artifactIndex.recentArtifacts.map((artifact) => ({
      artifact,
      runtimeId: projection.runtimeId,
      runtimeName: projection.runtimeName,
    })))
    .sort((left, right) => right.artifact.updatedAt - left.artifact.updatedAt)
    .slice(0, 8);
  const recentChanges = changes.events.slice(0, 8);

  const refreshAll = () => {
    projections.refresh();
    void changes.refresh();
  };

  return (
    <section className="rounded-xl border border-border/60 bg-card/35 p-4" aria-labelledby="runtime-artifacts-title">
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <AgentSectionHeading
            id="runtime-artifacts-title"
            as="h3"
            size="sm"
            icon={<Archive size={12} aria-hidden="true" />}
            title={copy.title}
            descriptionTooltip={copy.description}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {projections.projections.length > 0 ? (
              <>
                <span className="rounded-md border border-border/45 bg-background/50 px-2 py-1 text-2xs text-muted-foreground">
                  {copy.summary(projections.projections.length, readyCount, attentionCount)}
                </span>
                <span className="rounded-md border border-border/45 bg-background/50 px-2 py-1 text-2xs text-muted-foreground">
                  {copy.indexedArtifacts(indexedArtifactCount)}
                </span>
                <span className="rounded-md border border-border/45 bg-background/50 px-2 py-1 text-2xs text-muted-foreground">
                  {copy.fileChanges(changes.events.length, changes.unreadAgentCount)}
                </span>
              </>
            ) : busy ? (
              <span className="rounded-md border border-border/45 bg-background/50 px-2 py-1 text-2xs text-muted-foreground">
                {copy.loading}
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={refreshAll}
          disabled={busy}
          className="inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border px-2.5 text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55"
        >
          <RefreshCw size={12} className={busy ? 'motion-safe:animate-spin' : undefined} aria-hidden="true" />
          {copy.refresh}
        </button>
      </div>

      {projections.error ? (
        <div role="alert" className="mb-3 rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-xs leading-relaxed text-error">
          {copy.error(projections.error)}
        </div>
      ) : null}

      {projections.projections.length === 0 && busy ? (
        <RuntimeArtifactsSkeleton />
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
              <ListChecks size={11} aria-hidden="true" />
              {copy.runtimeReadiness}
            </div>
            {projections.projections.length > 0 ? (
              <div className="space-y-2">
                {projections.projections.map((projection) => (
                  <RuntimeProjectionRow
                    key={projection.runtimeId}
                    projection={projection}
                    copy={copy}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-border/45 bg-background/45 px-3 py-6 text-center text-xs text-muted-foreground">
                {copy.emptyRuntimes}
              </div>
            )}
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <section className="min-w-0 space-y-2" aria-labelledby="runtime-artifacts-recent-title">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <h4 id="runtime-artifacts-recent-title" className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
                  <Archive size={11} aria-hidden="true" />
                  {copy.recentArtifacts}
                </h4>
                <CompactBadge label={String(recentArtifacts.length)} />
              </div>
              {recentArtifacts.length > 0 ? (
                <ul className="space-y-2">
                  {recentArtifacts.map((item) => (
                    <ArtifactPointerRow
                      key={`${item.runtimeId}:${item.artifact.id}`}
                      item={item}
                      copy={copy}
                      locale={locale}
                    />
                  ))}
                </ul>
              ) : (
                <div className="rounded-lg border border-border/45 bg-background/45 px-3 py-8 text-center text-xs text-muted-foreground">
                  {copy.emptyArtifacts}
                </div>
              )}
            </section>

            <section className="min-w-0 space-y-2" aria-labelledby="runtime-artifacts-changes-title">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <h4 id="runtime-artifacts-changes-title" className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
                  <GitBranch size={11} aria-hidden="true" />
                  {copy.fileChangesTitle}
                </h4>
                <CompactBadge
                  label={copy.unreviewedChanges(changes.unreadAgentCount)}
                  tone={changes.unreadAgentCount > 0 ? 'warning' : 'neutral'}
                />
              </div>
              {recentChanges.length > 0 ? (
                <ul className="space-y-2">
                  {recentChanges.map((event) => (
                    <FileChangeRow
                      key={event.id}
                      event={event}
                      copy={copy}
                      locale={locale}
                    />
                  ))}
                </ul>
              ) : (
                <div className="rounded-lg border border-border/45 bg-background/45 px-3 py-8 text-center text-xs text-muted-foreground">
                  {copy.emptyChanges}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </section>
  );
}
