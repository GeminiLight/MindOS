import { redirect } from 'next/navigation';
import { readSettings } from '@/lib/settings';
import AgentDetailContent from '@/components/agents/AgentDetailContent';

export const dynamic = 'force-dynamic';

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentKey: string }>;
}) {
  const settings = readSettings();
  if (settings.setupPending) redirect('/setup');

  const { agentKey } = await params;
  return <AgentDetailContent agentKey={decodeURIComponent(agentKey)} />;
}
