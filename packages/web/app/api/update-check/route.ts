export const dynamic = 'force-dynamic';

import { handleUpdateCheckGet } from '@geminilight/mindos/server';
import { toNextResponse } from '../_mindos-adapter';

export async function GET() {
  return toNextResponse(await handleUpdateCheckGet());
}
