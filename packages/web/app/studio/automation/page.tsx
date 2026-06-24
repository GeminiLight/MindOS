import { readSetupPending } from '@/lib/setup-state';
import ClientRedirect from '@/components/ClientRedirect';
import StudioAutomationContent from '@/components/studio/StudioAutomationContent';

export const dynamic = 'force-dynamic';

export default function StudioAutomationPage() {
  if (readSetupPending()) return <ClientRedirect href="/setup" label="Opening setup..." />;
  return <StudioAutomationContent />;
}
