import ClientRedirect from '@/components/ClientRedirect';
import PluginMarketContent from '@/components/explore/PluginMarketContent';
import { readSetupPending } from '@/lib/setup-state';

export const dynamic = 'force-dynamic';

export default function ExplorePluginsPage() {
  if (readSetupPending()) return <ClientRedirect href="/setup" label="Opening setup..." />;

  return <PluginMarketContent />;
}
