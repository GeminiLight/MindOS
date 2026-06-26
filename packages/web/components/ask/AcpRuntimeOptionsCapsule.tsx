'use client';

import { useCallback, useMemo } from 'react';
import { Cpu, Gauge, SlidersHorizontal } from 'lucide-react';
import AskOptionCapsule, { type AskOptionCapsuleOption } from '@/components/ask/AskOptionCapsule';
import type {
  AcpRuntimeOptions,
  RuntimeSessionProjection,
  RuntimeSessionProjectionControl,
} from '@/lib/types';

interface AcpRuntimeOptionsCapsuleProps {
  projection: RuntimeSessionProjection;
  value: AcpRuntimeOptions;
  onChange: (value: AcpRuntimeOptions) => void;
  disabled?: boolean;
}

type ControlKey = keyof RuntimeSessionProjection['controls'];

function compactLabel(label: string): string {
  return label.length > 18 ? `${label.slice(0, 16)}...` : label;
}

function optionLabel(option: { id: string; label?: string }): string {
  return option.label?.trim() || option.id;
}

function optionsFor(control: RuntimeSessionProjectionControl): Array<AskOptionCapsuleOption<string>> {
  return control.options
    .filter((option) => option.id.trim())
    .slice(0, 40)
    .map((option) => ({
      value: option.id,
      label: optionLabel(option),
    }));
}

function selectedValue(
  key: ControlKey,
  control: RuntimeSessionProjectionControl,
  value: AcpRuntimeOptions,
): string {
  if (control.configId && value.configValues?.[control.configId]) return value.configValues[control.configId]!;
  if (key === 'mode' && value.modeId) return value.modeId;
  return control.currentValue ?? control.options[0]?.id ?? '';
}

function controlIcon(key: ControlKey) {
  if (key === 'model') return <Cpu size={11} className="shrink-0" />;
  if (key === 'thoughtLevel') return <Gauge size={11} className="shrink-0" />;
  return <SlidersHorizontal size={11} className="shrink-0" />;
}

function controlTitle(key: ControlKey): string {
  if (key === 'model') return 'Model';
  if (key === 'thoughtLevel') return 'Thought';
  return 'Mode';
}

function canSetControl(key: ControlKey, control: RuntimeSessionProjectionControl): boolean {
  if (control.status !== 'available' || control.options.length === 0) return false;
  if (key === 'mode') return true;
  return Boolean(control.configId);
}

export default function AcpRuntimeOptionsCapsule({
  projection,
  value,
  onChange,
  disabled = false,
}: AcpRuntimeOptionsCapsuleProps) {
  const controls = projection.controls;
  const entries = useMemo(() => ([
    ['model', controls.model],
    ['mode', controls.mode],
    ['thoughtLevel', controls.thoughtLevel],
  ] as const).filter(([, control]) => control.status === 'available' && control.options.length > 0), [controls]);

  const updateControl = useCallback((key: ControlKey, control: RuntimeSessionProjectionControl, next: string) => {
    const nextConfigValues = { ...(value.configValues ?? {}) };
    if (control.configId) nextConfigValues[control.configId] = next;
    const nextModeId = key === 'mode' && !control.configId
      ? next
      : value.modeId;
    onChange({
      ...(nextModeId ? { modeId: nextModeId } : {}),
      ...(Object.keys(nextConfigValues).length > 0 ? { configValues: nextConfigValues } : {}),
    });
  }, [onChange, value]);

  if (entries.length === 0) return null;

  return (
    <div
      data-acp-runtime-options
      data-runtime-id={projection.runtimeId}
      className="flex min-w-0 flex-wrap items-center gap-1"
    >
      {entries.map(([key, control]) => {
        const selected = selectedValue(key, control, value);
        const options = optionsFor(control);
        const selectedOption = control.options.find((option) => option.id === selected);
        const label = compactLabel(selectedOption ? optionLabel(selectedOption) : selected || controlTitle(key));
        const editable = canSetControl(key, control);
        const locallyActive = key === 'mode'
          ? (control.configId ? value.configValues?.[control.configId] === selected : value.modeId === selected)
          : Boolean(control.configId && value.configValues?.[control.configId] === selected);
        return (
          <AskOptionCapsule
            key={key}
            title={controlTitle(key)}
            ariaLabel={`${projection.runtimeName} ${controlTitle(key)}`}
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
