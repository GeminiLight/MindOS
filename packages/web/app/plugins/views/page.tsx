import { readSetupPending } from '@/lib/setup-state';
import ClientRedirect from '@/components/ClientRedirect';
import PluginViewPageClient from './PluginViewPageClient';

export const dynamic = 'force-dynamic';

export default async function PluginViewPage({
  searchParams,
}: {
  searchParams: Promise<{ pluginId?: string; viewType?: string; sourcePath?: string }>;
}) {
  if (readSetupPending()) return <ClientRedirect href="/setup" label="Opening setup..." />;

  const params = await searchParams;
  return (
    <PluginViewPageClient
      pluginId={params.pluginId ?? ''}
      viewType={params.viewType ?? ''}
      sourcePath={params.sourcePath ?? ''}
    />
  );
}
