import { NextResponse } from 'next/server';
import { readSettings } from '@/lib/settings';
import { withObsidianPluginRuntime } from '@/lib/obsidian-compat/runtime-service';
import type { LoadedPlugin } from '@/lib/obsidian-compat/loader';
import type { PluginSettingItem, PluginSettingTab } from '@/lib/obsidian-compat/types';

export const dynamic = 'force-dynamic';

type SettingAction = 'set-value' | 'click-button';

interface SerializedSettingItem {
  name?: string;
  desc?: string;
  kind?: PluginSettingItem['kind'];
  value?: unknown;
  placeholder?: string;
  disabled?: boolean;
  cta?: boolean;
  buttonText?: string;
  options?: Array<{ value: string; label: string }>;
  canChange: boolean;
  canClick: boolean;
}

interface SettingActionBody {
  action?: SettingAction;
  pluginId?: string;
  tabIndex?: number;
  itemIndex?: number;
  value?: unknown;
}

function resetTab(tab: PluginSettingTab): void {
  if (Array.isArray(tab.items)) {
    tab.items.length = 0;
  }
  const container = tab.containerEl as HTMLElement & {
    empty?: () => void;
    __obsidianSettingItems?: PluginSettingItem[];
  };
  if (typeof container.empty === 'function') {
    container.empty();
  } else if (Array.isArray(tab.items)) {
    container.__obsidianSettingItems = tab.items;
  }
}

function serializeSettingItem(item: PluginSettingItem): SerializedSettingItem {
  return {
    name: item.name,
    desc: item.desc,
    kind: item.kind,
    value: item.value,
    placeholder: item.placeholder,
    disabled: item.disabled,
    cta: item.cta,
    buttonText: item.buttonText,
    options: item.options,
    canChange: typeof item.onChange === 'function' && !item.disabled,
    canClick: typeof item.onClick === 'function' && !item.disabled,
  };
}

function collectPluginSettings(plugin: LoadedPlugin) {
  const settingTabs = plugin.instance.settingTabs || [];

  return {
    id: plugin.manifest.id,
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    settingTabs: settingTabs.map((tab) => {
      let error: string | undefined;
      try {
        resetTab(tab);
        tab.display();
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        console.error(`Failed to display settings for ${plugin.manifest.id}:`, err);
      }

      return {
        error,
        items: (tab.items || []).map(serializeSettingItem),
      };
    }),
  };
}

function requireSettingAction(body: SettingActionBody): Required<Pick<SettingActionBody, 'action' | 'pluginId' | 'tabIndex' | 'itemIndex'>> & Pick<SettingActionBody, 'value'> {
  if (body.action !== 'set-value' && body.action !== 'click-button') {
    throw new Error('Invalid settings action');
  }
  if (typeof body.pluginId !== 'string' || body.pluginId.trim().length === 0) {
    throw new Error('Missing pluginId');
  }
  if (!Number.isInteger(body.tabIndex) || (body.tabIndex ?? -1) < 0) {
    throw new Error('Missing tabIndex');
  }
  if (!Number.isInteger(body.itemIndex) || (body.itemIndex ?? -1) < 0) {
    throw new Error('Missing itemIndex');
  }
  const tabIndex = body.tabIndex as number;
  const itemIndex = body.itemIndex as number;
  return {
    action: body.action,
    pluginId: body.pluginId.trim(),
    tabIndex,
    itemIndex,
    value: body.value,
  };
}

async function collectLoadedPluginSettings() {
  const settings = readSettings();
  return withObsidianPluginRuntime(settings.mindRoot, async (manager) => {
    const loadResult = await manager.loadEnabledPlugins();
    const pluginSettings = manager.getLoader().getLoadedPlugins().map(collectPluginSettings);
    return { loadResult, pluginSettings, status: manager.list() };
  });
}

/**
 * GET /api/obsidian-plugins/settings
 * Returns settings for all loaded Obsidian plugins
 */
export async function GET() {
  try {
    const { loadResult, pluginSettings, status } = await collectLoadedPluginSettings();

    return NextResponse.json({
      ok: true,
      loadResult,
      plugins: pluginSettings,
      status,
    });
  } catch (error) {
    console.error('Failed to get plugin settings:', error);
    return NextResponse.json(
      { error: 'Failed to get plugin settings' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const action = requireSettingAction(await req.json() as SettingActionBody);
    const settings = readSettings();
    return await withObsidianPluginRuntime(settings.mindRoot, async (manager) => {
      const loadResult = await manager.loadEnabledPlugins();
      const loadedPlugins = manager.getLoader().getLoadedPlugins();
      const plugin = loadedPlugins.find((item) => item.manifest.id === action.pluginId);
      if (!plugin) {
        return NextResponse.json({ ok: false, error: `Plugin is not enabled or failed to load: ${action.pluginId}` }, { status: 404 });
      }

      const tab = plugin.instance.settingTabs[action.tabIndex];
      if (!tab) {
        return NextResponse.json({ ok: false, error: `Unknown settings tab: ${action.tabIndex}` }, { status: 404 });
      }

      resetTab(tab);
      tab.display();
      const item = tab.items?.[action.itemIndex];
      if (!item) {
        return NextResponse.json({ ok: false, error: `Unknown settings item: ${action.itemIndex}` }, { status: 404 });
      }
      if (item.disabled) {
        return NextResponse.json({ ok: false, error: 'Settings item is disabled' }, { status: 400 });
      }

      if (action.action === 'set-value') {
        if (typeof item.onChange !== 'function') {
          return NextResponse.json({ ok: false, error: 'Settings item does not support value changes' }, { status: 400 });
        }
        await Promise.resolve(item.onChange(action.value));
      } else {
        if (typeof item.onClick !== 'function') {
          return NextResponse.json({ ok: false, error: 'Settings item does not support button clicks' }, { status: 400 });
        }
        await Promise.resolve(item.onClick());
      }

      const refreshedSettings = loadedPlugins.map(collectPluginSettings);
      return NextResponse.json({
        ok: true,
        loadResult,
        plugins: refreshedSettings,
        status: manager.list(),
      });
    });
  } catch (error) {
    console.error('Failed to update plugin settings:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to update plugin settings' },
      { status: 400 }
    );
  }
}
