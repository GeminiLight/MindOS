import { NextRequest } from 'next/server';
import { readStudyAccess, readStudyReviewer, StudyAccessError } from '@geminilight/mindos/knowledge';
import { getMindRoot } from '@/lib/fs';
import { json, body } from '@/lib/research-http';
import { studyDeploymentBoundary, studyAccessFailure, studyCookie, reviewerCookie, type StudyRouteContext } from '@/lib/study-access-http';
export async function exchangeStudySession(req: NextRequest, context: StudyRouteContext, role: 'participate' | 'review') {
  let selectedId: string | undefined;
  const cookieName = role === 'participate' ? studyCookie : reviewerCookie;
  const cookieOptions = (id: string, maxAge: number) => ({ httpOnly: true, sameSite: 'strict' as const, secure: req.nextUrl.protocol === 'https:', path: '/api/study/' + role + '/' + id, maxAge });
  try {
    const denied = studyDeploymentBoundary(req); if (denied) return denied;
    const { id } = await context.params; selectedId = id;
    const input = await body(req);
    if (Object.keys(input).length !== 1 || typeof input.token !== 'string') throw new StudyAccessError();
    const view = (role === 'participate' ? readStudyAccess : readStudyReviewer)(getMindRoot(), id, input.token);
    const response = json({ view });
    response.cookies.set(cookieName(id), input.token, cookieOptions(id, 180 * 86400));
    return response;
  } catch (error) {
    const response = studyAccessFailure(error);
    // Rejecting a replacement invitation must not leave the prior role identity active.
    if (error instanceof StudyAccessError && selectedId && /^study-[a-f0-9]{24}$/.test(selectedId))
      response.cookies.set(cookieName(selectedId), '', cookieOptions(selectedId, 0));
    return response;
  }
}
