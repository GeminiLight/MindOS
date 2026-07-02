import { readSetupPending } from '@/lib/setup-state';
import { listWorkspaceSpaces } from '@/lib/space-records';
import ClientRedirect from '@/components/ClientRedirect';
import StudioContent from '@/components/studio/StudioContent';

export const dynamic = 'force-dynamic';

export default function StudioProjectsPage() {
  if (readSetupPending()) return <ClientRedirect href="/setup" label="Opening setup..." />;
  return <StudioContent workspaceSpaces={listWorkspaceSpaces()} />;
}
