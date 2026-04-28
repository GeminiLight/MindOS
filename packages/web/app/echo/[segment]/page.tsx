import { notFound } from 'next/navigation';
import { isEchoSegment } from '@/lib/echo-segments';
import EchoSegmentPageClient from '@/components/echo/EchoSegmentPageClient';

interface PageProps {
  params: Promise<{ segment: string }>;
}

export default async function EchoSegmentPage({ params }: PageProps) {
  const { segment } = await params;
  if (!isEchoSegment(segment)) {
    notFound();
  }
  return <EchoSegmentPageClient segment={segment} />;
}
