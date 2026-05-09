import { readSettings } from '@/lib/settings';
import SetupWizard from '@/components/SetupWizard';
import ClientRedirect from '@/components/ClientRedirect';

export const dynamic = 'force-dynamic';

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ force?: string }> }) {
  const settings = readSettings();
  const { force: forceParam } = await searchParams;
  const force = forceParam === '1';
  if (!settings.setupPending && !force) return <ClientRedirect href="/" label="Redirecting to MindOS..." />;
  return <SetupWizard />;
}
