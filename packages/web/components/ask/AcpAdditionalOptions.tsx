'use client';
import { SlidersHorizontal } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import type { AcpRuntimeOptions, RuntimeSessionProjection } from '@/lib/types';
import AskOptionCapsule from './AskOptionCapsule';

type ConfigOption = NonNullable<RuntimeSessionProjection['configOptions']>[number];
export default function AcpAdditionalOptions({ options, value, disabled, onChange }: {
  options: ConfigOption[];
  value: AcpRuntimeOptions;
  disabled: boolean;
  onChange: (id: string, value: string) => void;
}) {
  const { t } = useLocale();
  const text = t.ask.agentOptions;
  return <AskOptionCapsule title={text.title} ariaLabel={text.title} label={text.title}
    icon={<SlidersHorizontal size={11} />} disabled={disabled}
    active={options.some(option => value.configValues?.[option.configId] !== undefined)}
    dropdownWidthClassName="w-[min(320px,calc(100vw-1rem))]">
    {() => <div className="space-y-4 p-3">
      <p className="text-xs text-muted-foreground">{text.hint}</p>
      {options.map(option => {
        const selected = option.options.find(item => item.id === (value.configValues?.[option.configId] ?? option.currentValue));
        return <label key={option.configId} className="block space-y-1.5">
        <span className="block text-xs font-medium text-foreground">{option.label ?? option.configId}</span>
        {option.description && <span className="block text-xs text-muted-foreground">{option.description}</span>}
        <select aria-label={option.label ?? option.configId} disabled={disabled}
          value={value.configValues?.[option.configId] ?? option.currentValue}
          onChange={event => { if (!disabled) onChange(option.configId, event.target.value); }}
          className="min-h-9 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
          {option.options.map(item => <option key={item.id} value={item.id}>{item.group ? `${item.group} · ` : ''}{item.label}</option>)}
        </select>
        {selected?.description && <span className="block text-xs text-muted-foreground">{selected.description}</span>}
      </label>; })}
    </div>}
  </AskOptionCapsule>;
}
