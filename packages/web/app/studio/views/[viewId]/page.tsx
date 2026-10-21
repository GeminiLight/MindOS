import { Suspense } from "react";
import { readSetupPending } from "@/lib/setup-state";
import ClientRedirect from "@/components/ClientRedirect";
import WorkViewWorkspace from "@/components/studio/views/WorkViewWorkspace";
export const dynamic = "force-dynamic";
export default async function ViewPage({
  params,
}: {
  params: Promise<{ viewId: string }>;
}) {
  if (readSetupPending())
    return <ClientRedirect href="/setup" label="Opening setup..." />;
  const { viewId } = await params;
  return (
    <Suspense>
      <WorkViewWorkspace key={viewId} viewId={viewId} />
    </Suspense>
  );
}
