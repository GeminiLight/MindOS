import { redirect } from 'next/navigation';
import { readSettings } from '@/lib/settings';
import SetupWizard from '@/components/SetupWizard';

export const dynamic = 'force-dynamic';

export default function SetupPage() {
  const settings = readSettings();
  if (!settings.setupPending) redirect('/');
  return <SetupWizard />;
}
