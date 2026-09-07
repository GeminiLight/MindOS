export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextRequest } from "next/server";
import {
  readLongitudinal,
  StudyAccessError,
} from "@geminilight/mindos/knowledge";
import { getMindRoot } from "@/lib/fs";
import { json, body } from "@/lib/research-http";
import {
  studyDeploymentBoundary,
  studyAccessFailure,
} from "@/lib/study-access-http";
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const options = {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: req.nextUrl.protocol === "https:",
    path: "/api/study/longitudinal/" + id,
    maxAge: 90 * 86400,
  };
  try {
    const denied = studyDeploymentBoundary(req);
    if (denied) return denied;
    const input = await body(req);
    if (Object.keys(input).length !== 1 || typeof input.token !== "string")
      throw new StudyAccessError();
    const view = readLongitudinal(getMindRoot(), id, input.token);
    const response = json({ view });
    response.cookies.set("mindos-long-" + id, input.token, options);
    return response;
  } catch (e) {
    const response = studyAccessFailure(e);
    if (e instanceof StudyAccessError && /^cohort-[a-f0-9]{24}$/.test(id))
      response.cookies.set("mindos-long-" + id, "", { ...options, maxAge: 0 });
    return response;
  }
}
