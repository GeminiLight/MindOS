'use client';

import { useEffect, useState } from 'react';
import { ObsidianPluginSettings } from './ObsidianPluginSettings';
import type { PluginSettingItem } from '@/lib/obsidian-compat/types';

interface PluginSettingsData {
  id: string;
  name: string;
  version: string;
  settingTabs: Array<{
    items: PluginSettingItem[];
  }>;
}

export function ObsidianPluginSettingsList() {
  const [plugins, setPlugins] = useState<PluginSettingsData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSettings() {
      try {
        const response = await fetch('/api/obsidian-plugins/settings');
        if (!response.ok) {
          throw new Error('Failed to fetch plugin settings');
        }
        const data = await response.json();
        setPlugins(data.plugins || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchSettings();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-sm text-muted-foreground">Loading plugin settings...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-sm text-destructive">Error: {error}</div>
      </div>
    );
  }

  const pluginsWithSettings = plugins.filter(
    (plugin) => plugin.settingTabs.some((tab) => tab.items.length > 0)
  );

  if (pluginsWithSettings.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-sm text-muted-foreground">
          No plugin settings available
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {pluginsWithSettings.map((plugin) =>
        plugin.settingTabs.map((tab, tabIndex) => (
          <ObsidianPluginSettings
            key={`${plugin.id}-${tabIndex}`}
            pluginId={plugin.id}
            pluginName={plugin.name}
            items={tab.items}
          />
        ))
      )}
    </div>
  );
}
