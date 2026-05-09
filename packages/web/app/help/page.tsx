import { readSettings } from '@/lib/settings';
import HelpContent from '@/components/help/HelpContent';
import ClientRedirect from '@/components/ClientRedirect';

export const dynamic = 'force-dynamic';

export default function HelpPage() {
  const settings = readSettings();
  if (settings.setupPending) return <ClientRedirect href="/setup" label="Opening setup..." />;

  return <HelpContent />;
}
