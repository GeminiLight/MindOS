import { redirect } from 'next/navigation';
import { readSettings } from '@/lib/settings';
import ExploreContent from '@/components/explore/ExploreContent';

export const dynamic = 'force-dynamic';

export default function ExplorePage() {
  const settings = readSettings();
  if (settings.setupPending) redirect('/setup');

  return <ExploreContent />;
}
