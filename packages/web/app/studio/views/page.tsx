import { readSetupPending } from "@/lib/setup-state";
import ClientRedirect from "@/components/ClientRedirect";
import ViewsIndex from "@/components/studio/views/ViewsIndex";
export const dynamic = "force-dynamic";
export default function ViewsPage() {
  if (readSetupPending())
    return <ClientRedirect href="/setup" label="Opening setup..." />;
  return <ViewsIndex />;
}
