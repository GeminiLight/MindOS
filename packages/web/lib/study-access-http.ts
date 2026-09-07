import { NextRequest } from 'next/server';
import { LearningError, StudyAccessError } from '@geminilight/mindos/knowledge';
import { readRuntimeAuthConfig } from '@/lib/runtime-auth-config';
import { json, sameOriginBoundary, failure } from '@/lib/research-http';
export type StudyRouteContext = {
    params: Promise<{
        id: string;
    }>;
};
export const studyCookie = (id: string) => 'mindos-study-' + id.replace(/^study-/, '');
export const reviewerCookie = (id: string) => 'mindos-review-' + id.replace(/^study-/, '');
export function studyDeploymentBoundary(req: NextRequest) {
    const denied = sameOriginBoundary(req);
    if (denied)
        return denied;
    const { authToken, webPassword } = readRuntimeAuthConfig();
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(req.nextUrl.hostname);
    if (!authToken || !webPassword || (!local && req.nextUrl.protocol !== 'https:'))
        return json({ code: 'unavailable' }, 503);
    return null;
}
export function studyAccessFailure(error: unknown) {
    if (error instanceof StudyAccessError)
        return json({ code: 'unauthorized' }, 401);
    return failure(error instanceof LearningError ? error : new Error('Study unavailable'));
}
export function studySession(req: NextRequest, id: string) { return req.cookies.get(studyCookie(id))?.value; }
