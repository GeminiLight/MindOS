'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Cpu, Gauge, RotateCcw } from 'lucide-react';
import AskOptionCapsule, { type AskOptionCapsuleOption } from '@/components/ask/AskOptionCapsule';
import type {
  AgentRuntimeKind,
  NativeRuntimeEffort,
  NativeRuntimeOptions,
} from '@/lib/types';

const STORAGE_PREFIX = 'mindos-native-runtime-options.v1';
const DEFAULT_EFFORT_VALUE = '__default__';
type CodexModelCapability = {
  id: string;
  model: string;
  isDefault: boolean;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
  defaultReasoningEffort: string;
};
type CodexModelListPayload = { data: CodexModelCapability[]; nextCursor: string | null };
const FALLBACK_EFFORTS = [
  { reasoningEffort: 'low', description: 'Fastest responses for simple asks.' },
  { reasoningEffort: 'medium', description: 'Balanced reasoning and speed.' },
  { reasoningEffort: 'high', description: 'More reasoning for complex work.' },
  { reasoningEffort: 'xhigh', description: 'Maximum reasoning budget for hard tasks.' },
];

function storageKey(runtimeKind: AgentRuntimeKind): string {
  return `${STORAGE_PREFIX}:${runtimeKind}`;
}

function normalizeEffort(value: unknown): NativeRuntimeEffort | undefined {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value) ? value : undefined;
}

