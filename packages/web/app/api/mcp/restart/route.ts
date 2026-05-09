export const dynamic = 'force-dynamic';

import { handleMcpRestartPost } from '@geminilight/mindos/server';
import { readSettings } from '@/lib/settings';
import { getProjectRoot } from '@/lib/project-root';
import { toNextResponse } from '../../_mindos-adapter';

export async function POST() {
  return toNextResponse(await handleMcpRestartPost({
    readSettings,
    env: process.env,
    projectRoot: getProjectRoot(),
  }));
}
