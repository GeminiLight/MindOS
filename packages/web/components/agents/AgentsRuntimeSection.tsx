'use client';

import Link from 'next/link';
import { AlertTriangle, Bot, CheckCircle2, Loader2, MessageSquare, Network, RefreshCw, ShieldCheck } from 'lucide-react';
import { useNativeRuntimeDetection } from '@/hooks/useNativeRuntimeDetection';
import { openAskModal } from '@/hooks/useAskModal';
import { compactRuntimeDisplayReason } from '@/lib/agent/runtime-error-display';
import { useLocale } from '@/lib/stores/locale-store';
import type { AgentRuntimeDescriptor, AgentRuntimeIdentity, AgentRuntimeStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { AgentSectionHeading } from './AgentsPrimitives';

type NativeRuntimeKind = 'codex' | 'claude';
type EndpointStatus = AgentRuntimeStatus | 'checking';
type RuntimeEndpointKind = 'mindos' | NativeRuntimeKind;

interface RuntimeEndpoint {
  key: RuntimeEndpointKind;
  name: string;
  description: string;
  detail: string;
  status: EndpointStatus;
  icon: RuntimeEndpointKind;
  runtime: AgentRuntimeIdentity | null;
  disabled?: boolean;
  href?: string;
}

interface AgentsRuntimeSectionProps {
  variant?: 'page' | 'panel';
  showContracts?: boolean;
}

function runtimeStatusLabel(status: EndpointStatus, copy: ReturnType<typeof useLocale>['t']['agentsContent']['runtime']): string {
  if (status === 'available') return copy.statusAvailable;
  if (status === 'checking') return copy.statusChecking;
  if (status === 'signed-out') return copy.statusSignedOut;
  if (status === 'error') return copy.statusError;
  return copy.statusMissing;
}

function runtimeStatusClasses(status: EndpointStatus): string {
  if (status === 'available') return 'border-success/20 bg-success/10 text-success';
  if (status === 'checking') return 'border-border bg-muted text-muted-foreground';
  if (status === 'signed-out' || status === 'missing') return 'border-[var(--amber)]/20 bg-[var(--amber)]/10 text-[var(--amber-text)]';
  return 'border-error/20 bg-error/10 text-error';
}

function runtimeStatusIcon(status: EndpointStatus) {
  if (status === 'available') return <CheckCircle2 size={13} aria-hidden="true" />;
  if (status === 'checking') return <Loader2 size={13} className="animate-spin" aria-hidden="true" />;
  return <AlertTriangle size={13} aria-hidden="true" />;
}

function RuntimeStatusMark({
  status,
  label,
  className,
}: {
  status: EndpointStatus;
  label: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn('inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', runtimeStatusClasses(status), className)}
    >
      {runtimeStatusIcon(status)}
    </span>
  );
}

function runtimeIcon(kind: RuntimeEndpointKind, size = 'h-8 w-8') {
  if (kind === 'mindos') {
    return (
      <span className={`${size} inline-flex items-center justify-center overflow-hidden rounded-lg bg-[var(--amber)]/10`}>
        <img src="/logo-square.svg" alt="" aria-hidden="true" className="h-5 w-5 object-contain" />
      </span>
    );
  }
  if (kind === 'codex') {
    return (
      <span className={`${size} inline-flex items-center justify-center rounded-lg border border-border/60 bg-background`}>
        <img src="/agent-icons/openai.svg" alt="" aria-hidden="true" className="h-5 w-5 object-contain" />
      </span>
    );
  }
  if (kind === 'claude') {
    return (
      <span className={`${size} inline-flex items-center justify-center rounded-lg border border-border/60 bg-background`}>
        <img src="/agent-icons/claude.svg" alt="" aria-hidden="true" className="h-5 w-5 object-contain" />
      </span>
    );
  }
  return (
    <span className={`${size} inline-flex items-center justify-center rounded-lg border border-border/60 bg-muted/45 text-muted-foreground`}>
      <Network size={16} aria-hidden="true" />
    </span>
  );
}