function effortLabel(value: string): string {
  if (value === 'xhigh') return 'Extra High';
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function compactRuntimeOptions(value: NativeRuntimeOptions): NativeRuntimeOptions {
  return {
    ...(value.modelOverride?.trim() ? { modelOverride: value.modelOverride.trim() } : {}),
    ...(value.reasoningEffort ? { reasoningEffort: value.reasoningEffort } : {}),
  };
}

export function getPersistedNativeRuntimeOptions(runtimeKind: AgentRuntimeKind): NativeRuntimeOptions {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(storageKey(runtimeKind));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const modelOverride = typeof parsed.modelOverride === 'string' ? parsed.modelOverride : undefined;
    const reasoningEffort = normalizeEffort(parsed.reasoningEffort);
    return compactRuntimeOptions({
      ...(modelOverride ? { modelOverride } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
    });
  } catch {
    return {};
  }
}

export function persistNativeRuntimeOptions(runtimeKind: AgentRuntimeKind, value: NativeRuntimeOptions): void {
  if (typeof window === 'undefined') return;
  const compact = compactRuntimeOptions(value);
  try {
    if (Object.keys(compact).length === 0) {
      localStorage.removeItem(storageKey(runtimeKind));
    } else {
      localStorage.setItem(storageKey(runtimeKind), JSON.stringify(compact));
    }
  } catch {
    // Private mode / quota: the current turn still uses the in-memory value.
  }
}

interface NativeRuntimeOptionsCapsuleProps {
  runtimeKind: Extract<AgentRuntimeKind, 'codex' | 'claude'>;
  value: NativeRuntimeOptions;
  onChange: (value: NativeRuntimeOptions) => void;
  disabled?: boolean;
}

function effortIcon(size = 11) {
  return <Gauge size={size} className="shrink-0" />;
}

function modelIcon(size = 11) {
  return <Cpu size={size} className="shrink-0" />;
}

export default function NativeRuntimeOptionsCapsule({
  runtimeKind,
  value,
  onChange,
  disabled = false,
}: NativeRuntimeOptionsCapsuleProps) {
  const modelOverride = value.modelOverride ?? '';
  const [draftModel, setDraftModel] = useState(modelOverride);
  const [codexModels, setCodexModels] = useState<CodexModelListPayload['data']>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const defaultModelLabel = 'Default';
  const placeholder = runtimeKind === 'codex' ? 'gpt-5.4-codex' : 'sonnet';

  useEffect(() => {
    setDraftModel(modelOverride);
  }, [modelOverride]);

  useEffect(() => {
    if (runtimeKind !== 'codex') return;
    const controller = new AbortController();
    void fetch('/api/agent-runtimes/codex/models', {
      cache: 'no-store',
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json() as Partial<CodexModelListPayload>;
      if (Array.isArray(payload.data)) setCodexModels(payload.data);
    }).catch(() => {});
    return () => controller.abort();
  }, [runtimeKind]);

  const selectedModel = runtimeKind === 'codex'
    ? (modelOverride.trim()
      ? codexModels.find((model) => model.id === modelOverride.trim() || model.model === modelOverride.trim())
      : codexModels.find((model) => model.isDefault))
    : undefined;

  const commit = useCallback((next: NativeRuntimeOptions) => {
    onChange(compactRuntimeOptions(next));
  }, [onChange]);

  const setEffort = useCallback((next: string) => {
    commit({
      ...value,
      reasoningEffort: next === DEFAULT_EFFORT_VALUE ? undefined : next,
    });
  }, [commit, value]);

  const commitModel = useCallback((next: string) => {
    const normalized = next.trim();
    const nextModel = runtimeKind === 'codex'
      ? (normalized
        ? codexModels.find((model) => model.id === normalized || model.model === normalized)
        : codexModels.find((model) => model.isDefault))
      : undefined;
    const effortSupported = !nextModel || !value.reasoningEffort || nextModel.supportedReasoningEfforts
      .some((option) => option.reasoningEffort === value.reasoningEffort);
    commit({
      ...value,
      modelOverride: normalized,
      reasoningEffort: effortSupported ? value.reasoningEffort : undefined,
    });
  }, [codexModels, commit, runtimeKind, value]);

  const advertisedEfforts = runtimeKind === 'codex' && selectedModel?.supportedReasoningEfforts.length
    ? selectedModel.supportedReasoningEfforts
    : FALLBACK_EFFORTS;
  const defaultEffort = runtimeKind === 'codex' ? selectedModel?.defaultReasoningEffort : undefined;
  const defaultLabel = defaultEffort ? `${effortLabel(defaultEffort)} (Default)` : 'Default';
  const effortOptions: Array<AskOptionCapsuleOption<string>> = [
    {
      value: DEFAULT_EFFORT_VALUE,
      label: defaultLabel,
      description: defaultEffort
        ? `Use the selected model's default ${effortLabel(defaultEffort)} effort.`
        : 'Use the runtime default reasoning effort.',
      icon: effortIcon(13),
    },
    ...advertisedEfforts.map((option) => ({
      value: option.reasoningEffort,
      label: effortLabel(option.reasoningEffort),
      description: option.description,
      icon: effortIcon(13),
    })),
  ];
  const selectedEffort = value.reasoningEffort
    ? effortOptions.find((option) => option.value === value.reasoningEffort) ?? {
      value: value.reasoningEffort,
      label: effortLabel(value.reasoningEffort),
      description: `Use ${effortLabel(value.reasoningEffort)} reasoning effort.`,
    }
    : effortOptions[0]!;
  const displayModel = modelOverride.trim() || defaultModelLabel;
  const shortModel = displayModel.length > 20 ? `${displayModel.slice(0, 18)}...` : displayModel;

  return (
    <div
      data-native-runtime-options
      data-runtime-kind={runtimeKind}
      className="flex min-w-0 flex-wrap items-center gap-1"
    >
      <AskOptionCapsule
        title="Model"
        ariaLabel="Model"
        icon={modelIcon()}
        label={shortModel}
        tooltip={modelOverride.trim() ? `Model: ${modelOverride.trim()}` : `Model: ${defaultModelLabel}`}
        active={Boolean(modelOverride.trim())}
        disabled={disabled}
        dropdownWidthClassName="min-w-[270px] max-w-[320px]"
      >
        {({ close }) => (
          <div className="px-3 py-2">
            <label className="block text-2xs font-medium text-muted-foreground" htmlFor={`native-model-${runtimeKind}`}>
              Override
            </label>
            <div className="mt-1 flex items-center gap-1.5 rounded-md border border-border/50 bg-background/65 px-2 py-1.5">
              <Cpu size={12} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                id={`native-model-${runtimeKind}`}
                ref={inputRef}
                value={draftModel}
                disabled={disabled}
                onChange={(event) => setDraftModel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitModel(draftModel);
                    close();
                  }
                }}
                placeholder={placeholder}
                className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/45 disabled:cursor-not-allowed disabled:opacity-50"
                autoComplete="off"
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setDraftModel('');
                  commitModel('');
                  close();
                }}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/45 bg-background px-2 text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw size={11} />
                {defaultModelLabel}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  commitModel(draftModel);
                  close();
                }}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--amber)] bg-[var(--amber)] px-2 text-2xs font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check size={11} />
                Apply
              </button>
            </div>
          </div>
        )}
      </AskOptionCapsule>

      <AskOptionCapsule
        title="Effort"
        ariaLabel="Effort"
        icon={effortIcon()}
        label={selectedEffort.label}
        tooltip={selectedEffort.description}
        value={value.reasoningEffort ?? DEFAULT_EFFORT_VALUE}
        options={effortOptions}
        onChange={setEffort}
        disabled={disabled}
        active={Boolean(value.reasoningEffort)}
        dropdownWidthClassName="min-w-[230px] max-w-[290px]"
      />
    </div>
  );
}
