'use client';

import { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';

import AskOptionCapsule, {
  type AskOptionCapsuleOption,
} from '@/components/ask/AskOptionCapsule';
import type { ProviderSelection } from '@/lib/session-model-selection';
import {
  clampMindosThinkingLevel,
  isMindosThinkingLevel,
  type MindosThinkingLevel,
} from '@/lib/agent/thinking';

const STORAGE_PREFIX = 'mindos-pi-thinking-level.v1';

type ModelThinkingPayload = {
  ok: true;
  provider: string;
  model: string;
  reasoning: boolean;
  defaultLevel: MindosThinkingLevel;
  levels: MindosThinkingLevel[];
};

function storageKey(provider: string | null, model: string | null): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(provider ?? 'system')}:${encodeURIComponent(model ?? 'default')}`;
}

export function getPersistedPiThinkingLevel(
  provider: string | null,
  model: string | null,
): MindosThinkingLevel | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const value = localStorage.getItem(storageKey(provider, model));
    return isMindosThinkingLevel(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function persistPiThinkingLevel(
  provider: string | null,
  model: string | null,
  level: MindosThinkingLevel,
): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey(provider, model), level);
  } catch {
    // Private mode / quota: the current turn still uses the in-memory value.
  }
}

function levelLabel(level: MindosThinkingLevel): string {
  if (level === 'xhigh') return 'Extra High';
  return `${level[0]?.toUpperCase() ?? ''}${level.slice(1)}`;
}

function levelDescription(level: MindosThinkingLevel): string {
  if (level === 'off') return 'Disable model reasoning for faster responses.';
  if (level === 'minimal') return 'Use the model’s smallest reasoning budget.';
  if (level === 'low') return 'Use light reasoning for straightforward tasks.';
  if (level === 'medium') return 'Balance reasoning depth, latency, and cost.';
  if (level === 'high') return 'Use deeper reasoning for complex tasks.';
  if (level === 'xhigh') return 'Use extra-high reasoning when the model supports it.';
  return 'Use the model’s maximum advertised reasoning effort.';
}

export default function PiThinkingLevelCapsule({
  providerValue,
  modelValue,
  value,
  onChange,
  disabled = false,
}: {
  providerValue: ProviderSelection;
  modelValue: string | null;
  value?: MindosThinkingLevel;
  onChange: (level: MindosThinkingLevel) => void;
  disabled?: boolean;
}) {
  const [capability, setCapability] = useState<ModelThinkingPayload | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setCapability(null);
    void fetch('/api/settings/model-thinking', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: providerValue,
        model: modelValue,
      }),
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json() as Partial<ModelThinkingPayload>;
      const levels = Array.isArray(payload.levels)
        ? payload.levels.filter(isMindosThinkingLevel)
        : [];
      if (
        payload.ok !== true
        || typeof payload.provider !== 'string'
        || typeof payload.model !== 'string'
        || levels.length === 0
      ) {
        return;
      }
      const normalized: ModelThinkingPayload = {
        ok: true,
        provider: payload.provider,
        model: payload.model,
        reasoning: payload.reasoning === true,
        defaultLevel: isMindosThinkingLevel(payload.defaultLevel)
          ? payload.defaultLevel
          : 'off',
        levels,
      };
      setCapability(normalized);
      const preferred = getPersistedPiThinkingLevel(normalized.provider, normalized.model)
        ?? value
        ?? normalized.defaultLevel;
      const next = clampMindosThinkingLevel(preferred, normalized.levels);
      if (next !== value) onChange(next);
    }).catch(() => {});
    return () => controller.abort();
    // The selected value is intentionally not a dependency: changing effort
    // must not refetch model metadata. Provider/model changes do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelValue, onChange, providerValue]);

  if (!capability || capability.levels.length <= 1) return null;

  const selected = value && capability.levels.includes(value)
    ? value
    : capability.defaultLevel;
  const options: Array<AskOptionCapsuleOption<MindosThinkingLevel>> = capability.levels.map((level) => ({
    value: level,
    label: levelLabel(level),
    description: levelDescription(level),
    icon: <Gauge size={13} className="shrink-0" />,
  }));

  return (
    <div data-pi-thinking-level>
      <AskOptionCapsule
        title="Thinking effort"
        ariaLabel="Thinking effort"
        icon={<Gauge size={11} className="shrink-0" />}
        label={levelLabel(selected)}
        tooltip={levelDescription(selected)}
        value={selected}
        options={options}
        onChange={(next) => {
          persistPiThinkingLevel(capability.provider, capability.model, next);
          onChange(next);
        }}
        disabled={disabled}
        active={selected !== 'off'}
        dropdownWidthClassName="min-w-[245px] max-w-[300px]"
      />
    </div>
  );
}
