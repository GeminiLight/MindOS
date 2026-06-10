export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { handleMcpTokenReveal } from '@geminilight/mindos/server';
import { readSettings } from '@/lib/settings';
import { toNextResponse } from '../../../_mindos-adapter';

export async function POST() {
  return toNextResponse(await handleMcpTokenReveal({
    readSettings,
  }));
}
