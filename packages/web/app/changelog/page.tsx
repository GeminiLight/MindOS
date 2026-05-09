import { readSettings } from '@/lib/settings';
import ChangelogClient from './ChangelogClient';
import ClientRedirect from '@/components/ClientRedirect';

export const dynamic = 'force-dynamic';

export default async function ChangelogPage() {
  const settings = readSettings();
  if (settings.setupPending) return <ClientRedirect href="/setup" label="Opening setup..." />;
  return <ChangelogClient />;
}
