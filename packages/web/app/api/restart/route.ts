export const dynamic = 'force-dynamic';

import { handleRestartPost } from '@geminilight/mindos/server';
import { toNextResponse } from '../_mindos-adapter';

export async function POST() {
  return toNextResponse(handleRestartPost());
}
