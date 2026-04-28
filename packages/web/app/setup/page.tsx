import { redirect } from 'next/navigation';
import { readSettings } from '@/lib/settings';
import SetupWizard from '@/components/SetupWizard';

export const dynamic = 'force-dynamic';

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ force?: string }> }) {
  const settings = readSettings();
  const { force: forceParam } = await searchParams;
  const force = forceParam === '1';
  if (!settings.setupPending && !force) redirect('/');
  return <SetupWizard />;
}
