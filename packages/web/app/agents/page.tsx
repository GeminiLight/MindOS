import { readSettings } from '@/lib/settings';
import AgentsContentPage from '@/components/agents/AgentsContentPage';
import { parseAgentsTab } from '@/components/agents/agents-content-model';
import ClientRedirect from '@/components/ClientRedirect';

export const dynamic = 'force-dynamic';

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const settings = readSettings();
  if (settings.setupPending) return <ClientRedirect href="/setup" label="Opening setup..." />;

  const params = await searchParams;
  const tab = parseAgentsTab(params.tab);

  return <AgentsContentPage tab={tab} />;
}
