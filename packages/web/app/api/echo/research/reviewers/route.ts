import { NextRequest } from 'next/server';
import { issueStudyReviewer, listStudyReviewers, revokeStudyReviewer, exportStudyForReview, LearningError } from '@geminilight/mindos/knowledge';
import { getMindRoot } from '@/lib/fs';
import { ownerBoundary, json, body, failure } from '@/lib/research-http';
import { studyDeploymentBoundary } from '@/lib/study-access-http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
async function boundary(req: NextRequest) { return await ownerBoundary(req) ?? studyDeploymentBoundary(req); }
export async function GET(req: NextRequest) {
  try { const denied = await boundary(req); if (denied) return denied;
    if ([...req.nextUrl.searchParams.keys()].some(k => k !== 'id')) throw new LearningError('invalid', 'Choose a study.');
    const id = req.nextUrl.searchParams.get('id') ?? ''; const root = getMindRoot();
    return json({ invitations: listStudyReviewers(root, id), availableCount: exportStudyForReview(root, id).items.length });
  } catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
  try { const denied = await boundary(req); if (denied) return denied;
    const { id, ...input } = await body(req); if (typeof id !== 'string') throw new LearningError('invalid', 'Choose a study.');
    return json({ invitation: issueStudyReviewer(getMindRoot(), id, input) });
  } catch (error) { return failure(error); }
}
export async function PATCH(req: NextRequest) {
  try { const denied = await boundary(req); if (denied) return denied;
    const { id, ...input } = await body(req); if (typeof id !== 'string') throw new LearningError('invalid', 'Choose a study.');
    return json({ invitations: revokeStudyReviewer(getMindRoot(), id, input) });
  } catch (error) { return failure(error); }
}
