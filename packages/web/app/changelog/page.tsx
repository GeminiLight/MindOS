import { redirect } from 'next/navigation';
import { readSettings } from '@/lib/settings';
import ChangelogClient from './ChangelogClient';

export const dynamic = 'force-dynamic';

export default async function ChangelogPage() {
  const settings = readSettings();
  if (settings.setupPending) redirect('/setup');
  return <ChangelogClient />;
}
