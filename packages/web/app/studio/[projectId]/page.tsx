import { readSetupPending } from '@/lib/setup-state';
import ClientRedirect from '@/components/ClientRedirect';
import StudioProjectContent from '@/components/studio/StudioProjectContent';

export const dynamic = 'force-dynamic';

export default async function StudioProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  if (readSetupPending()) return <ClientRedirect href="/setup" label="Opening setup..." />;
  const { projectId } = await params;
  return <StudioProjectContent projectId={decodeURIComponent(projectId)} />;
}
