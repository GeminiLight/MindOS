'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Cpu, Gauge, RotateCcw, SlidersHorizontal } from 'lucide-react';
import AskOptionCapsule, { type AskOptionCapsuleOption } from '@/components/ask/AskOptionCapsule';
import type {
  AcpRuntimeOptions,
  AgentRuntimeIdentity,
  RuntimeSessionProjection,
  RuntimeSessionProjectionControl,
} from '@/lib/types';

const STORAGE_PREFIX = 'mindos-acp-runtime-options.v1';
const FALLBACK_MODEL_CONFIG_ID = 'model';
const FALLBACK_EFFORT_CONFIG_ID = 'reasoning_effort';
const DEFAULT_EFFORT = 'medium';

interface AcpRuntimeOptionsCapsuleProps {
  projection?: RuntimeSessionProjection | null;
  runtime?: AgentRuntimeIdentity | null;
  value: AcpRuntimeOptions;
  onChange: (value: AcpRuntimeOptions) => void;
  controlKeys?: ReadonlyArray<ControlKey>;
  disabled?: boolean;
}

type ControlKey = keyof RuntimeSessionProjection['controls'];
type RuntimeControlEntry = readonly [ControlKey, RuntimeSessionProjectionControl];

function storageKey(runtimeId: string): string {
  return `${STORAGE_PREFIX}:${runtimeId.trim()}`;
}

function compactStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => [key.trim(), typeof item === 'string' ? item.trim() : ''] as const)
    .filter(([key, item]) => key && item);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

export function compactAcpRuntimeOptions(value: AcpRuntimeOptions): AcpRuntimeOptions {
  const modeId = value.modeId?.trim();
  const configValues = compactStringRecord(value.configValues);
  return {
    ...(modeId ? { modeId } : {}),
    ...(configValues ? { configValues } : {}),
  };
}

