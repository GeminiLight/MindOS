import { readSetupPending } from '@/lib/setup-state';
import ClientRedirect from '@/components/ClientRedirect';
import StudioAppsContent from '@/components/studio/StudioAppsContent';

export const dynamic = 'force-dynamic';

export default function StudioAppsPage() {
  if (readSetupPending()) return <ClientRedirect href="/setup" label="Opening setup..." />;
  return <StudioAppsContent />;
}
