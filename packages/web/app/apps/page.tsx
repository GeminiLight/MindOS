import { readSetupPending } from '@/lib/setup-state';
import ClientRedirect from '@/components/ClientRedirect';
import AppsContent from '@/components/apps/AppsContent';

export const dynamic = 'force-dynamic';

export default function AppsPage() {
  if (readSetupPending()) return <ClientRedirect href="/setup" label="Opening setup..." />;
  return <AppsContent />;
}
