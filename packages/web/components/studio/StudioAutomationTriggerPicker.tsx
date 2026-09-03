'use client';

import { Clock3, Radio } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { StudioAutomationSchedulePicker } from './StudioAutomationSchedulePicker';
import type { StudioAutomationDraft, StudioAutomationTrigger } from '@/lib/studio-automations';

type Copy = ComponentProps<typeof StudioAutomationSchedulePicker>['copy'] & {
  triggerLabel: string;
  triggerSchedule: string;
  triggerEvent: string;
  eventSourceLabel: string;
  eventSourcePlaceholder: string;
  eventTypeLabel: string;
  eventTypePlaceholder: string;
  eventDebounceLabel: string;
  eventStormLabel: string;
  eventFilterLabel: string;
  eventFilterPlaceholder: string;
  eventFilterHint: string;
  eventFilterError: string;
  eventHint: string;
};

const DEFAULT_EVENT_TRIGGER: StudioAutomationTrigger = {
  type: 'event',
  sources: ['inbox'],
  events: ['inbox.created'],
  debounceMs: 1_000,
  storm: { windowMs: 60_000, maxEvents: 100 },
};

export function StudioAutomationTriggerPicker({
  copy,
  draft,
  onChange,
}: {
  copy: Copy;
  draft: StudioAutomationDraft;
  onChange(updater: (current: StudioAutomationDraft) => StudioAutomationDraft): void;
}) {
  const eventTrigger = draft.trigger.type === 'event' ? draft.trigger : null;
  const fieldClass = 'h-10 rounded-lg border border-border/70 bg-background/75 px-3 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/55 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35';
  return (
    <section data-studio-automation-trigger className="grid gap-3 border-t border-border/55 pt-4" aria-label={copy.triggerLabel}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{copy.triggerLabel}</span>
        <div className="flex rounded-lg border border-border/60 bg-muted/25 p-0.5">
          <TriggerButton active={!eventTrigger} label={copy.triggerSchedule} icon={<Clock3 size={12} />} onClick={() => onChange((current) => ({
            ...current,
            schedule: current.schedule === 'manual' ? 'daily-0900' : current.schedule,
            trigger: current.schedule === 'manual'
              ? { type: 'schedule', schedule: 'daily-0900', timezone: current.timezone }
              : { type: 'schedule', schedule: current.schedule, timezone: current.timezone },
          }))} />
          <TriggerButton active={Boolean(eventTrigger)} label={copy.triggerEvent} icon={<Radio size={12} />} onClick={() => onChange((current) => ({
            ...current, schedule: 'manual', trigger: structuredClone(DEFAULT_EVENT_TRIGGER),
          }))} />
        </div>
      </div>

      {eventTrigger ? (
        <div data-studio-automation-event-trigger className="grid gap-3 rounded-lg border border-border/55 bg-background/35 p-3 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">{copy.eventSourceLabel}</span>
            <input aria-label={copy.eventSourceLabel} value={eventTrigger.sources.join(', ')} placeholder={copy.eventSourcePlaceholder} className={fieldClass} onChange={(event) => updateEvent(onChange, { sources: patterns(event.target.value) })} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">{copy.eventTypeLabel}</span>
            <input aria-label={copy.eventTypeLabel} value={eventTrigger.events.join(', ')} placeholder={copy.eventTypePlaceholder} className={fieldClass} onChange={(event) => updateEvent(onChange, { events: patterns(event.target.value) })} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">{copy.eventDebounceLabel}</span>
            <input aria-label={copy.eventDebounceLabel} type="number" min="0" max="3600" value={eventTrigger.debounceMs / 1000} className={fieldClass} onChange={(event) => updateEvent(onChange, { debounceMs: seconds(event.target.value, 0, 3600) * 1000 })} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">{copy.eventStormLabel}</span>
            <input aria-label={copy.eventStormLabel} type="number" min="1" max="10000" value={eventTrigger.storm.maxEvents} className={fieldClass} onChange={(event) => updateEvent(onChange, { storm: { ...eventTrigger.storm, maxEvents: seconds(event.target.value, 1, 10000) } })} />
          </label>
          <MetadataFilterField copy={copy} trigger={eventTrigger} onChange={onChange} />
          <p className="text-[11px] leading-relaxed text-muted-foreground sm:col-span-2">{copy.eventHint}</p>
        </div>
      ) : (
        <StudioAutomationSchedulePicker copy={copy} value={draft.schedule} onChange={(schedule) => onChange((current) => ({
          ...current,
          schedule,
          trigger: schedule === 'manual' ? { type: 'manual' } : { type: 'schedule', schedule, timezone: current.timezone },
        }))} />
      )}
    </section>
  );
}

