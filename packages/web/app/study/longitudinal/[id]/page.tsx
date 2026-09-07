import { headers } from "next/headers";
import { notFound } from "next/navigation";
import LongitudinalParticipant from "@/components/echo/longitudinal/LongitudinalParticipant";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Study participation · MindOS",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^cohort-[a-f0-9]{24}$/.test(id)) notFound();
  return (
    <LongitudinalParticipant
      id={id}
      zh={!!(await headers()).get("accept-language")?.includes("zh")}
    />
  );
}
