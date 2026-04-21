'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { PluginSettingItem } from '@/lib/obsidian-compat/types';

interface ObsidianPluginSettingsProps {
  pluginId: string;
  pluginName: string;
  items: PluginSettingItem[];
}

export function ObsidianPluginSettings({ pluginId, pluginName, items }: ObsidianPluginSettingsProps) {
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className="text-sm font-medium">{pluginName}</span>
          <span className="text-xs text-muted-foreground">({items.length} settings)</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border p-4 space-y-4 bg-card/30">
          {items.map((item, index) => (
            <SettingItem key={`${pluginId}-${index}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function SettingItem({ item }: { item: PluginSettingItem }) {
  const [value, setValue] = useState(item.value);

  const handleChange = (newValue: unknown) => {
    setValue(newValue);
    item.onChange?.(newValue);
  };

  return (
    <div className="space-y-2">
      {item.name && (
        <div className="text-sm font-medium text-foreground">{item.name}</div>
      )}
      {item.desc && (
        <div className="text-xs text-muted-foreground">{item.desc}</div>
      )}

      <div className="pt-1">
        {item.kind === 'text' && (
          <input
            type="text"
            value={(value as string) ?? ''}
            onChange={(e) => handleChange(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
          />
        )}

        {item.kind === 'toggle' && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={(value as boolean) ?? false}
              onChange={(e) => handleChange(e.target.checked)}
              className="w-4 h-4 rounded border-border text-[var(--amber)] focus:ring-2 focus:ring-ring"
            />
            <span className="text-sm text-muted-foreground">
              {(value as boolean) ? 'Enabled' : 'Disabled'}
            </span>
          </label>
        )}

        {item.kind === 'dropdown' && item.options && (
          <select
            value={(value as string) ?? ''}
            onChange={(e) => handleChange(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {item.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}

        {item.kind === 'button' && (
          <button
            onClick={() => item.onClick?.()}
            className="px-4 py-2 text-sm font-medium bg-[var(--amber)] text-[var(--amber-foreground)] rounded-lg hover:opacity-90 transition-opacity"
          >
            {item.buttonText ?? 'Click'}
          </button>
        )}
      </div>
    </div>
  );
}
