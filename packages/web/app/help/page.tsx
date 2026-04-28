import { redirect } from 'next/navigation';
import { readSettings } from '@/lib/settings';
import HelpContent from '@/components/help/HelpContent';

export const dynamic = 'force-dynamic';

export default function HelpPage() {
  const settings = readSettings();
  if (settings.setupPending) redirect('/setup');

  return <HelpContent />;
}
