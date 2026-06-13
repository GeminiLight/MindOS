'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Cpu, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { normalizeRuntimeReasoningEffortForKind } from '@/lib/agent/native-runtime-options';
import type {
  RuntimeOptionsState,
  RuntimePermissionMode,
  RuntimeReasoningEffort,
} from '@/lib/types';

export type {
  RuntimeOptionsState,
  RuntimePermissionMode,
  RuntimeReasoningEffort,
} from '@/lib/types';

const STORAGE_KEY = 'mindos-native-runtime-options';
type NativeRuntimeKind = 'codex' | 'claude';

const DEFAULT_RUNTIME_OPTIONS: RuntimeOptionsState = {
  permissionMode: 'agent',
  modelOverride: null,
  reasoningEffort: null,
};

const DEFAULT_OPTIONS_BY_KIND: Record<NativeRuntimeKind, RuntimeOptionsState> = {
  codex: DEFAULT_RUNTIME_OPTIONS,
  claude: DEFAULT_RUNTIME_OPTIONS,
};

type PermissionOption = {
  value: RuntimePermissionMode;
  label: string;
  short: string;
  description: string;
};

const CLAUDE_PERMISSION_OPTIONS: PermissionOption[] = [
  { value: 'readonly', label: 'Read-only', short: 'Read', description: 'No approval prompts for writes or commands.' },
  { value: 'agent', label: 'Agent', short: 'Agent', description: 'Use Claude Code default approvals.' },
  { value: 'workspace-write', label: 'Workspace write', short: 'Workspace', description: 'Accept edits while keeping broader actions gated.' },
  { value: 'danger-full-access', label: 'Full access', short: 'Full', description: 'Bypass Claude Code permission checks for trusted sandboxes.' },
];

const CODEX_PERMISSION_OPTIONS: PermissionOption[] = [
  { value: 'readonly', label: 'Read-only', short: 'Read', description: 'Run without write approval prompts.' },
  { value: 'workspace-write', label: 'Workspace write', short: 'Workspace', description: 'Allow this workspace with on-request approvals.' },
  { value: 'danger-full-access', label: 'Full access', short: 'Full', description: 'Remove sandboxing for trusted local runs.' },
];

type EffortOption = { value: RuntimeReasoningEffort | null; label: string; short: string };

const CODEX_EFFORT_OPTIONS: EffortOption[] = [
  { value: null, label: 'Auto', short: 'Auto' },
  { value: 'low', label: 'Low', short: 'Low' },
  { value: 'medium', label: 'Medium', short: 'Med' },
  { value: 'high', label: 'High', short: 'High' },
  { value: 'xhigh', label: 'XHigh', short: 'XHigh' },
];

const CLAUDE_EFFORT_OPTIONS: EffortOption[] = [
  ...CODEX_EFFORT_OPTIONS,
  { value: 'max', label: 'Max', short: 'Max' },
];

type OpenPanel = 'permission' | 'model' | null;

interface DropdownPos {
  top: number;
  left: number;
  direction: 'up' | 'down';
}

function normalizeRuntimeOptions(value: unknown): RuntimeOptionsState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_RUNTIME_OPTIONS;
  const record = value as Record<string, unknown>;
  const permissionMode = record.permissionMode === 'readonly'
    || record.permissionMode === 'agent'
    || record.permissionMode === 'workspace-write'
    || record.permissionMode === 'danger-full-access'
    ? record.permissionMode
    : DEFAULT_RUNTIME_OPTIONS.permissionMode;
  const model = typeof record.modelOverride === 'string' && record.modelOverride.trim()
    ? record.modelOverride.trim()
    : null;
  const reasoningEffort = typeof record.reasoningEffort === 'string' && record.reasoningEffort.trim()
    ? (record.reasoningEffort.trim().slice(0, 64) as RuntimeReasoningEffort)
    : null;
  return { permissionMode, modelOverride: model, reasoningEffort };
}

function normalizeRuntimeOptionsStore(value: unknown): Record<NativeRuntimeKind, RuntimeOptionsState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_OPTIONS_BY_KIND;
  const record = value as Record<string, unknown>;
  const hasKindBuckets = 'codex' in record || 'claude' in record;
  if (!hasKindBuckets) {
    // Legacy single-bucket storage from v1.1.13 and earlier. Treat it as a
    // Codex default because Codex was the first native runtime capsule.
    return {
      codex: normalizeRuntimeOptions(record),
      claude: DEFAULT_RUNTIME_OPTIONS,
    };
  }
  return {
    codex: normalizeRuntimeOptions(record.codex),
    claude: normalizeRuntimeOptions(record.claude),
  };
}

function runtimeOptionsAreDefault(value: RuntimeOptionsState): boolean {
  return value.permissionMode === DEFAULT_RUNTIME_OPTIONS.permissionMode
    && !value.modelOverride
    && !value.reasoningEffort;
}

