export const dynamic = 'force-dynamic';

import { handleUpdateCheckGet } from '@geminilight/mindos/server';
import { getProjectRoot } from '@/lib/project-root';
import { toNextResponse } from '../_mindos-adapter';

const projectRoot = getProjectRoot();

export async function GET() {
  return toNextResponse(await handleUpdateCheckGet({ projectRoot }));
}
