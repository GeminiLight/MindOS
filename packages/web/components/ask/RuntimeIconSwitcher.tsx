'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Check, ChevronDown, Loader2, MoreHorizontal, RefreshCw, Settings, TriangleAlert } from 'lucide-react';
import type {
  AgentRuntimeDescriptor,
  AgentRuntimeIdentity,
  AgentRuntimeReadinessGap,
  AgentRuntimeReadinessProjection,
  AgentRuntimeReadinessStatus,
  AgentRuntimeStatus,
  RuntimeSessionBinding,
} from '@/lib/types';
import type { NotInstalledAgent } from '@/hooks/useAcpDetection';
import { useLocale } from '@/lib/stores/locale-store';
import { agentIconFile } from '@/lib/agent-icons';
import { compactRuntimeDisplayHints, compactRuntimeDisplayReason } from '@/lib/agent/runtime-error-display';
import { FLOATING_SURFACE_CLASS } from '@/components/shared/FloatingSurface';

interface RuntimeIconSwitcherProps {
  selectedRuntime: AgentRuntimeIdentity | null;
  onSelect: (runtime: AgentRuntimeIdentity | null) => void;
  runtimeSessionBinding?: RuntimeSessionBinding | null;
  nativeRuntimes?: NativeRuntimeOption[];
  notInstalledAgents?: NotInstalledAgent[];
  loading?: boolean;
  loadingByKind?: Partial<Record<'codex' | 'claude', boolean>>;
  errorByKind?: Partial<Record<'codex' | 'claude', string | null>>;
  runtimeReadinessByRuntimeId?: Record<string, AgentRuntimeReadinessProjection>;
  runtimeReadinessLoading?: boolean;
  acpRuntimes?: AcpRuntimeOption[];
  acpLoading?: boolean;
  acpError?: string | null;
  onRefreshNativeRuntimes?: () => void;
  disabled?: boolean;
}

type RuntimeOption = {
  key: string;
  label: string;
  description: string;
  diagnosticHints?: string[];
  runtime: RuntimeSelectable | null;
  icon: 'mindos' | 'codex' | 'claude' | 'agent';
  iconSrc?: string;
  disabled?: boolean;
  status?: AgentRuntimeStatus | 'checking';
  readiness?: AgentRuntimeReadinessProjection;
};

type RuntimeSelectable = AgentRuntimeIdentity & { status?: AgentRuntimeStatus };
type NativeRuntimeOption = AgentRuntimeIdentity & Partial<Pick<AgentRuntimeDescriptor, 'status' | 'availability' | 'installCmd' | 'packageName' | 'binaryPath' | 'runtimeBridge'>>;
type AcpRuntimeOption = AgentRuntimeIdentity & Partial<Pick<AgentRuntimeDescriptor, 'status' | 'availability' | 'description' | 'binaryPath' | 'resolvedCommand'>>;

function isCodexAgent(agent: Pick<AgentRuntimeIdentity | NotInstalledAgent, 'id' | 'name'>): boolean {
  const name = agent.name.toLowerCase();
  return agent.id === 'codex' || agent.id === 'codex-acp' || name === 'codex' || name.includes('codex');
}

function isClaudeAgent(agent: Pick<AgentRuntimeIdentity | NotInstalledAgent, 'id' | 'name'>): boolean {
  const name = agent.name.toLowerCase();
  return agent.id === 'claude' || agent.id === 'claude-code' || name.includes('claude');
}

