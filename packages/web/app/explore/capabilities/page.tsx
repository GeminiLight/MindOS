import ClientRedirect from '@/components/ClientRedirect';
import CapabilityMarketplaceContent from '@/components/explore/CapabilityMarketplaceContent';
import { readSetupPending } from '@/lib/setup-state';

export const dynamic = 'force-dynamic';

export default function ExploreCapabilitiesPage() {
  if (readSetupPending()) return <ClientRedirect href="/setup" label="Opening setup..." />;

  return <CapabilityMarketplaceContent />;
}
