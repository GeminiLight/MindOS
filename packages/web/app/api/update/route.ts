export const dynamic = 'force-dynamic';

import { handleUpdatePost } from '@geminilight/mindos/server';
import { toNextResponse } from '../_mindos-adapter';

export async function POST() {
  return toNextResponse(handleUpdatePost());
}