function MetadataFilterField({
  copy,
  trigger,
  onChange,
}: {
  copy: Copy;
  trigger: Extract<StudioAutomationTrigger, { type: 'event' }>;
  onChange: (updater: (current: StudioAutomationDraft) => StudioAutomationDraft) => void;
}) {
  const serialized = trigger.where ? JSON.stringify(trigger.where) : '';
  const [text, setText] = useState(serialized);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setText(serialized);
    setError(false);
    inputRef.current?.setCustomValidity('');
  }, [serialized]);

  return (
    <label className="grid gap-1.5 sm:col-span-2">
      <span className="text-[11px] font-medium text-muted-foreground">{copy.eventFilterLabel}</span>
      <textarea
        ref={inputRef}
        aria-label={copy.eventFilterLabel}
        value={text}
        rows={2}
        placeholder={copy.eventFilterPlaceholder}
        className="min-h-16 resize-y rounded-lg border border-border/70 bg-background/75 px-3 py-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/55 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
        onChange={(event) => {
          const nextText = event.target.value;
          setText(nextText);
          const parsed = parseMetadataFilter(nextText);
          const invalid = parsed === null;
          setError(invalid);
          event.target.setCustomValidity(invalid ? copy.eventFilterError : '');
          if (!invalid) updateEvent(onChange, parsed ? { where: parsed } : { where: undefined });
        }}
      />
      <span className={`text-[11px] leading-relaxed ${error ? 'text-error' : 'text-muted-foreground'}`}>
        {error ? copy.eventFilterError : copy.eventFilterHint}
      </span>
    </label>
  );
}

function parseMetadataFilter(value: string): Record<string, string | number | boolean> | undefined | null {
  if (!value.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed);
    if (entries.length > 20) return null;
    const valid = entries.every(([key, item]) => {
      const segments = key.split('.');
      const safeKey = segments.length <= 4 && segments.every((segment) => (
        /^[A-Za-z0-9][A-Za-z0-9_:-]{0,79}$/.test(segment)
        && segment !== '__proto__'
        && segment !== 'constructor'
        && segment !== 'prototype'
      ));
      return safeKey && (
        typeof item === 'boolean'
        || (typeof item === 'number' && Number.isFinite(item))
        || (typeof item === 'string' && item.length <= 500)
      );
    });
    return valid ? Object.fromEntries(entries) as Record<string, string | number | boolean> : null;
  } catch {
    return null;
  }
}

function TriggerButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: ReactNode; onClick(): void }) {
  return <button data-studio-automation-trigger-kind={active ? 'active' : undefined} type="button" aria-pressed={active} onClick={onClick} className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{icon}{label}</button>;
}

function patterns(value: string): string[] {
  return Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean))).slice(0, 50);
}

function seconds(value: string, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : min;
}

function updateEvent(
  onChange: (updater: (current: StudioAutomationDraft) => StudioAutomationDraft) => void,
  patch: Partial<Extract<StudioAutomationTrigger, { type: 'event' }>>,
) {
  onChange((current) => current.trigger.type === 'event'
    ? { ...current, trigger: { ...current.trigger, ...patch } }
    : current);
}