export function getPersistedRuntimeOptions(kind: NativeRuntimeKind = 'codex'): RuntimeOptionsState {
  if (typeof window === 'undefined') return DEFAULT_RUNTIME_OPTIONS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const store = raw ? normalizeRuntimeOptionsStore(JSON.parse(raw)) : DEFAULT_OPTIONS_BY_KIND;
    return store[kind] ?? DEFAULT_RUNTIME_OPTIONS;
  } catch {
    return DEFAULT_RUNTIME_OPTIONS;
  }
}

export function persistRuntimeOptions(kind: NativeRuntimeKind, value: RuntimeOptionsState): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const store = raw ? normalizeRuntimeOptionsStore(JSON.parse(raw)) : DEFAULT_OPTIONS_BY_KIND;
    const next = {
      ...store,
      [kind]: normalizeRuntimeOptions(value),
    };
    if (runtimeOptionsAreDefault(next.codex) && runtimeOptionsAreDefault(next.claude)) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be unavailable in hardened browser contexts.
  }
}

interface RuntimeOptionsCapsuleProps {
  runtimeKind: 'codex' | 'claude';
  value: RuntimeOptionsState;
  onChange: (value: RuntimeOptionsState) => void;
  disabled?: boolean;
}

function runtimeLabel(kind: RuntimeOptionsCapsuleProps['runtimeKind']): string {
  return kind === 'codex' ? 'Codex' : 'Claude Code';
}

function permissionOptions(kind: RuntimeOptionsCapsuleProps['runtimeKind']) {
  return kind === 'codex' ? CODEX_PERMISSION_OPTIONS : CLAUDE_PERMISSION_OPTIONS;
}

function permissionModeForRuntime(
  kind: RuntimeOptionsCapsuleProps['runtimeKind'],
  mode: RuntimePermissionMode,
): RuntimePermissionMode {
  if (kind === 'codex') return mode === 'agent' ? 'workspace-write' : mode;
  return mode;
}

function permissionLabel(kind: RuntimeOptionsCapsuleProps['runtimeKind'], mode: RuntimePermissionMode): string {
  const effective = permissionModeForRuntime(kind, mode);
  return permissionOptions(kind).find((option) => option.value === effective)?.short ?? 'Agent';
}

function effortOptions(kind: RuntimeOptionsCapsuleProps['runtimeKind']) {
  return kind === 'claude' ? CLAUDE_EFFORT_OPTIONS : CODEX_EFFORT_OPTIONS;
}

function effortLabel(kind: RuntimeOptionsCapsuleProps['runtimeKind'], effort: RuntimeReasoningEffort | null): string {
  if (!effort) return 'Auto';
  return effortOptions(kind).find((option) => option.value === effort)?.short
    ?? (effort.length > 8 ? `${effort.slice(0, 7)}...` : effort);
}

function compactModelLabel(model: string | null): string {
  if (!model) return 'Default';
  return model.length > 18 ? `${model.slice(0, 16)}...` : model;
}

function dropdownStyle(pos: DropdownPos, width: number): React.CSSProperties {
  const left = Math.min(Math.max(8, pos.left), Math.max(8, window.innerWidth - width - 8));
  return {
    width,
    left,
    ...(pos.direction === 'up'
      ? { bottom: window.innerHeight - pos.top }
      : { top: pos.top }),
  };
}

