import { getRecentlyModified } from '@/lib/fs';
import HomeContent from '@/components/HomeContent';

export default function HomePage() {
  let recent: { path: string; mtime: number }[] = [];
  try {
    recent = getRecentlyModified(15);
  } catch (err) {
    console.error('[HomePage] Failed to load recent files:', err);
  }
  return <HomeContent recent={recent} />;
}
