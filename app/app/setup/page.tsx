import { redirect } from 'next/navigation';
import { readSettings } from '@/lib/settings';
import SetupWizard from '@/components/SetupWizard';

export const dynamic = 'force-dynamic';

export default function SetupPage({ searchParams }: { searchParams: { force?: string } }) {
  const settings = readSettings();
  const force = searchParams.force === '1';
  if (!settings.setupPending && !force) redirect('/');
  return <SetupWizard />;
}
