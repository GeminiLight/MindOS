import { redirect } from 'next/navigation';
import { readSettings } from '@/lib/settings';
import ChangesContentPage from '@/components/changes/ChangesContentPage';

export const dynamic = 'force-dynamic';

export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string }>;
}) {
  const settings = readSettings();
  if (settings.setupPending) redirect('/setup');
  const params = await searchParams;
  return <ChangesContentPage initialPath={params.path ?? ''} />;
}
