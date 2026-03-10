import { getRecentlyModified } from '@/lib/fs';
import HomeContent from '@/components/HomeContent';

export default function HomePage() {
  const recent = getRecentlyModified(15);
  return <HomeContent recent={recent} />;
}