function nativeEndpoint(
  kind: NativeRuntimeKind,
  runtime: AgentRuntimeDescriptor | undefined,
  loading: boolean,
  error: string | null | undefined,
  copy: ReturnType<typeof useLocale>['t']['agentsContent']['runtime'],
): RuntimeEndpoint {
  const fallbackName = kind === 'codex' ? 'Codex' : 'Claude Code';
  const status: EndpointStatus = loading ? 'checking' : error ? 'error' : runtime?.status ?? 'missing';
  const reason = error ?? runtime?.availability?.reason;
  const compactReason = compactRuntimeDisplayReason(reason, {
    runtime: kind,
    fallback: copy.unavailableDetail,
  });
  const description = kind === 'codex' ? copy.codexDescription : copy.claudeDescription;
  const detail = status === 'checking'
    ? copy.checkingDetail(fallbackName)
    : status === 'available'
      ? runtime?.runtimeBridge?.label ?? copy.nativeAvailableDetail
      : status === 'missing'
        ? copy.missingDetail(fallbackName)
        : compactReason;

  return {
    key: kind,
    name: runtime?.name ?? fallbackName,
    description,
    detail,
    status,
    icon: kind,
    runtime: runtime ? {
      id: runtime.id,
      name: runtime.name,
      kind: runtime.kind,
      ...(runtime.binaryPath ? { binaryPath: runtime.binaryPath } : {}),
    } : { id: kind, name: fallbackName, kind },
    disabled: status !== 'available',
  };
}

function buildEndpoints({
  runtimes,
  loadingByKind,
  errorByKind,
  copy,
}: {
  runtimes: AgentRuntimeDescriptor[];
  loadingByKind: Partial<Record<NativeRuntimeKind, boolean>>;
  errorByKind: Partial<Record<NativeRuntimeKind, string | null>>;
  copy: ReturnType<typeof useLocale>['t']['agentsContent']['runtime'];
}): RuntimeEndpoint[] {
  const codex = runtimes.find((runtime) => runtime.kind === 'codex' && runtime.id === 'codex');
  const claude = runtimes.find((runtime) => runtime.kind === 'claude' && runtime.id === 'claude');

  return [
    {
      key: 'mindos',
      name: copy.mindosName,
      description: copy.mindosDescription,
      detail: copy.mindosDetail,
      status: 'available',
      icon: 'mindos',
      runtime: null,
    },
    nativeEndpoint('codex', codex, loadingByKind.codex === true, errorByKind.codex, copy),
    nativeEndpoint('claude', claude, loadingByKind.claude === true, errorByKind.claude, copy),
  ];
}

export default function AgentsRuntimeSection({
  variant = 'page',
  showContracts = true,
}: AgentsRuntimeSectionProps) {
  const { t } = useLocale();
  const copy = t.agentsContent.runtime;
  const native = useNativeRuntimeDetection();
  const endpoints = buildEndpoints({
    runtimes: native.runtimes,
    loadingByKind: native.loadingByKind,
    errorByKind: native.errorByKind,
    copy,
  });

  const openRuntime = (endpoint: RuntimeEndpoint) => {
    if (endpoint.disabled) return;
    openAskModal('', 'user', endpoint.runtime);
  };

  if (variant === 'panel') {
    return (
      <div className="px-3 py-3">
        <AgentSectionHeading
          as="h3"
          size="sm"
          icon={<Bot size={12} aria-hidden="true" />}
          title={copy.panelTitle}
          descriptionTooltip={copy.panelDescription}
          titleClassName="text-[11px] uppercase tracking-wider text-muted-foreground/80"
          className="mb-3"
        />
        <div className="space-y-1.5">
          {endpoints.map((endpoint) => (
            endpoint.href ? (
              <Link
                key={endpoint.key}
                href={endpoint.href}
                className="flex min-h-[58px] items-center gap-2.5 rounded-lg border border-border/50 bg-card/35 px-2.5 py-2 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {runtimeIcon(endpoint.icon, 'h-7 w-7')}
                <EndpointPanelText endpoint={endpoint} copy={copy} />
              </Link>
            ) : (
              <button
                key={endpoint.key}
                type="button"
                onClick={() => openRuntime(endpoint)}
                disabled={endpoint.disabled}
                className="flex min-h-[58px] w-full items-center gap-2.5 rounded-lg border border-border/50 bg-card/35 px-2.5 py-2 text-left transition-colors hover:bg-muted/45 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {runtimeIcon(endpoint.icon, 'h-7 w-7')}
                <EndpointPanelText endpoint={endpoint} copy={copy} />
              </button>
            )
          ))}
        </div>
        <button
          type="button"
          onClick={native.refresh}
          className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-2xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RefreshCw size={12} aria-hidden="true" />
          {copy.refresh}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <AgentSectionHeading
            icon={<Bot size={14} aria-hidden="true" />}
            title={copy.title}
            descriptionTooltip={copy.description}
          />
          <button
            type="button"
            onClick={native.refresh}
            className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw size={13} aria-hidden="true" />
            {copy.refresh}
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {endpoints.map((endpoint) => (
            <EndpointCard
              key={endpoint.key}
              endpoint={endpoint}
              copy={copy}
              onOpen={() => openRuntime(endpoint)}
            />
          ))}
        </div>
      </section>

      {showContracts && <AgentsRuntimeContractsSection />}
    </div>
  );
}

function EndpointPanelText({
  endpoint,
  copy,
}: {
  endpoint: RuntimeEndpoint;
  copy: ReturnType<typeof useLocale>['t']['agentsContent']['runtime'];
}) {
  const statusLabel = runtimeStatusLabel(endpoint.status, copy);

  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-foreground">{endpoint.name}</span>
        <RuntimeStatusMark status={endpoint.status} label={statusLabel} />
      </span>
      <span className="mt-1 block truncate text-2xs text-muted-foreground">{endpoint.detail}</span>
    </span>
  );
}

