import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ParticipantWorkspace } from '@/components/echo/research/ParticipantWorkspace';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Study participation · MindOS', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function ParticipantPage({ params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    const { id } = await params;
    if (!/^study-[a-f0-9]{24}$/.test(id))
        notFound();
    const requestHeaders = await headers();
    const locale = requestHeaders.get('accept-language')?.includes('zh') ? 'zh' : 'en';
    return <ParticipantWorkspace studyId={id} locale={locale}/>;
}
