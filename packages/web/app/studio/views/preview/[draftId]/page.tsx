import WorkViewWorkspace from "@/components/studio/views/WorkViewWorkspace";
export const dynamic = "force-dynamic";
export default async function Preview({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  return <WorkViewWorkspace draftId={draftId} />;
}
