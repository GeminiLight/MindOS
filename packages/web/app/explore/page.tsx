import { readSettings } from '@/lib/settings';
import ExploreContent from '@/components/explore/ExploreContent';
import ClientRedirect from '@/components/ClientRedirect';

export const dynamic = 'force-dynamic';

export default function ExplorePage() {
  const settings = readSettings();
  if (settings.setupPending) return <ClientRedirect href="/setup" label="Opening setup..." />;

  return <ExploreContent />;
}
