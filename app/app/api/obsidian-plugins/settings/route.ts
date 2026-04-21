import { NextResponse } from 'next/server';
import { readSettings } from '@/lib/settings';
import { PluginManager } from '@/lib/obsidian-compat/plugin-manager';

export const dynamic = 'force-dynamic';

/**
 * GET /api/obsidian-plugins/settings
 * Returns settings for all loaded Obsidian plugins
 */
export async function GET() {
  try {
    const settings = readSettings();
    const manager = new PluginManager(settings.mindRoot);
    const loader = manager.getLoader();
    const loadedPlugins = loader.getLoadedPlugins();

    const pluginSettings = loadedPlugins.map((plugin) => {
      const settingTabs = plugin.instance.settingTabs || [];

      // Call display() on each tab to populate items
      settingTabs.forEach((tab) => {
        try {
          tab.display();
        } catch (err) {
          console.error(`Failed to display settings for ${plugin.manifest.id}:`, err);
        }
      });

      return {
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        settingTabs: settingTabs.map((tab) => ({
          items: tab.items || [],
        })),
      };
    });

    return NextResponse.json({ plugins: pluginSettings });
  } catch (error) {
    console.error('Failed to get plugin settings:', error);
    return NextResponse.json(
      { error: 'Failed to get plugin settings' },
      { status: 500 }
    );
  }
}
