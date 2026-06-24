'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2, RefreshCw } from 'lucide-react';
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
  disabled?: boolean;
  status?: AgentRuntimeStatus | 'checking';
  readiness?: AgentRuntimeReadinessProjection;
};

type RuntimeSelectable = AgentRuntimeIdentity & { status?: AgentRuntimeStatus };
type NativeRuntimeOption = AgentRuntimeIdentity & Partial<Pick<AgentRuntimeDescriptor, 'status' | 'availability' | 'installCmd' | 'packageName' | 'binaryPath' | 'runtimeBridge'>>;

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
  if (!status || status === 'ready') return null;
  if (status === 'usable') return 'Usable';
  if (status === 'limited') return 'Limited';
  if (status === 'blocked') return 'Blocked';
  return 'Unknown';
}

function runtimeReadinessBadgeClass(status: AgentRuntimeReadinessStatus): string {
  if (status === 'blocked') return 'border-[var(--error)]/30 bg-[var(--error)]/10 text-[var(--error)]';
  if (status === 'limited') return 'border-[var(--amber)]/35 bg-[var(--amber)]/10 text-[var(--amber)]';
  if (status === 'unknown') return 'border-border/60 bg-muted/40 text-muted-foreground';
  return 'border-border/60 bg-background/70 text-muted-foreground';
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

function RuntimeMark({ option, small = false }: { option: Pick<RuntimeOption, 'icon' | 'label'>; small?: boolean }) {
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

  return (
    <span className={`${size} inline-flex items-center justify-center rounded-md border border-border/50 bg-muted/50 text-[10px] font-medium text-muted-foreground`}>
      {initials(option.label)}
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
        description: 'Use MindOS with your selected provider and model.',
        runtime: null,
        icon: 'mindos',
        status: 'available',
        readiness: getReadiness(null, 'mindos'),
      },
      codexOption,
      claudeOption,
    ];
  }, [errorByKind, loading, loadingByKind, nativeRuntimes, notInstalledAgents, p.acpDefaultAgent, runtimeReadinessByRuntimeId]);

  const selectedOption = useMemo<RuntimeOption>(() => {
    if (!selectedRuntime) return options[0];
    return options.find((option) => {
      const runtime = option.runtime;
      return runtime?.kind === selectedRuntime.kind && runtime.id === selectedRuntime.id;
    }) ?? {
      key: `${selectedRuntime.kind}:${selectedRuntime.id}`,
      label: selectedRuntime.name,
      description: 'Selected runtime',
      runtime: selectedRuntime,
      icon: selectedRuntime.kind === 'codex' ? 'codex' : selectedRuntime.kind === 'claude' ? 'claude' : 'agent',
      status: 'available',
      readiness: runtimeReadinessByRuntimeId[selectedRuntime.id] ?? runtimeReadinessByRuntimeId[selectedRuntime.kind],
    };
  }, [options, runtimeReadinessByRuntimeId, selectedRuntime]);
  const canShowSessionBinding = selectedRuntime?.kind === 'codex' || selectedRuntime?.kind === 'claude';
  const sessionLabel = selectedRuntime ? runtimeSessionLabel(selectedRuntime) : 'Session';
  const hasExternalSession = canShowSessionBinding && !!runtimeSessionBinding?.externalSessionId;
  const selectedNativeKind = selectedRuntime?.kind === 'codex' || selectedRuntime?.kind === 'claude'
    ? selectedRuntime.kind
    : null;
  const selectedRuntimeLoading = selectedNativeKind
    ? loadingByKind[selectedNativeKind] ?? loading
    : false;

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
      aria-label={p.acpSelectAgent ?? 'Select runtime'}
      className={`${FLOATING_SURFACE_CLASS} isolate pointer-events-auto w-[min(340px,calc(100vw-24px))] py-1.5 shadow-xl shadow-foreground/10`}
      style={dropdownStyle}
    >
      <div className="flex items-center justify-between gap-2 px-3 pb-1.5 pt-1">
        <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground/70">
          Runtime
        </span>
        {runtimeReadinessLoading && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
            <Loader2 size={10} className="animate-spin" />
            Readiness
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
      </div>
      {canShowSessionBinding && selectedRuntime && (
        <div className="mx-2 mb-1 rounded-lg border border-border/60 bg-muted/25 px-2.5 py-2">
          <div className="flex items-start gap-2">
            <RuntimeMark option={selectedOption} small />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-xs font-medium text-foreground">{selectedRuntime.name}</span>
                {runtimeSessionBinding?.status && runtimeSessionBinding.status !== 'active' && (
                  <span className="rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {runtimeSessionBinding.status}
                  </span>
                )}
              </div>
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
            </div>
          </div>
        </div>
      )}
      {options.map((option) => {
        const runtime = option.runtime;
        const isSelected = !selectedRuntime
          ? runtime === null
          : !!runtime && runtime.kind === selectedRuntime.kind && runtime.id === selectedRuntime.id;
        const readinessLabel = runtimeReadinessStatusLabel(option.readiness?.overallStatus);
        const readinessNote = runtimeReadinessNote(option.readiness);
        return (
          <button
            key={option.key}
            type="button"
            role="option"
            aria-selected={isSelected}
            disabled={option.disabled || disabled}
            onClick={() => handleSelect(option)}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left opacity-100 transition-colors duration-75 hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RuntimeMark option={option} small />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-xs font-medium text-foreground">{option.label}</span>
                {runtimeOptionStatusLabel(option.status) && (
                  <span className="rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {runtimeOptionStatusLabel(option.status)}
                  </span>
                )}
                {readinessLabel && option.readiness && (
                  <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${runtimeReadinessBadgeClass(option.readiness.overallStatus)}`}>
                    {readinessLabel}
                  </span>
                )}
              </span>
              <span className="block text-2xs leading-snug text-muted-foreground [overflow-wrap:anywhere]">{option.description}</span>
              {readinessNote && (
                <span className="mt-1 block line-clamp-2 text-[10px] leading-snug text-muted-foreground/80 [overflow-wrap:anywhere]">
                  {readinessNote}
                </span>
              )}
              {option.diagnosticHints && option.diagnosticHints.length > 0 && (
                <span className="mt-1 block space-y-0.5 text-[10px] leading-snug text-muted-foreground/70">
                  {option.diagnosticHints.map((hint) => (
                    <span key={hint} className="block [overflow-wrap:anywhere]">
                      - {hint}
                    </span>
                  ))}
                </span>
              )}
            </span>
            {isSelected && <Check size={12} className="shrink-0 text-[var(--amber)]" />}
          </button>
        );
      })}
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