export function getPersistedAcpRuntimeOptions(runtimeId: string): AcpRuntimeOptions {
  if (typeof window === 'undefined' || !runtimeId.trim()) return {};
  try {
    const raw = localStorage.getItem(storageKey(runtimeId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const configValues = compactStringRecord(parsed.configValues);
    return compactAcpRuntimeOptions({
      ...(typeof parsed.modeId === 'string' ? { modeId: parsed.modeId } : {}),
      ...(configValues ? { configValues } : {}),
    });
  } catch {
    return {};
  }
}

export function persistAcpRuntimeOptions(runtimeId: string, value: AcpRuntimeOptions): void {
  if (typeof window === 'undefined' || !runtimeId.trim()) return;
  const compact = compactAcpRuntimeOptions(value);
  try {
    if (Object.keys(compact).length === 0) {
      localStorage.removeItem(storageKey(runtimeId));
    } else {
      localStorage.setItem(storageKey(runtimeId), JSON.stringify(compact));
    }
  } catch {
    // Private mode / quota: the current turn still uses the in-memory value.
  }
}

function compactLabel(label: string): string {
  return label.length > 18 ? `${label.slice(0, 16)}...` : label;
}

function optionLabel(option: { id: string; label?: string }): string {
  return option.label?.trim() || option.id;
}

function agentModeLabel(option: { id: string; label?: string }): string {
  const id = option.id.trim().toLowerCase();
  const label = optionLabel(option);
  const normalizedLabel = label.trim().toLowerCase();
  if (id === 'build' || id === 'default' || normalizedLabel === 'default') return 'Build';
  if (id === 'plan' || normalizedLabel === 'plan') return 'Plan';
  return label;
}

function optionsFor(key: ControlKey, control: RuntimeSessionProjectionControl): Array<AskOptionCapsuleOption<string>> {
  return control.options
    .filter((option) => option.id.trim())
    .slice(0, 40)
    .map((option) => ({
      value: option.id,
      label: key === 'mode' ? agentModeLabel(option) : optionLabel(option),
    }));
}

function selectedValue(
  key: ControlKey,
  control: RuntimeSessionProjectionControl,
  value: AcpRuntimeOptions,
): string {
  const configId = configIdForControl(key, control);
  if (configId && value.configValues?.[configId]) return value.configValues[configId]!;
  if (key === 'mode' && value.modeId) return value.modeId;
  return control.currentValue ?? control.options[0]?.id ?? '';
}

function configIdForControl(key: ControlKey, control: RuntimeSessionProjectionControl): string | undefined {
  if (control.configId) return control.configId;
  if (key === 'model') return FALLBACK_MODEL_CONFIG_ID;
  if (key === 'thoughtLevel') return FALLBACK_EFFORT_CONFIG_ID;
  return undefined;
}

function controlIcon(key: ControlKey) {
  if (key === 'model') return <Cpu size={11} className="shrink-0" />;
  if (key === 'thoughtLevel') return <Gauge size={11} className="shrink-0" />;
  return <SlidersHorizontal size={11} className="shrink-0" />;
}

function controlTitle(key: ControlKey): string {
  if (key === 'model') return 'Model';
  if (key === 'thoughtLevel') return 'Effort';
  return 'Agent Mode';
}

function canSetControl(key: ControlKey, control: RuntimeSessionProjectionControl): boolean {
  if (control.status !== 'available') return false;
  if (key === 'mode') return true;
  return Boolean(configIdForControl(key, control));
}

function defaultModelControl(value: AcpRuntimeOptions): RuntimeSessionProjectionControl {
  return {
    status: 'available',
    owner: 'external',
    source: 'adapter-declared',
    currentValue: value.configValues?.[FALLBACK_MODEL_CONFIG_ID],
    options: [],
    summary: 'Override the selected ACP agent model for the next turn.',
  };
}

function defaultModeControl(value: AcpRuntimeOptions): RuntimeSessionProjectionControl {
  return {
    status: 'available',
    owner: 'external',
    source: 'adapter-declared',
    currentValue: value.modeId ?? 'build',
    options: [
      { id: 'build', label: 'Build' },
      { id: 'plan', label: 'Plan' },
    ],
    summary: 'Choose how the selected ACP agent should work for the next turn.',
  };
}

function defaultEffortControl(value: AcpRuntimeOptions): RuntimeSessionProjectionControl {
  return {
    status: 'available',
    owner: 'external',
    source: 'adapter-declared',
    configId: FALLBACK_EFFORT_CONFIG_ID,
    currentValue: value.configValues?.[FALLBACK_EFFORT_CONFIG_ID] ?? DEFAULT_EFFORT,
    options: [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
      { id: 'xhigh', label: 'X High' },
    ],
    summary: 'Choose the reasoning effort sent to the selected ACP agent.',
  };
}

function shouldShowControl(key: ControlKey, control: RuntimeSessionProjectionControl | undefined): control is RuntimeSessionProjectionControl {
  if (!control || control.status !== 'available') return false;
  if (key === 'model') return true;
  return control.options.length > 0;
}

function isFallbackEffortControl(key: ControlKey, control: RuntimeSessionProjectionControl): boolean {
  return key === 'thoughtLevel'
    && control.source === 'adapter-declared'
    && control.configId === FALLBACK_EFFORT_CONFIG_ID;
}

function withConfigValue(value: AcpRuntimeOptions, configId: string, next: string): AcpRuntimeOptions {
  const nextConfigValues = { ...(value.configValues ?? {}) };
  const trimmed = next.trim();
  if (trimmed) {
    nextConfigValues[configId] = trimmed;
  } else {
    delete nextConfigValues[configId];
  }
  return compactAcpRuntimeOptions({
    ...value,
    ...(Object.keys(nextConfigValues).length > 0 ? { configValues: nextConfigValues } : { configValues: undefined }),
  });
}

interface AcpModelInputCapsuleProps {
  control: RuntimeSessionProjectionControl;
  runtimeName: string;
  value: AcpRuntimeOptions;
  onChange: (value: AcpRuntimeOptions) => void;
  disabled: boolean;
}

function AcpModelInputCapsule({
  control,
  runtimeName,
  value,
  onChange,
  disabled,
}: AcpModelInputCapsuleProps) {
  const configId = configIdForControl('model', control) ?? FALLBACK_MODEL_CONFIG_ID;
  const modelValue = value.configValues?.[configId] ?? control.currentValue ?? '';
  const persistedOverride = value.configValues?.[configId] ?? '';
  const [draftModel, setDraftModel] = useState(persistedOverride);
  const inputRef = useRef<HTMLInputElement>(null);
  const displayModel = modelValue.trim() || 'Default';
  const shortModel = displayModel.length > 20 ? `${displayModel.slice(0, 18)}...` : displayModel;

  useEffect(() => {
    setDraftModel(persistedOverride);
  }, [persistedOverride]);

  const commitModel = useCallback((next: string) => {
    onChange(withConfigValue(value, configId, next));
  }, [configId, onChange, value]);

  return (
    <AskOptionCapsule
      title="Model"
      ariaLabel={`${runtimeName} Model`}
      icon={<Cpu size={11} className="shrink-0" />}
      label={shortModel}
      tooltip={modelValue.trim() ? `Model: ${modelValue.trim()}` : 'Model: Default'}
      active={Boolean(persistedOverride.trim())}
      disabled={disabled}
      dropdownWidthClassName="min-w-[270px] max-w-[320px]"
    >
      {({ close }) => (
        <div className="px-3 py-2">
          <label className="block text-2xs font-medium text-muted-foreground" htmlFor={`acp-model-${configId}`}>
            Override
          </label>
          <div className="mt-1 flex items-center gap-1.5 rounded-md border border-border/50 bg-background/65 px-2 py-1.5">
            <Cpu size={12} className="shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              id={`acp-model-${configId}`}
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
              placeholder="model id"
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
              Default
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
  );
}

export default function AcpRuntimeOptionsCapsule({
  projection,
  runtime,
  value,
  onChange,
  controlKeys,
  disabled = false,
}: AcpRuntimeOptionsCapsuleProps) {
  const controls = projection?.controls;
  const entries = useMemo<Array<RuntimeControlEntry>>(() => {
    const modelControl = controls?.model?.status === 'available'
      ? controls.model
      : defaultModelControl(value);
    const modeControl = controls?.mode?.status === 'available' && controls.mode.options.length > 0
      ? controls.mode
      : defaultModeControl(value);
    const effortControl = controls?.thoughtLevel?.status === 'available' && controls.thoughtLevel.options.length > 0
      ? controls.thoughtLevel
      : defaultEffortControl(value);
    return ([
      ['mode', modeControl],
      ['model', modelControl],
      ['thoughtLevel', effortControl],
    ] as const).filter((entry): entry is RuntimeControlEntry => shouldShowControl(entry[0], entry[1]));
  }, [controls, value]);
  const visibleEntries = useMemo(() => (
    controlKeys?.length
      ? entries.filter(([key]) => controlKeys.includes(key))
      : entries
  ), [controlKeys, entries]);
  const runtimeName = projection?.runtimeName ?? runtime?.name ?? 'ACP agent';
  const runtimeId = projection?.runtimeId ?? runtime?.id;

  const updateControl = useCallback((key: ControlKey, control: RuntimeSessionProjectionControl, next: string) => {
    const nextConfigValues = { ...(value.configValues ?? {}) };
    const configId = configIdForControl(key, control);
    if (configId) {
      if (isFallbackEffortControl(key, control) && next === DEFAULT_EFFORT) {
        delete nextConfigValues[configId];
      } else {
        nextConfigValues[configId] = next;
      }
    }
    const nextModeId = key === 'mode' && !control.configId
      ? next
      : value.modeId;
    onChange(compactAcpRuntimeOptions({
      ...(nextModeId ? { modeId: nextModeId } : {}),
      ...(Object.keys(nextConfigValues).length > 0 ? { configValues: nextConfigValues } : {}),
    }));
  }, [onChange, value]);

  if (visibleEntries.length === 0) return null;

  return (
    <div
      data-acp-runtime-options
      {...(runtimeId ? { 'data-runtime-id': runtimeId } : {})}
      className="flex min-w-0 flex-wrap items-center gap-1"
    >
      {visibleEntries.map(([key, control]) => {
        if (key === 'model' && control.options.length === 0) {
          return (
            <AcpModelInputCapsule
              key={key}
              control={control}
              runtimeName={runtimeName}
              value={value}
              onChange={onChange}
              disabled={disabled}
            />
          );
        }
        const selected = selectedValue(key, control, value);
        const options = optionsFor(key, control);
        const selectedOption = control.options.find((option) => option.id === selected);
        const label = compactLabel(selectedOption ? (key === 'mode' ? agentModeLabel(selectedOption) : optionLabel(selectedOption)) : selected || controlTitle(key));
        const editable = canSetControl(key, control);
        const configId = configIdForControl(key, control);
        const locallyActive = key === 'mode'
          ? (control.configId ? value.configValues?.[control.configId] === selected : value.modeId === selected)
          : Boolean(configId && value.configValues?.[configId] === selected);
        return (
          <AskOptionCapsule
            key={key}
            title={controlTitle(key)}
            ariaLabel={`${runtimeName} ${controlTitle(key)}`}
            icon={controlIcon(key)}
            label={label}
            tooltip={editable ? control.summary : `${control.summary} Open an ACP session before changing this control.`}
            value={selected}
            options={options}
            onChange={(next) => updateControl(key, control, next)}
            disabled={disabled || !editable}
            active={locallyActive}
            dropdownWidthClassName="min-w-[230px] max-w-[300px]"
          />
        );
      })}
    </div>
  );
}
