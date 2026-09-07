import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ReviewerWorkspace } from '@/components/echo/research/ReviewerWorkspace';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Independent review · MindOS', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function ReviewerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!/^study-[a-f0-9]{24}$/.test(id)) notFound();
  const h = await headers(); return <ReviewerWorkspace studyId={id} locale={h.get('accept-language')?.includes('zh') ? 'zh' : 'en'} />;
}
