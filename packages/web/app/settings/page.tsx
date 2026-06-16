import { readSetupPending } from '@/lib/setup-state';
import SettingsContent from '@/components/settings/SettingsContent';
import ClientRedirect from '@/components/ClientRedirect';
import type { PluginPanel, Tab } from '@/components/settings/types';

export const dynamic = 'force-dynamic';

const SETTINGS_TABS = new Set<Tab>([
  'ai',
  'mcp',
  'plugins',
  'knowledge',
  'appearance',
  'navigation',
  'sync',
  'update',
  'uninstall',
]);
const PLUGIN_PANELS = new Set<PluginPanel>(['installed', 'community', 'import', 'surfaces']);

function parseSettingsTab(tab: string | undefined): Tab | undefined {
  return tab && SETTINGS_TABS.has(tab as Tab) ? (tab as Tab) : undefined;
}

function parsePluginPanel(panel: string | undefined): PluginPanel | undefined {
  return panel && PLUGIN_PANELS.has(panel as PluginPanel) ? (panel as PluginPanel) : undefined;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; panel?: string }>;
}) {
  if (readSetupPending()) return <ClientRedirect href="/setup" label="Opening setup..." />;

  const params = await searchParams;
  const initialTab = parseSettingsTab(params.tab);
  const initialPluginPanel = initialTab === 'plugins' ? parsePluginPanel(params.panel) : undefined;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <SettingsContent visible variant="panel" initialTab={initialTab} initialPluginPanel={initialPluginPanel} />
    </div>
  );
}
