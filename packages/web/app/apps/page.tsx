import { readSetupPending } from '@/lib/setup-state';
import ClientRedirect from '@/components/ClientRedirect';

export const dynamic = 'force-dynamic';

export default function AppsPage() {
  if (readSetupPending()) return <ClientRedirect href="/setup" label="Opening setup..." />;
  return <ClientRedirect href="/studio/apps" label="Opening Studio Apps..." />;
}
