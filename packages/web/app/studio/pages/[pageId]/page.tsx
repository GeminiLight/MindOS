import { readSetupPending } from "@/lib/setup-state";
import ClientRedirect from "@/components/ClientRedirect";
import PageWorkspace from "@/components/studio/pages/PageWorkspace";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  if (readSetupPending())
    return <ClientRedirect href="/setup" label="Opening setup..." />;
  const { pageId } = await params;
  return <PageWorkspace key={pageId} pageId={pageId} />;
}
