import { readSetupPending } from "@/lib/setup-state";
import ClientRedirect from "@/components/ClientRedirect";
import PagesLibrary from "@/components/studio/pages/PagesLibrary";
export const dynamic = "force-dynamic";
export default function PagesPage() {
  if (readSetupPending())
    return <ClientRedirect href="/setup" label="Opening setup..." />;
  return <PagesLibrary />;
}
