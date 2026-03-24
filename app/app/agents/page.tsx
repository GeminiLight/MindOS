import { redirect } from 'next/navigation';
import { readSettings } from '@/lib/settings';
import AgentsContentPage from '@/components/agents/AgentsContentPage';
import { parseAgentsTab } from '@/components/agents/agents-content-model';

export const dynamic = 'force-dynamic';

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const settings = readSettings();
  if (settings.setupPending) redirect('/setup');

  const params = await searchParams;
  const tab = parseAgentsTab(params.tab);

  return <AgentsContentPage tab={tab} />;
}
