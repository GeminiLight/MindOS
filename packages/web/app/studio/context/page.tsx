import { readSetupPending } from '@/lib/setup-state';
import ClientRedirect from '@/components/ClientRedirect';
import ContextInspectorContent from '@/components/studio/ContextInspectorContent';

export const dynamic = 'force-dynamic';

export default function StudioContextPage() {
  if (readSetupPending()) return <ClientRedirect href="/setup" label="Opening setup..." />;
  return <ContextInspectorContent />;
}
