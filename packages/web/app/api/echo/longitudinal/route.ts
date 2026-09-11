export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextRequest } from "next/server";
import {
  createLongitudinal,
  issueLongitudinalAccess,
  listLongitudinal,
  adminLongitudinal,
  exportLongitudinalReviewPacket,
  exportLongitudinalReviewKey,
  reviewLongitudinalMethod,
} from "@geminilight/mindos/knowledge";
import { getMindRoot } from "@/lib/fs";
import { ownerBoundary, body, json, failure } from "@/lib/research-http";
import { studyDeploymentBoundary } from "@/lib/study-access-http";
import { currentComparisonRuntime } from "@/lib/method-comparison-runtime";
const allowedQuery = new Set(["id", "packet"]);
export async function GET(req: NextRequest) {
  try {
    const denied = await ownerBoundary(req);
    if (denied) return denied;
    const params = req.nextUrl.searchParams;
    if ([...params.keys()].some((key) => !allowedQuery.has(key)))
      return json({ code: "invalid" }, 400);
    const id = params.get("id");
    const packet = params.get("packet");
    if (packet && !id) return json({ code: "invalid" }, 400);
    if (packet === "review")
      return json(exportLongitudinalReviewPacket(getMindRoot(), id!));
    if (packet === "key")
      return json(exportLongitudinalReviewKey(getMindRoot(), id!));
    if (packet) return json({ code: "invalid" }, 400);
    return json(
      id
        ? {
            ...adminLongitudinal(getMindRoot(), id),
            accessReady: !studyDeploymentBoundary(req),
          }
        : {
            ...listLongitudinal(getMindRoot()),
            runtime: currentComparisonRuntime(),
            accessReady: !studyDeploymentBoundary(req),
          },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const denied = await ownerBoundary(req);
    if (denied) return denied;
    const input = await body(req);
    const runtime = currentComparisonRuntime();
    if (!runtime) return json({ code: "configuration" }, 409);
    const protocol = input.protocol as Record<string, unknown>;
    if (
      !protocol ||
      JSON.stringify(protocol.runtime) !== JSON.stringify(runtime)
    )
      return json({ code: "conflict" }, 409);
    return json(createLongitudinal(getMindRoot(), input));
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: NextRequest) {
  try {
    const denied = await ownerBoundary(req);
    if (denied) return denied;
    const { id, action, ...input } = await body(req);
    if (typeof id !== "string") return json({ code: "invalid" }, 400);
    if (action === "invite") {
      const unavailable = studyDeploymentBoundary(req);
      if (unavailable) return unavailable;
      return json(issueLongitudinalAccess(getMindRoot(), id, input));
    }
    if (action === "review") {
      reviewLongitudinalMethod(getMindRoot(), id, input);
      return json({
        ...adminLongitudinal(getMindRoot(), id),
        accessReady: !studyDeploymentBoundary(req),
      });
    }
    return json({ code: "invalid" }, 400);
  } catch (e) {
    return failure(e);
  }
}
