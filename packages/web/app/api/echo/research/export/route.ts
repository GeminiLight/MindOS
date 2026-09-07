import { NextRequest } from 'next/server';
import { exportStudyData, LearningError } from '@geminilight/mindos/knowledge';
import { getMindRoot } from '@/lib/fs';
import { json, ownerBoundary, failure } from '@/lib/research-http';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(req: NextRequest) {
  try {
    const denied = await ownerBoundary(req); if (denied) return denied;
    const id = req.nextUrl.searchParams.get('id') ?? '';
    if (!/^study-[a-f0-9]{24}$/.test(id) || [...req.nextUrl.searchParams.keys()].some(k => k !== 'id')) throw new LearningError('invalid', 'Choose a study to download.');
    const response = json(exportStudyData(getMindRoot(), id));
    response.headers.set('Content-Disposition', `attachment; filename="${id}.json"`);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
  } catch (error) { return failure(error); }
}