function EndpointCard({
  endpoint,
  copy,
  onOpen,
}: {
  endpoint: RuntimeEndpoint;
  copy: ReturnType<typeof useLocale>['t']['agentsContent']['runtime'];
  onOpen: () => void;
}) {
  const isPrimary = endpoint.key === 'mindos';
  const showDetail = endpoint.status !== 'available';
  const statusLabel = runtimeStatusLabel(endpoint.status, copy);

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={endpoint.disabled}
      className={cn(
        'group relative flex min-h-[132px] w-full flex-col rounded-lg border bg-card/45 py-4 pl-4 pr-10 text-left shadow-[0_1px_2px_0_color-mix(in_srgb,var(--foreground)_5%,transparent)] transition-[background-color,border-color,box-shadow] duration-150 hover:bg-card hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-65',
        isPrimary ? 'border-[var(--amber)]/55 bg-[var(--amber-subtle)]/35' : 'border-border/60 hover:border-border',
      )}
    >
      <RuntimeStatusMark status={endpoint.status} label={statusLabel} className="absolute right-3 top-3" />
      <span className="flex items-start gap-3">
        {runtimeIcon(endpoint.icon, 'h-10 w-10')}
        <span className="min-w-0">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">{endpoint.name}</span>
            {isPrimary ? (
              <span className="rounded border border-[var(--amber)]/25 bg-[var(--amber)]/10 px-1.5 py-0.5 text-2xs font-medium text-[var(--amber-text)]">
                {copy.defaultTag}
              </span>
            ) : null}
          </span>
          <span className="mt-2 block line-clamp-2 text-xs leading-relaxed text-muted-foreground">{endpoint.description}</span>
        </span>
      </span>
      {showDetail ? (
        <span className="mt-3 block truncate rounded-md border border-border/40 bg-background/45 px-2.5 py-1.5 text-2xs text-muted-foreground">
          {endpoint.detail}
        </span>
      ) : null}
      <span className="mt-auto flex w-full items-center justify-end pt-3">
        <span className="ml-auto inline-flex items-center gap-1 text-2xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
          <MessageSquare size={11} aria-hidden="true" />
          {copy.openChatWith(endpoint.name)}
        </span>
      </span>
    </button>
  );
}

export function AgentsRuntimeContractsSection({ variant = 'grid' }: { variant?: 'grid' | 'compact' }) {
  const { t } = useLocale();
  const copy = t.agentsContent.runtime;
  const contracts = [
    {
      icon: <ShieldCheck size={14} aria-hidden="true" />,
      title: copy.contractModelTitle,
      description: copy.contractModelDescription,
    },
    {
      icon: <Bot size={14} aria-hidden="true" />,
      title: copy.contractPermissionTitle,
      description: copy.contractPermissionDescription,
    },
    {
      icon: <Network size={14} aria-hidden="true" />,
      title: copy.contractSessionTitle,
      description: copy.contractSessionDescription,
    },
  ];

  if (variant === 'compact') {
    return (
      <section className="rounded-xl border border-border/60 bg-card/35 p-4">
        <AgentSectionHeading
          as="h3"
          size="sm"
          icon={<ShieldCheck size={12} aria-hidden="true" />}
          title={copy.contractModelTitle}
          description={copy.contractModelDescription}
          className="mb-3"
        />
        <div className="divide-y divide-border/45">
          {contracts.slice(1).map((contract) => (
            <div key={contract.title} className="flex gap-2 py-3 first:pt-0 last:pb-0">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                {contract.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-foreground">{contract.title}</span>
                <span className="mt-1 block text-2xs leading-relaxed text-muted-foreground">{contract.description}</span>
              </span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="grid gap-3 md:grid-cols-3">
      {contracts.map((contract) => (
        <RuntimeContractCard
          key={contract.title}
          icon={contract.icon}
          title={contract.title}
          description={contract.description}
        />
      ))}
    </section>
  );
}

function RuntimeContractCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
          {icon}
        </span>
        {title}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}