function initials(name: string): string {
  const parts = name.split(/[\s\-_]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function acpAgentIconSrc(agent: Pick<AgentRuntimeIdentity | NotInstalledAgent, 'id' | 'name'>): string | undefined {
  const iconFile = agentIconFile(agent.id) ?? agentIconFile(agent.name) ?? agentIconFile(`${agent.id} ${agent.name}`);
  return iconFile ? `/agent-icons/${iconFile}` : undefined;
}

function shortExternalId(id: string): string {
  if (id.length <= 18) return id;
  return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

function runtimeSessionLabel(runtime: AgentRuntimeIdentity): string {
  if (runtime.kind === 'codex') return 'Thread';
  if (runtime.kind === 'claude') return 'Session';
  return 'Session';
}

function runtimeStatusLabel(status: AgentRuntimeStatus | undefined): string | null {
  if (!status || status === 'available') return null;
  if (status === 'signed-out') return 'Signed out';
  if (status === 'error') return 'Error';
  return 'Missing';
}

function runtimeOptionStatusLabel(status: RuntimeOption['status']): string | null {
  if (!status || status === 'available') return null;
  if (status === 'checking') return 'Checking...';
  return runtimeStatusLabel(status);
}

function runtimeReadinessStatusLabel(status: AgentRuntimeReadinessStatus | undefined): string | null {
  if (!status || status === 'ready') return 'Ready';
  if (status === 'usable') return 'Usable';
  if (status === 'limited') return 'Limited';
  if (status === 'blocked') return 'Blocked';
  return 'Unknown';
}

function runtimeReadinessGapPrefix(gap: AgentRuntimeReadinessGap): string {
  if (gap.category === 'mindos-product') return 'MindOS';
  if (gap.category === 'runtime-native') return 'Runtime';
  if (gap.category === 'adapter-contract') return 'Adapter';
  if (gap.category === 'deployment') return 'Deploy';
  if (gap.category === 'user-setup') return 'Setup';
  return 'Shared';
}

function topReadinessGap(readiness: AgentRuntimeReadinessProjection | undefined): AgentRuntimeReadinessGap | null {
  if (!readiness?.gaps.length) return null;
  const severityRank: Record<AgentRuntimeReadinessGap['severity'], number> = {
    blocking: 3,
    warning: 2,
    info: 1,
  };
  const categoryRank: Record<AgentRuntimeReadinessGap['category'], number> = {
    'mindos-product': 5,
    deployment: 4,
    'adapter-contract': 3,
    'runtime-native': 2,
    'user-setup': 1,
    shared: 0,
  };
  return [...readiness.gaps].sort((left, right) => (
    severityRank[right.severity] - severityRank[left.severity] ||
    categoryRank[right.category] - categoryRank[left.category] ||
    left.id.localeCompare(right.id)
  ))[0] ?? null;
}

function runtimeReadinessNote(readiness: AgentRuntimeReadinessProjection | undefined): string | null {
  if (!readiness) return null;
  const gap = topReadinessGap(readiness);
  if (gap) return `${runtimeReadinessGapPrefix(gap)}: ${gap.summary}`;
  if (readiness.overallStatus !== 'ready') return readiness.summary;
  return null;
}

function compactTitleParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join('\n');
}

function optionStatusTitle(option: RuntimeOption): string {
  const statusLabel = runtimeOptionStatusLabel(option.status);
  if (statusLabel) return statusLabel;
  return option.runtime ? `Switch to ${option.label}` : 'Use MindOS';
}

function optionTooltip(option: RuntimeOption, actionLabel: string): string {
  const readinessLabel = runtimeReadinessStatusLabel(option.readiness?.overallStatus);
  const readinessNote = runtimeReadinessNote(option.readiness);
  return compactTitleParts([
    option.label,
    actionLabel,
    option.runtime === null && actionLabel !== 'Use MindOS' ? 'Use MindOS' : null,
    runtimeOptionStatusLabel(option.status),
    readinessLabel && readinessLabel !== 'Ready' ? `Readiness: ${readinessLabel}` : null,
    option.description,
    readinessNote,
    ...(option.diagnosticHints ?? []),
  ]);
}

function RuntimeStatusIcon({
  option,
}: {
  option: Pick<RuntimeOption, 'status' | 'runtime' | 'readiness'>;
}) {
  const iconClass = 'h-3.5 w-3.5';

  if (option.status === 'checking') {
    return <Loader2 size={14} className="animate-spin text-muted-foreground" aria-hidden="true" />;
  }

  if (option.status === 'error') {
    return <TriangleAlert className={`${iconClass} text-[var(--error)]`} aria-hidden="true" />;
  }

  if (option.readiness?.overallStatus === 'blocked') {
    return <TriangleAlert className={`${iconClass} text-[var(--error)]`} aria-hidden="true" />;
  }

  return null;
}

function runtimeStatusPill(option: Pick<RuntimeOption, 'status' | 'runtime' | 'readiness'>): { label: string; tone: 'amber' | 'error' | 'neutral' } | null {
  if (option.status === 'checking') return { label: 'Checking', tone: 'neutral' };
  if (option.status === 'signed-out') return { label: 'Sign in', tone: 'amber' };
  if (option.status === 'missing') return { label: 'Set up', tone: 'neutral' };
  if (option.status === 'error') return { label: 'Fix', tone: 'error' };
  if (option.readiness?.overallStatus === 'blocked') return { label: 'Fix', tone: 'error' };
  return null;
}

function RuntimeStatusBadge({
  option,
}: {
  option: Pick<RuntimeOption, 'status' | 'runtime' | 'readiness'>;
}) {
  const pill = runtimeStatusPill(option);
  if (!pill) return <RuntimeStatusIcon option={option} />;

  const toneClass = pill.tone === 'error'
    ? 'border-[var(--error)]/30 bg-[var(--error)]/10 text-[var(--error)]'
    : pill.tone === 'amber'
      ? 'border-[var(--amber)]/35 bg-[var(--amber)]/10 text-[var(--amber)]'
      : 'border-border/60 bg-muted/45 text-muted-foreground';

  return (
    <span className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[10px] font-medium leading-none ${toneClass}`}>
      {option.status === 'checking' && <Loader2 size={10} className="animate-spin" aria-hidden="true" />}
      {(option.status === 'error' || option.readiness?.overallStatus === 'blocked') && option.status !== 'checking' && (
        <TriangleAlert size={10} aria-hidden="true" />
      )}
      <span>{pill.label}</span>
    </span>
  );
}

function RuntimeStatusSlot({
  option,
}: {
  option: Pick<RuntimeOption, 'status' | 'runtime' | 'readiness'>;
}) {
  return (
    <span className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center">
      <RuntimeStatusBadge option={option} />
    </span>
  );
}

function resolveNativeOptionStatus(
  runtime: NativeRuntimeOption | undefined,
  loading: boolean,
): RuntimeOption['status'] {
  if (loading) return 'checking';
  if (runtime?.status) return runtime.status;
  return runtime ? 'available' : 'missing';
}

function nativeRuntimeAvailableDescription(kind: 'codex' | 'claude', runtime: NativeRuntimeOption | undefined): string {
  if (runtime?.runtimeBridge) {
    if (runtime.runtimeBridge.fallback) {
      const reason = runtime.runtimeBridge.reason
        ? ` ${compactRuntimeDisplayReason(runtime.runtimeBridge.reason, { runtime: kind })}`
        : '';
      return `${runtime.runtimeBridge.label}.${reason}`;
    }
    return `${runtime.runtimeBridge.label}.`;
  }
  return kind === 'codex' ? 'Use local Codex.' : 'Use local Claude Code.';
}

function RuntimeMark({ option, small = false }: { option: Pick<RuntimeOption, 'icon' | 'label' | 'iconSrc'>; small?: boolean }) {
  const size = small ? 'h-5 w-5' : 'h-6 w-6';
  const iconSize = 'h-4 w-4';

  if (option.icon === 'mindos') {
    return (
      <span className={`${size} inline-flex items-center justify-center overflow-hidden rounded-md bg-[var(--amber)]/10`}>
        <img src="/logo-square.svg" alt="" aria-hidden="true" className={`${iconSize} object-contain`} />
      </span>
    );
  }

  if (option.icon === 'codex') {
    return (
      <span className={`${size} inline-flex items-center justify-center rounded-md bg-background border border-border/50`}>
        <img src="/agent-icons/openai.svg" alt="" aria-hidden="true" className={`${iconSize} object-contain`} />
      </span>
    );
  }

  if (option.icon === 'claude') {
    return (
      <span className={`${size} inline-flex items-center justify-center rounded-md bg-background border border-border/50`}>
        <img src="/agent-icons/claude.svg" alt="" aria-hidden="true" className={`${iconSize} object-contain`} />
      </span>
    );
  }

  if (option.iconSrc) {
    return (
      <span className={`${size} inline-flex items-center justify-center overflow-hidden rounded-md bg-background border border-border/50`}>
        <img src={option.iconSrc} alt="" aria-hidden="true" className={`${iconSize} object-contain`} />
      </span>
    );
  }

  return (
    <span
      className={`${size} inline-flex items-center justify-center rounded-md border border-border/50 bg-muted/50 text-muted-foreground`}
      title={initials(option.label)}
    >
      <Bot className={iconSize} aria-hidden="true" />
    </span>
  );
}

export default function RuntimeIconSwitcher({
  selectedRuntime,
  onSelect,
  runtimeSessionBinding,
  nativeRuntimes = [],
  notInstalledAgents = [],
  loading = false,
  loadingByKind = {},
  errorByKind = {},
  runtimeReadinessByRuntimeId = {},
  runtimeReadinessLoading = false,
  acpRuntimes = [],
  acpLoading = false,
  acpError = null,
  onRefreshNativeRuntimes,
  disabled = false,
}: RuntimeIconSwitcherProps) {
  const { t } = useLocale();
  const p = t.panels?.agents ?? {
    acpDefaultAgent: 'MindOS',
    acpSelectAgent: 'Select Agent',
    acpChangeAgent: 'Change agent',
  };
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const options = useMemo<RuntimeOption[]>(() => {
    const codexRuntime = nativeRuntimes.find((runtime) => runtime.kind === 'codex');
    const claudeRuntime = nativeRuntimes.find((runtime) => runtime.kind === 'claude');
    const missingCodex = notInstalledAgents.find(isCodexAgent);
    const missingClaude = notInstalledAgents.find(isClaudeAgent);
    const getReadiness = (runtime: RuntimeSelectable | null | undefined, fallbackKey: string) => {
      const runtimeId = runtime?.id ?? fallbackKey;
      return runtimeReadinessByRuntimeId[runtimeId] ??
        (runtime?.kind ? runtimeReadinessByRuntimeId[runtime.kind] : undefined) ??
        runtimeReadinessByRuntimeId[fallbackKey];
    };

    const nativeOption = (
      kind: 'codex' | 'claude',
      label: string,
      runtime: NativeRuntimeOption | undefined,
      missingAgent: NotInstalledAgent | undefined,
    ): RuntimeOption => {
      const optionLoading = loadingByKind[kind] ?? loading;
      const detectionError = errorByKind[kind];
      const status = optionLoading ? 'checking' : detectionError ? 'error' : resolveNativeOptionStatus(runtime, false);
      const description = status === 'checking'
        ? `Checking local ${label}...`
        : detectionError
          ? `Detection failed. ${compactRuntimeDisplayReason(detectionError, { runtime: kind })}`
          : runtime?.availability?.reason
            ? compactRuntimeDisplayReason(runtime.availability.reason, { runtime: kind })
            : (missingAgent
              ? `Not detected. ${missingAgent.installCmd ? `Install: ${missingAgent.installCmd}` : 'Configure it in Agents settings.'}`
              : nativeRuntimeAvailableDescription(kind, runtime));
      const diagnosticHints = status === 'available'
        ? undefined
        : status === 'checking'
          ? undefined
          : compactRuntimeDisplayHints(runtime?.availability?.diagnosticHints, { runtime: kind })
            .filter((hint) => hint !== description)
            .slice(0, 2);

      return {
        key: `${kind}:${runtime?.id ?? kind}`,
        label: runtime?.name ?? label,
        description,
        ...(diagnosticHints && diagnosticHints.length > 0 ? { diagnosticHints } : {}),
        runtime: runtime ?? { id: kind, name: label, kind },
        icon: kind,
        disabled: status !== 'available',
        status,
        readiness: getReadiness(runtime ?? { id: kind, name: label, kind }, kind),
      };
    };

    const codexOption = nativeOption('codex', 'Codex', codexRuntime, missingCodex);
    const claudeOption = {
      ...nativeOption('claude', 'Claude Code', claudeRuntime, missingClaude),
      icon: 'claude' as const,
    };

    return [
      {
        key: 'mindos',
        label: p.acpDefaultAgent ?? 'MindOS',
        description: 'Uses the selected provider and model.',
        runtime: null,
        icon: 'mindos',
        status: 'available',
        readiness: getReadiness(null, 'mindos'),
      },
      codexOption,
      claudeOption,
    ];
  }, [errorByKind, loading, loadingByKind, nativeRuntimes, notInstalledAgents, p.acpDefaultAgent, runtimeReadinessByRuntimeId]);
  const acpOptions = useMemo<RuntimeOption[]>(() => {
    return acpRuntimes
      .filter((runtime) => runtime.kind === 'acp')
      .map((runtime) => {
        const status = runtime.status ?? 'available';
        const reason = runtime.availability?.reason?.trim();
        const description = reason ||
          runtime.description ||
          (runtime.binaryPath ? `ACP agent at ${runtime.binaryPath}.` : 'ACP agent.');
        const diagnosticHints = compactRuntimeDisplayHints(runtime.availability?.diagnosticHints)
          .filter((hint) => hint !== description)
          .slice(0, 2);
        return {
          key: `acp:${runtime.id}`,
          label: runtime.name,
          description,
          ...(diagnosticHints.length > 0 ? { diagnosticHints } : {}),
          runtime: {
            id: runtime.id,
            name: runtime.name,
            kind: 'acp' as const,
            ...(runtime.binaryPath ? { binaryPath: runtime.binaryPath } : {}),
            ...(status ? { status } : {}),
          },
          icon: isCodexAgent(runtime) ? 'codex' : isClaudeAgent(runtime) ? 'claude' : 'agent',
          ...(!isCodexAgent(runtime) && !isClaudeAgent(runtime) ? { iconSrc: acpAgentIconSrc(runtime) } : {}),
          disabled: status !== 'available',
          status,
          readiness: runtimeReadinessByRuntimeId[runtime.id],
        } satisfies RuntimeOption;
      })
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [acpRuntimes, runtimeReadinessByRuntimeId]);

  const selectedOption = useMemo<RuntimeOption>(() => {
    if (!selectedRuntime) return options[0];
    return [...options, ...acpOptions].find((option) => {
      const runtime = option.runtime;
      return runtime?.kind === selectedRuntime.kind && runtime.id === selectedRuntime.id;
    }) ?? {
      key: `${selectedRuntime.kind}:${selectedRuntime.id}`,
      label: selectedRuntime.name,
      description: 'Selected runtime',
      runtime: selectedRuntime,
      icon: selectedRuntime.kind === 'codex' ? 'codex' : selectedRuntime.kind === 'claude' ? 'claude' : 'agent',
      ...(selectedRuntime.kind === 'acp' ? { iconSrc: acpAgentIconSrc(selectedRuntime) } : {}),
      status: 'available',
      readiness: runtimeReadinessByRuntimeId[selectedRuntime.id] ?? runtimeReadinessByRuntimeId[selectedRuntime.kind],
    };
  }, [acpOptions, options, runtimeReadinessByRuntimeId, selectedRuntime]);
  const canShowSessionBinding = selectedRuntime?.kind === 'codex' || selectedRuntime?.kind === 'claude';
  const sessionLabel = selectedRuntime ? runtimeSessionLabel(selectedRuntime) : 'Session';
  const hasExternalSession = canShowSessionBinding && !!runtimeSessionBinding?.externalSessionId;
  const selectedNativeKind = selectedRuntime?.kind === 'codex' || selectedRuntime?.kind === 'claude'
    ? selectedRuntime.kind
    : null;
  const selectedRuntimeLoading = selectedNativeKind
    ? loadingByKind[selectedNativeKind] ?? loading
    : false;
  const switchOptions = useMemo(() => options.filter((option) => {
    const runtime = option.runtime;
    return selectedRuntime
      ? !(runtime && runtime.kind === selectedRuntime.kind && runtime.id === selectedRuntime.id)
      : runtime !== null;
  }), [options, selectedRuntime]);
  const acpSwitchOptions = useMemo(() => acpOptions.filter((option) => {
    const runtime = option.runtime;
    return !(selectedRuntime?.kind === 'acp' && runtime?.id === selectedRuntime.id);
  }), [acpOptions, selectedRuntime]);
  const canShowMoreAgents = acpLoading || !!acpError || acpSwitchOptions.length > 0;

  useEffect(() => {
    if (!open) {
      setMoreOpen(false);
      return;
    }
    if (selectedRuntime?.kind === 'acp') setMoreOpen(true);
  }, [open, selectedRuntime?.kind]);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDropPos({ top: rect.bottom + 6, left: rect.left, width: Math.max(280, rect.width) });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const handleSelect = useCallback((option: RuntimeOption) => {
    if (option.disabled || disabled) return;
    onSelect(option.runtime);
    setOpen(false);
  }, [disabled, onSelect]);

  const dropdownStyle = dropPos ? (() => {
    const margin = 12;
    const viewportWidth = window.innerWidth;
    const menuWidth = Math.min(340, Math.max(240, viewportWidth - margin * 2));
    const left = Math.max(margin, Math.min(dropPos.left, viewportWidth - menuWidth - margin));
    return {
      top: dropPos.top,
      left,
      minWidth: Math.min(dropPos.width, menuWidth),
    };
  })() : undefined;

  const dropdown = open && dropPos ? createPortal(
    <div
      ref={dropdownRef}
      role="listbox"
      aria-label={p.acpSelectAgent ?? 'Select agent'}
      className={`${FLOATING_SURFACE_CLASS} isolate pointer-events-auto max-h-[min(420px,calc(100vh-24px))] w-[min(320px,calc(100vw-24px))] overflow-y-auto py-1.5 shadow-xl shadow-foreground/10`}
      style={dropdownStyle}
    >
      <div className="flex items-center justify-between gap-2 px-3 pb-1.5 pt-1">
        <span className="inline-flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground/70">
          <Bot size={11} aria-hidden="true" />
          Agent
        </span>
        <div className="inline-flex items-center gap-0.5">
          {runtimeReadinessLoading && (
            <span
              className="inline-flex h-6 w-6 items-center justify-center text-muted-foreground/70"
              aria-label="Checking runtime readiness"
              title="Checking runtime readiness"
            >
              <Loader2 size={11} className="animate-spin" aria-hidden="true" />
            </span>
          )}
          {onRefreshNativeRuntimes && (
            <button
              type="button"
              aria-label="Refresh local runtime status"
              title="Refresh local runtime status"
              onClick={(event) => {
                event.stopPropagation();
                onRefreshNativeRuntimes();
              }}
              className="hit-target-box inline-flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_70%,transparent)] [--hit-target-radius:var(--radius-md)]"
            >
              <RefreshCw size={12} />
            </button>
          )}
          <a
            href="/agents?tab=agent"
            aria-label="Configure agents"
            title="Configure agents"
            onClick={() => setOpen(false)}
            className="hit-target-box inline-flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_70%,transparent)] [--hit-target-radius:var(--radius-md)]"
          >
            <Settings size={12} />
          </a>
        </div>
      </div>
      <div className="px-3 pb-1.5 pt-1">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
          Current
        </div>
      </div>
      <div
        className="mx-2 mb-1 rounded-lg border border-border/60 bg-muted/25 px-2.5 py-2"
        title={optionTooltip(selectedOption, 'Current')}
      >
        <div className="flex items-start gap-2">
          <RuntimeMark option={selectedOption} small />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-xs font-medium text-foreground">{selectedOption.label}</span>
            </div>
            <span className="sr-only">{optionTooltip(selectedOption, 'Current')}</span>
            {canShowSessionBinding && selectedRuntime && (
              <>
                <div className="mt-0.5 truncate text-2xs text-muted-foreground">
                  {hasExternalSession
                    ? `${sessionLabel} ${shortExternalId(runtimeSessionBinding.externalSessionId!)}`
                    : `No linked ${sessionLabel.toLowerCase()}`}
                </div>
                {runtimeSessionBinding?.cwd && (
                  <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/70">
                    {runtimeSessionBinding.cwd}
                  </div>
                )}
              </>
            )}
          </div>
          <span className="ml-auto inline-flex h-5 shrink-0 items-center gap-1.5">
            <RuntimeStatusBadge option={selectedOption} />
            <Check size={12} className="shrink-0 text-[var(--amber)]" aria-hidden="true" />
          </span>
        </div>
      </div>
      <div className="px-3 pb-1 pt-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
          Switch To
        </div>
      </div>
      {switchOptions.map((option) => {
        const actionLabel = optionStatusTitle(option);
        const tooltip = optionTooltip(option, actionLabel);
        const optionDisabled = option.disabled || disabled;
        return (
          <button
            key={option.key}
            type="button"
            role="option"
            aria-selected={false}
            aria-label={`${option.label}: ${actionLabel}`}
            title={tooltip}
            disabled={optionDisabled}
            onClick={() => handleSelect(option)}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left opacity-100 transition-colors duration-75 hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RuntimeMark option={option} small />
            <span className={`min-w-0 flex-1 truncate text-xs font-medium ${optionDisabled ? 'text-muted-foreground' : 'text-foreground'}`}>
              {option.label}
            </span>
            <RuntimeStatusSlot option={option} />
            <span className="sr-only">{tooltip}</span>
          </button>
        );
      })}
      {canShowMoreAgents && (
        <>
          {!moreOpen && (
            <button
              type="button"
              aria-label="Show more ACP agents"
              aria-expanded={false}
              onClick={() => setMoreOpen(true)}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left opacity-100 transition-colors duration-75 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border/50 bg-muted/40 text-muted-foreground">
                <MoreHorizontal size={13} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
                More agents
              </span>
              <ChevronDown size={12} className="shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          )}
          {moreOpen && (
            <div className="border-t border-border/50 py-1">
              {acpLoading && acpSwitchOptions.length === 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
                  <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                  Checking ACP agents...
                </div>
              )}
              {!acpLoading && acpSwitchOptions.length === 0 && (
                <div className="px-3 py-1.5 text-xs text-muted-foreground">
                  {acpError ? `ACP agents unavailable: ${acpError}` : 'No other ACP agents detected.'}
                </div>
              )}
              {acpSwitchOptions.map((option) => {
                const actionLabel = optionStatusTitle(option);
                const tooltip = optionTooltip(option, actionLabel);
                const optionDisabled = option.disabled || disabled;
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="option"
                    aria-selected={false}
                    aria-label={`${option.label}: ${actionLabel}`}
                    title={tooltip}
                    disabled={optionDisabled}
                    onClick={() => handleSelect(option)}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left opacity-100 transition-colors duration-75 hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <RuntimeMark option={option} small />
                    <span className={`min-w-0 flex-1 truncate text-xs font-medium ${optionDisabled ? 'text-muted-foreground' : 'text-foreground'}`}>
                      {option.label}
                    </span>
                    <RuntimeStatusSlot option={option} />
                    <span className="sr-only">{tooltip}</span>
                  </button>
                );
              })}
              <button
                type="button"
                aria-label="Collapse ACP agents"
                onClick={() => setMoreOpen(false)}
                className="mt-0.5 flex w-full items-center gap-2.5 border-t border-border/40 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors duration-75 hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border/50 bg-muted/35 text-muted-foreground">
                  <ChevronDown size={12} className="rotate-180" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  Collapse
                </span>
              </button>
            </div>
          )}
        </>
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!disabled) setOpen((value) => !value);
        }}
        disabled={disabled}
        aria-label={p.acpChangeAgent ?? 'Change runtime'}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selectedRuntimeLoading ? 'Checking selected local agent' : selectedOption.label}
        data-hit-active={open ? 'true' : undefined}
        className="hit-target-box group/runtime relative z-10 inline-flex h-8 w-8 shrink-0 items-center justify-center border border-transparent text-foreground transition-colors duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 [--hit-target-bg:var(--background)] [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_60%,transparent)] [--hit-target-active-bg:color-mix(in_srgb,var(--muted)_60%,transparent)] [--hit-target-border-width:1px] [--hit-target-border:color-mix(in_srgb,var(--border)_40%,transparent)] [--hit-target-hover-border:color-mix(in_srgb,var(--border)_60%,transparent)] [--hit-target-radius:var(--radius-lg)] [--hit-target-shadow:0_1px_2px_0_color-mix(in_srgb,var(--foreground)_8%,transparent)]"
      >
        <RuntimeMark option={selectedOption} />
        <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-background bg-muted text-muted-foreground shadow-sm">
          {selectedRuntimeLoading ? (
            <Loader2 size={8} className="animate-spin" />
          ) : (
            <ChevronDown size={9} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
          )}
        </span>
      </button>
      {dropdown}
    </>
  );
}
