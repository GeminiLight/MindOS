'use client';

import { useState } from 'react';
import { Select } from '../Primitives';

const MAX_STEPS_PRESETS = [10, 20, 50, 100, 200, 500, 999] as const;

export function MaxStepsSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const isPreset = MAX_STEPS_PRESETS.includes(value as typeof MAX_STEPS_PRESETS[number]);
  const [customMode, setCustomMode] = useState(!isPreset);

  return (
    <div className="flex items-center gap-2">
      <Select
        value={customMode ? 'custom' : String(value)}
        onChange={e => {
          const v = e.target.value;
          if (v === 'custom') {
            setCustomMode(true);
          } else {
            setCustomMode(false);
            onChange(Number(v));
          }
        }}
        className="w-28"
      >
        <option value="10">10</option>
        <option value="20">20</option>
        <option value="50">50</option>
        <option value="100">100</option>
        <option value="200">200</option>
        <option value="500">500</option>
        <option value="999">Unlimited</option>
        <option value="custom">Custom</option>
      </Select>
      {customMode && (
        <input
          type="number"
          value={value === 999 ? '' : value}
          onChange={e => {
            const nextValue = parseInt(e.target.value, 10);
            if (!isNaN(nextValue) && nextValue > 0) onChange(Math.min(999, nextValue));
          }}
          placeholder="1-999"
          min={1}
          max={999}
          autoFocus
          className="w-20 px-2 py-1 rounded-md border border-border/60 bg-muted/50 text-sm text-foreground"
        />
      )}
    </div>
  );
}
