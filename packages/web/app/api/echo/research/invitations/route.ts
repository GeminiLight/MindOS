import { NextRequest } from 'next/server';
import { getStudy, issueStudyInvitation, listStudyInvitations, revokeStudyInvitation, LearningError } from '@geminilight/mindos/knowledge';
import { getMindRoot } from '@/lib/fs';
import { ownerBoundary, json, body, failure } from '@/lib/research-http';
import { studyExecutionReadiness } from '@/lib/study-coaching-config';
import { studyDeploymentBoundary } from '@/lib/study-access-http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
async function boundary(req: NextRequest) { return await ownerBoundary(req) ?? studyDeploymentBoundary(req); }
export async function GET(req: NextRequest) {
    try {
        const denied = await boundary(req);
        if (denied)
            return denied;
        if ([...req.nextUrl.searchParams.keys()].some(k => k !== 'id'))
            throw new LearningError('invalid', 'Choose a study.');
        const id = req.nextUrl.searchParams.get('id') ?? '';
        const invitations = listStudyInvitations(getMindRoot(), id);
        return json({ invitations, execution: studyExecutionReadiness(getStudy(getMindRoot(), id)!.protocol) });
    }
    catch (error) {
        return failure(error);
    }
}
export async function POST(req: NextRequest) {
    try {
        const denied = await boundary(req);
        if (denied)
            return denied;
        const { id, ...input } = await body(req);
        if (typeof id !== 'string')
            throw new LearningError('invalid', 'Choose a study.');
        const study = getStudy(getMindRoot(), id);
        if (study && studyExecutionReadiness(study.protocol).some(condition => !condition.configured)) return json({ code: 'configuration' }, 503);
        return json({ invitation: issueStudyInvitation(getMindRoot(), id, input) });
    }
    catch (error) {
        return failure(error);
    }
}
export async function PATCH(req: NextRequest) {
    try {
        const denied = await boundary(req);
        if (denied)
            return denied;
        const { id, ...input } = await body(req);
        if (typeof id !== 'string')
            throw new LearningError('invalid', 'Choose a study.');
        return json({ invitations: revokeStudyInvitation(getMindRoot(), id, input) });
    }
    catch (error) {
        return failure(error);
    }
}
