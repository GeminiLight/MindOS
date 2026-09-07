export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { NextRequest } from 'next/server';
import { createStudy, getStudy, listStudies, getStudyReadiness, updateStudyDraft, freezeStudy, LearningError } from '@geminilight/mindos/knowledge';
import { json, ownerBoundary, failure, body } from '@/lib/research-http';
import { getMindRoot } from '@/lib/fs';

function project(id: string) {
  const root = getMindRoot(); const study = getStudy(root, id);
  if (!study) throw new LearningError('not-found', 'Study not found.');
  return { study, ...getStudyReadiness(root, id) };
}
export async function GET(req: NextRequest) {
  try {
    const denied = await ownerBoundary(req); if (denied) return denied;
    if ([...req.nextUrl.searchParams.keys()].some(key => key !== 'id')) throw new LearningError('invalid', 'Unknown study operation.');
    return json(req.nextUrl.searchParams.has('id') ? project(req.nextUrl.searchParams.get('id')!) : listStudies(getMindRoot()));
  } catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
  try {
    const denied = await ownerBoundary(req); if (denied) return denied;
    const study = createStudy(getMindRoot(), await body(req)); return json(project(study.id));
  } catch (error) { return failure(error); }
}
export async function PATCH(req: NextRequest) {
  try {
    const denied = await ownerBoundary(req); if (denied) return denied;
    const { id, action, ...command } = await body(req);
    if (typeof id !== 'string') throw new LearningError('invalid', 'Choose a study.');
    if (action === 'save') updateStudyDraft(getMindRoot(), id, command);
    else if (action === 'freeze') freezeStudy(getMindRoot(), id, command);
    else throw new LearningError('invalid', 'Unknown study operation.');
    return json(project(id));
  } catch (error) { return failure(error); }
}
