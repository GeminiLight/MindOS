import { NextRequest } from 'next/server';
import { readStudyReviewer, useStudyReviewer } from '@geminilight/mindos/knowledge';
import { getMindRoot } from '@/lib/fs';
import { json, body } from '@/lib/research-http';
import { studyDeploymentBoundary, studyAccessFailure, reviewerCookie, type StudyRouteContext } from '@/lib/study-access-http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(req: NextRequest, context: StudyRouteContext) {
  try { const denied = studyDeploymentBoundary(req); if (denied) return denied;
    const { id } = await context.params;
    return json({ view: readStudyReviewer(getMindRoot(), id, req.cookies.get(reviewerCookie(id))?.value) });
  } catch (error) { return studyAccessFailure(error); }
}
export async function PATCH(req: NextRequest, context: StudyRouteContext) {
  try { const denied = studyDeploymentBoundary(req); if (denied) return denied;
    const { id } = await context.params; const token = req.cookies.get(reviewerCookie(id))?.value;
    readStudyReviewer(getMindRoot(), id, token);
    return json({ view: useStudyReviewer(getMindRoot(), id, token, await body(req)) });
  } catch (error) { return studyAccessFailure(error); }
}
