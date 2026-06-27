'use client';

import { Activity, AlertCircle, AlertTriangle, CheckCircle2, CircleDashed, ListChecks, RefreshCw, Terminal } from 'lucide-react';
import { useRuntimeCatalog } from '@/hooks/useRuntimeCatalog';
import { useRuntimeReadiness } from '@/hooks/useRuntimeReadiness';
import { useLocale } from '@/lib/stores/locale-store';
import type {
  AgentRuntimeCatalogEntry,
  AgentRuntimeDiagnosticCheck,
  AgentRuntimeDiagnosticCheckStatus,
  AgentRuntimeReadinessGap,
  AgentRuntimeReadinessProjection,
  AgentRuntimeReadinessStatus,
  AgentRuntimeStatus,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { AgentSectionHeading } from './AgentsPrimitives';

type RuntimeCopy = ReturnType<typeof useLocale>['t']['agentsContent']['runtime'];

interface RuntimeDiagnosticsPanelProps {
  onRefreshNative?: () => void;
}

type Tone = 'success' | 'warning' | 'error' | 'neutral';

function runtimeStatusLabel(status: AgentRuntimeStatus, copy: RuntimeCopy): string {
  if (status === 'available') return copy.statusAvailable;
  if (status === 'signed-out') return copy.statusSignedOut;
  if (status === 'error') return copy.statusError;
  return copy.statusMissing;
}

function readinessStatusLabel(status: AgentRuntimeReadinessStatus | undefined, copy: RuntimeCopy): string {
  if (status === 'ready') return copy.diagnosticsReadinessReady;
  if (status === 'usable') return copy.diagnosticsReadinessUsable;
  if (status === 'limited') return copy.diagnosticsReadinessLimited;
  if (status === 'blocked') return copy.diagnosticsReadinessBlocked;
  return copy.diagnosticsReadinessUnknown;
}

function availabilityTone(status: AgentRuntimeStatus): Tone {
  if (status === 'available') return 'success';
  if (status === 'missing' || status === 'signed-out') return 'warning';
  return 'error';
}

function readinessTone(status: AgentRuntimeReadinessStatus | undefined): Tone {
  if (status === 'ready' || status === 'usable') return 'success';
  if (status === 'limited' || status === 'unknown' || !status) return 'warning';
  return 'error';
}

function toneClasses(tone: Tone): string {
  if (tone === 'success') return 'border-success/20 bg-success/10 text-success';
  if (tone === 'warning') return 'border-[var(--amber)]/20 bg-[var(--amber)]/10 text-[var(--amber-text)]';
  if (tone === 'error') return 'border-error/20 bg-error/10 text-error';
  return 'border-border bg-muted text-muted-foreground';
}

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
      if (lower === 'cli') return 'CLI';
      if (lower === 'sdk') return 'SDK';
      if (lower === 'id') return 'ID';
      if (lower === 'pr') return 'PR';
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function formatList(values: string[], emptyLabel: string, limit = 3): string {
  if (values.length === 0) return emptyLabel;
  const visible = values.slice(0, limit).map(formatEnumValue);
  const hidden = values.length - visible.length;
  return hidden > 0 ? `${visible.join(', ')} +${hidden}` : visible.join(', ');
}

function formatCommand(entry: AgentRuntimeCatalogEntry): string | null {
  const command = entry.diagnostics.selectedCommand ?? entry.resolvedCommand;
  if (command) {
    return [command.cmd, ...command.args].filter(Boolean).join(' ');
  }
  return entry.diagnostics.binaryPath ?? entry.binaryPath ?? null;
}

function formatGeneratedAt(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function findReadiness(
  entry: AgentRuntimeCatalogEntry,
  readinessByRuntimeId: Record<string, AgentRuntimeReadinessProjection>,
): AgentRuntimeReadinessProjection | undefined {
  return readinessByRuntimeId[entry.runtimeId] ?? readinessByRuntimeId[entry.id];
}

function isRuntimeReady(entry: AgentRuntimeCatalogEntry, readiness: AgentRuntimeReadinessProjection | undefined): boolean {
  if (entry.status !== 'available') return false;
  if (!readiness) return true;
  return readiness.overallStatus === 'ready' || readiness.overallStatus === 'usable';
}

function sortGaps(gaps: AgentRuntimeReadinessGap[]): AgentRuntimeReadinessGap[] {
  const priority: Record<AgentRuntimeReadinessGap['severity'], number> = {
    blocking: 0,
    warning: 1,
    info: 2,
  };
  return [...gaps].sort((a, b) => priority[a.severity] - priority[b.severity]);
}

function notableChecks(checks: AgentRuntimeDiagnosticCheck[]): AgentRuntimeDiagnosticCheck[] {
  const priority: Record<AgentRuntimeDiagnosticCheckStatus, number> = {
    failed: 0,
    warning: 1,
    unknown: 2,
    skipped: 3,
    passed: 4,
  };
  return [...checks].sort((a, b) => priority[a.status] - priority[b.status]);
}

function buildIssues({
  entry,
  readiness,
  copy,
}: {
  entry: AgentRuntimeCatalogEntry;
  readiness: AgentRuntimeReadinessProjection | undefined;
  copy: RuntimeCopy;
}): Array<{ id: string; label: string; summary: string; tone: Tone }> {
  if (readiness?.blockers?.length) {
    return readiness.blockers.slice(0, 2).map((summary, index) => ({
      id: `blocker-${index}`,
      label: copy.diagnosticsBlocker,
      summary,
      tone: 'error',
    }));
  }

  const gaps = readiness ? sortGaps(readiness.gaps).slice(0, 2) : [];
  if (gaps.length > 0) {
    return gaps.map((gap) => ({
      id: gap.id,
      label: gap.severity === 'blocking' ? copy.diagnosticsBlocker : copy.diagnosticsGap,
      summary: gap.summary,
      tone: gap.severity === 'blocking' ? 'error' : gap.severity === 'warning' ? 'warning' : 'neutral',
    }));
  }

  const checks = notableChecks(entry.diagnostics.checks ?? [])
    .filter((check) => check.status !== 'passed')
    .slice(0, 2);
  if (checks.length > 0) {
    return checks.map((check) => ({
      id: check.id,
      label: check.status === 'failed' ? copy.diagnosticsCheckFailed : copy.diagnosticsCheckWarning,
      summary: check.summary,
      tone: check.status === 'failed' ? 'error' : 'warning',
    }));
  }

  if (entry.diagnostics.reason) {
    return [{
      id: 'reason',
      label: copy.diagnosticsReason,
      summary: entry.diagnostics.reason,
      tone: availabilityTone(entry.status),
    }];
  }

  return [{
    id: 'ok',
    label: copy.diagnosticsNoIssues,
    summary: readiness?.summary ?? entry.diagnostics.summary,
    tone: 'success',
  }];
}

function checkSummary(checks: AgentRuntimeDiagnosticCheck[], copy: RuntimeCopy): string {
  const passed = checks.filter((check) => check.status === 'passed').length;
  const warning = checks.filter((check) => check.status === 'warning').length;
  const failed = checks.filter((check) => check.status === 'failed').length;
  return copy.diagnosticsChecksSummary(passed, warning, failed);
}

function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-2xs font-medium', toneClasses(tone))}>
      {tone === 'success' ? <CheckCircle2 size={11} aria-hidden="true" /> : tone === 'error' ? <AlertCircle size={11} aria-hidden="true" /> : <AlertTriangle size={11} aria-hidden="true" />}
      {label}
    </span>
  );
}

function CapabilityChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/45 bg-background/55 px-2 py-1 text-2xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium text-foreground">{value}</span>
    </span>
  );
}

function RuntimeDiagnosticsSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {[0, 1, 2].map((item) => (
        <div key={item} className="rounded-lg border border-border/40 bg-card/35 p-3 motion-safe:animate-pulse">
          <div className="flex gap-3">
            <div className="h-8 w-8 rounded-lg bg-muted/60" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3.5 w-32 rounded bg-muted/60" />
              <div className="h-2.5 w-full max-w-lg rounded bg-muted/40" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RuntimeDiagnosticRow({
  entry,
  readiness,
  copy,
}: {
  entry: AgentRuntimeCatalogEntry;
  readiness: AgentRuntimeReadinessProjection | undefined;
  copy: RuntimeCopy;
}) {
  const capability = entry.capabilitySummary;
  const command = formatCommand(entry);
  const checks = entry.diagnostics.checks ?? [];
  const issues = buildIssues({ entry, readiness, copy });
  const mcpValue = capability.mcpConfig.supportsDescriptorConfig
    ? copy.diagnosticsSupported
    : capability.mcpConfig.declaredCapabilities
      ? formatList(
        Object.entries(capability.mcpConfig.declaredCapabilities)
          .filter(([, supported]) => supported)
          .map(([name]) => name.toUpperCase()),
        copy.diagnosticsUnsupported,
      )
      : copy.diagnosticsUnsupported;

  const chips = [
    { label: copy.diagnosticsCapabilitySession, value: formatEnumValue(capability.session) },
    { label: copy.diagnosticsCapabilityCommands, value: formatEnumValue(capability.commandDiscovery) },
    { label: copy.diagnosticsCapabilityModel, value: formatEnumValue(capability.modelSelection) },
    { label: copy.diagnosticsCapabilityMcp, value: mcpValue },
    { label: copy.diagnosticsCapabilityOutput, value: formatList(capability.output, copy.diagnosticsNone) },
    { label: copy.diagnosticsCapabilityRemote, value: formatEnumValue(capability.remoteMode) },
    { label: copy.diagnosticsCapabilityAutomation, value: formatEnumValue(capability.unattended) },
    { label: copy.diagnosticsCapabilityCoordination, value: formatEnumValue(capability.coordinationRole) },
  ];

  return (
    <article className="rounded-lg border border-border/50 bg-background/55 p-3">
      <div className="grid gap-3 xl:grid-cols-[minmax(190px,0.9fr)_minmax(0,1.35fr)_minmax(220px,0.95fr)]">
        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/45 bg-card/70 text-muted-foreground">
              <Activity size={15} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-foreground">{entry.name}</span>
                <span className="rounded border border-border/45 bg-muted/45 px-1.5 py-0.5 text-2xs text-muted-foreground">
                  {formatEnumValue(entry.category)}
                </span>
              </span>
              <span className="mt-1 block truncate text-2xs text-muted-foreground">
                {entry.adapter} · {entry.runtimeId}
              </span>
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge label={runtimeStatusLabel(entry.status, copy)} tone={availabilityTone(entry.status)} />
            <StatusBadge label={readinessStatusLabel(readiness?.overallStatus, copy)} tone={readinessTone(readiness?.overallStatus)} />
          </div>
          <div className="min-w-0 rounded-md border border-border/40 bg-card/35 px-2.5 py-2">
            <span className="mb-1 flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
              <Terminal size={11} aria-hidden="true" />
              {copy.diagnosticsCommand}
            </span>
            {command ? (
              <code className="block truncate font-mono text-2xs text-foreground" title={command}>{command}</code>
            ) : (
              <span className="block text-2xs text-muted-foreground">{copy.diagnosticsNoCommand}</span>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
            <CircleDashed size={11} aria-hidden="true" />
            {copy.diagnosticsCapabilities}
          </div>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {chips.map((chip) => (
              <CapabilityChip key={chip.label} label={chip.label} value={chip.value} />
            ))}
          </div>
        </div>

        <div className="min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-2xs font-medium text-muted-foreground">
              <ListChecks size={11} aria-hidden="true" />
              {copy.diagnosticsChecks}
            </span>
            <span className="shrink-0 text-2xs text-muted-foreground">{checkSummary(checks, copy)}</span>
          </div>
          <ul className="space-y-1.5">
            {issues.map((issue) => (
              <li key={issue.id} className="rounded-md border border-border/40 bg-card/30 px-2.5 py-2">
                <span className={cn('mb-1 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium', toneClasses(issue.tone))}>
                  {issue.label}
                </span>
                <p className="line-clamp-2 text-2xs leading-relaxed text-muted-foreground" title={issue.summary}>
                  {issue.summary}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}

export default function RuntimeDiagnosticsPanel({ onRefreshNative }: RuntimeDiagnosticsPanelProps) {
  const { locale, t } = useLocale();
  const copy = t.agentsContent.runtime;
  const catalog = useRuntimeCatalog({ visible: true });
  const readiness = useRuntimeReadiness({ visible: true, permissionMode: 'ask' });
  const readyCount = catalog.entries.filter((entry) => isRuntimeReady(entry, findReadiness(entry, readiness.readinessByRuntimeId))).length;
  const attentionCount = Math.max(0, catalog.entries.length - readyCount);
  const busy = catalog.loading || readiness.loading;

  const refreshAll = () => {
    onRefreshNative?.();
    catalog.refresh();
    readiness.refresh();
  };

  return (
    <section className="rounded-xl border border-border/60 bg-card/35 p-4" aria-labelledby="runtime-diagnostics-title">
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <AgentSectionHeading
            id="runtime-diagnostics-title"
            as="h3"
            size="sm"
            icon={<Activity size={12} aria-hidden="true" />}
            title={copy.diagnosticsTitle}
            descriptionTooltip={copy.diagnosticsDescription}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {catalog.catalog ? (
              <>
                <span className="rounded-md border border-border/45 bg-background/50 px-2 py-1 text-2xs text-muted-foreground">
                  {copy.diagnosticsSummary(catalog.entries.length, readyCount, attentionCount)}
                </span>
                <span className="rounded-md border border-border/45 bg-background/50 px-2 py-1 text-2xs text-muted-foreground">
                  {copy.diagnosticsGenerated(formatGeneratedAt(catalog.catalog.generatedAt, locale))}
                </span>
              </>
            ) : busy ? (
              <span className="rounded-md border border-border/45 bg-background/50 px-2 py-1 text-2xs text-muted-foreground">
                {copy.diagnosticsLoading}
              </span>
            ) : null}
            {readiness.error ? (
              <span className="rounded-md border border-[var(--amber)]/20 bg-[var(--amber)]/10 px-2 py-1 text-2xs text-[var(--amber-text)]">
                {copy.diagnosticsReadinessError(readiness.error)}
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
          {copy.diagnosticsRefresh}
        </button>
      </div>

      {catalog.error ? (
        <div role="alert" className="rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-xs leading-relaxed text-error">
          {copy.diagnosticsError(catalog.error)}
        </div>
      ) : catalog.entries.length === 0 && busy ? (
        <RuntimeDiagnosticsSkeleton />
      ) : catalog.entries.length === 0 ? (
        <div className="rounded-lg border border-border/45 bg-background/45 px-3 py-6 text-center text-xs text-muted-foreground">
          {copy.diagnosticsEmpty}
        </div>
      ) : (
        <div className="space-y-2">
          {catalog.entries.map((entry) => (
            <RuntimeDiagnosticRow
              key={entry.id}
              entry={entry}
              readiness={findReadiness(entry, readiness.readinessByRuntimeId)}
              copy={copy}
            />
          ))}
        </div>
      )}
    </section>
  );
}
