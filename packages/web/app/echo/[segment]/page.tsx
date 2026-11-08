import { notFound } from 'next/navigation';
import { isEchoSegment } from '@/lib/echo-segments';
import ClientRedirect from '@/components/ClientRedirect';
import EchoSegmentPageClient from '@/components/echo/EchoSegmentPageClient';

interface PageProps {
  params: Promise<{ segment: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function EchoSegmentPage({ params, searchParams }: PageProps) {
  const { segment } = await params;
  if (!isEchoSegment(segment)) {
    notFound();
  }
  const query = await searchParams;
  if ((segment === 'growth' || segment === 'practice') && typeof query.learning === 'string' && /^learn-[a-f0-9]{24}$/.test(query.learning)) {
    const target = new URLSearchParams({ learning: query.learning });
    if (query.practice === '1') target.set('practice', '1');
    return <ClientRedirect href={'/echo/learning?' + target} />;
  }
  return <EchoSegmentPageClient segment={segment} />;
}
