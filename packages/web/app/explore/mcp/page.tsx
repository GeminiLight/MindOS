import ClientRedirect from '@/components/ClientRedirect';
import McpMarketContent from '@/components/explore/McpMarketContent';
import { readSetupPending } from '@/lib/setup-state';

export const dynamic = 'force-dynamic';

export default function ExploreMcpPage() {
  if (readSetupPending()) return <ClientRedirect href="/setup" label="Opening setup..." />;

  return <McpMarketContent />;
}
