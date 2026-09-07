export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextRequest } from "next/server";
import {
  readLongitudinal,
  useLongitudinal,
  beginLongitudinalHelp,
  finishLongitudinalHelp,
} from "@geminilight/mindos/knowledge";
import { getMindRoot } from "@/lib/fs";
import { json, body } from "@/lib/research-http";
import {
  studyDeploymentBoundary,
  studyAccessFailure,
} from "@/lib/study-access-http";
import { executeMethodComparison } from "@/lib/study-coaching-executor";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, ctx: Context) {
  try {
    const denied = studyDeploymentBoundary(req);
    if (denied) return denied;
    const { id } = await ctx.params;
    return json({
      view: readLongitudinal(
        getMindRoot(),
        id,
        req.cookies.get("mindos-long-" + id)?.value,
      ),
    });
  } catch (e) {
    return studyAccessFailure(e);
  }
}
export async function PATCH(req: NextRequest, ctx: Context) {
  try {
    const denied = studyDeploymentBoundary(req);
    if (denied) return denied;
    const { id } = await ctx.params,
      token = req.cookies.get("mindos-long-" + id)?.value,
      root = getMindRoot(),
      input = await body(req);
    if (input.action === "help") {
      const { action, ...command } = input;
      const run = beginLongitudinalHelp(root, id, token, command);
      if (run.execute && run.request)
        finishLongitudinalHelp(
          root,
          id,
          run.runId,
          await executeMethodComparison(run.request, req.signal),
        );
      return json({ view: readLongitudinal(root, id, token) });
    }
    return json({ view: useLongitudinal(root, id, token, input) });
  } catch (e) {
    return studyAccessFailure(e);
  }
}
