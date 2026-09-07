import { NextRequest } from 'next/server';
import { readStudyAccess, useStudyAccess, beginStudyCoaching, finishStudyCoaching } from '@geminilight/mindos/knowledge';
import { getMindRoot } from '@/lib/fs';
import { json, body } from '@/lib/research-http';
import { studyDeploymentBoundary, studyAccessFailure, studySession, type StudyRouteContext } from '@/lib/study-access-http';
import { executeStudyCoaching } from '@/lib/study-coaching-executor';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(req: NextRequest, context: StudyRouteContext) {
    try {
        const denied = studyDeploymentBoundary(req);
        if (denied)
            return denied;
        const { id } = await context.params;
        return json({ view: readStudyAccess(getMindRoot(), id, studySession(req, id)) });
    }
    catch (error) {
        return studyAccessFailure(error);
    }
}
export async function PATCH(req: NextRequest, context: StudyRouteContext) {
    try {
        const denied = studyDeploymentBoundary(req);
        if (denied)
            return denied;
        const { id } = await context.params;
        const command = await body(req);
        const current = readStudyAccess(getMindRoot(), id, studySession(req, id));
        if (current.kind === 'participant' && current.participant.nextPhase === 'coaching' && !current.participant.coachingAvailable && command.version === current.participant.version && ['open', 'answer', 'skip'].includes(String(command.action)))
            return json({ code: 'unavailable' }, 503);
        if (command.action === 'help') {
            const { action: _action, ...input } = command;
            const root = getMindRoot();
            const token = studySession(req, id);
            const run = beginStudyCoaching(root, id, token, input);
            if (run.execute && run.request) {
                const result = await executeStudyCoaching(run.request, req.signal);
                finishStudyCoaching(root, id, run.runId, result);
            }
            return json({ view: readStudyAccess(root, id, token) });
        }
        return json({ view: useStudyAccess(getMindRoot(), id, studySession(req, id), command) });
    }
    catch (error) {
        return studyAccessFailure(error);
    }
}