export default function RuntimeOptionsCapsule({
  runtimeKind,
  value,
  onChange,
  disabled = false,
}: RuntimeOptionsCapsuleProps) {
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [pos, setPos] = useState<DropdownPos | null>(null);
  const permissionRef = useRef<HTMLButtonElement>(null);
  const modelRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const runtimeName = runtimeLabel(runtimeKind);
  const effectivePermissionMode = permissionModeForRuntime(runtimeKind, value.permissionMode);
  const effectiveReasoningEffort = normalizeRuntimeReasoningEffortForKind(runtimeKind, value.reasoningEffort) ?? null;
  const visiblePermissionOptions = permissionOptions(runtimeKind);
  const visibleEffortOptions = effortOptions(runtimeKind);

  const modelSummary = useMemo(() => {
    const model = compactModelLabel(value.modelOverride);
    return `${model} / ${effortLabel(runtimeKind, effectiveReasoningEffort)}`;
  }, [runtimeKind, value.modelOverride, effectiveReasoningEffort]);

  const reposition = useCallback((panel: OpenPanel = openPanel) => {
    if (!panel) return;
    const trigger = panel === 'permission' ? permissionRef.current : modelRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const estimatedH = panel === 'permission' ? (runtimeKind === 'codex' ? 140 : 172) : runtimeKind === 'codex' ? 230 : 268;
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const direction: 'up' | 'down' = spaceAbove > spaceBelow && spaceAbove > estimatedH ? 'up' : 'down';
    setPos({
      left: rect.left,
      top: direction === 'up' ? rect.top - 6 : rect.bottom + 6,
      direction,
    });
  }, [openPanel, runtimeKind]);

  const open = useCallback((panel: Exclude<OpenPanel, null>) => {
    if (disabled) return;
    setOpenPanel((current) => {
      const next = current === panel ? null : panel;
      if (next) queueMicrotask(() => reposition(next));
      return next;
    });
  }, [disabled, reposition]);

  useEffect(() => {
    if (!openPanel) {
      setPos(null);
      return;
    }
    reposition(openPanel);
  }, [openPanel, reposition]);

  useEffect(() => {
    if (!openPanel) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (permissionRef.current?.contains(target)) return;
      if (modelRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpenPanel(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openPanel]);

  useEffect(() => {
    if (!openPanel) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenPanel(null);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [openPanel]);

  useEffect(() => {
    if (!openPanel) return;
    const handler = () => reposition(openPanel);
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [openPanel, reposition]);

  const update = (patch: Partial<RuntimeOptionsState>) => {
    onChange({
      ...value,
      ...patch,
    });
  };

  const buttonClass = 'inline-flex min-h-6 items-center gap-1.5 rounded-full border border-border/50 bg-muted/35 px-2.5 py-0.5 text-2xs font-medium text-muted-foreground transition-colors duration-100 hover:bg-muted/55 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60';

  const permissionDropdown = openPanel === 'permission' && pos ? (
    <div
      ref={dropdownRef}
      role="listbox"
      aria-label={`${runtimeName} permission mode`}
      className="fixed z-50 rounded-lg border border-border bg-card p-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
      style={dropdownStyle(pos, 188)}
    >
      {visiblePermissionOptions.map((option) => {
        const selected = effectivePermissionMode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={selected}
            aria-label={`${option.label}. ${option.description}`}
            title={option.description}
            onClick={() => {
              update({ permissionMode: option.value });
              setOpenPanel(null);
            }}
            className={cn(
              'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected ? 'bg-[var(--amber)]/10 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <ShieldCheck size={12} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {selected && <Check size={12} className="shrink-0 text-[var(--amber)]" />}
          </button>
        );
      })}
    </div>
  ) : null;

  const modelDropdown = openPanel === 'model' && pos ? (
    <div
      ref={dropdownRef}
      role="dialog"
      aria-label={`${runtimeName} model options`}
      className="fixed z-50 rounded-lg border border-border bg-card p-2 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
      style={dropdownStyle(pos, 292)}
    >
      <label className="block">
        <span className="block px-1 pb-1 text-2xs font-medium uppercase text-muted-foreground/70">Model</span>
        <input
          ref={modelInputRef}
          value={value.modelOverride ?? ''}
          onChange={(event) => {
            const next = event.target.value;
            update({ modelOverride: next.trim() ? next : null });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              modelInputRef.current?.blur();
              setOpenPanel(null);
            }
          }}
          placeholder="Default"
          className="h-8 w-full rounded-md border border-border/60 bg-background px-2 text-xs text-foreground outline-none transition-colors duration-100 placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </label>

      <div className="mt-2">
        <div className="px-1 pb-1 text-2xs font-medium uppercase text-muted-foreground/70">Effort</div>
        <div className="grid grid-cols-3 gap-1">
          {visibleEffortOptions.map((option) => {
            const selected = effectiveReasoningEffort === option.value;
            return (
              <button
                key={option.value ?? 'auto'}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => update({ reasoningEffort: option.value })}
                className={cn(
                  'inline-flex h-8 min-w-0 items-center justify-center rounded-md border px-1.5 text-xs transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected
                    ? 'border-[var(--amber)] bg-[var(--amber)]/10 text-foreground'
                    : 'border-border/60 text-muted-foreground hover:bg-muted/55 hover:text-foreground',
                )}
              >
                <span className="truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={permissionRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={openPanel === 'permission'}
        title={`${runtimeName} permission mode`}
        onClick={() => open('permission')}
        className={cn(buttonClass, effectivePermissionMode !== 'readonly' && 'text-foreground')}
      >
        <ShieldCheck size={11} className="shrink-0" />
        <span className="max-w-[92px] truncate">{permissionLabel(runtimeKind, value.permissionMode)}</span>
        <ChevronDown size={11} className={cn('shrink-0 transition-transform duration-150', openPanel === 'permission' && 'rotate-180')} />
      </button>

      <button
        ref={modelRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={openPanel === 'model'}
        title={`${runtimeName} model and effort`}
        onClick={() => open('model')}
        className={cn(buttonClass, 'max-w-[210px]')}
      >
        <Cpu size={11} className="shrink-0" />
        <span className="truncate">{modelSummary}</span>
        <ChevronDown size={11} className={cn('shrink-0 transition-transform duration-150', openPanel === 'model' && 'rotate-180')} />
      </button>

      {typeof document !== 'undefined' && (permissionDropdown || modelDropdown)
        ? createPortal(permissionDropdown || modelDropdown, document.body)
        : null}
    </>
  );
}
