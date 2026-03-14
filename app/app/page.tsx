import { redirect } from 'next/navigation';
import { readSettings } from '@/lib/settings';
import { getRecentlyModified } from '@/lib/fs';
import HomeContent from '@/components/HomeContent';

export default function HomePage() {
  const settings = readSettings();
  if (settings.setupPending) redirect('/setup');

  let recent: { path: string; mtime: number }[] = [];
  try {
    recent = getRecentlyModified(15);
  } catch (err) {
    console.error('[HomePage] Failed to load recent files:', err);
  }
  return <HomeContent recent={recent} />;
}
